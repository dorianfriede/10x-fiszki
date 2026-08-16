<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI-Generated Flashcard Review (S-02)

- **Plan**: context/changes/ai-generated-flashcard-review/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — No timeout on the OpenRouter fetch call

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/openrouter.ts:49-63
- **Detail**: The `fetch()` call to OpenRouter has no `signal`/timeout. A slow or hanging upstream response leaves the request pending indefinitely, bounded only by platform/runtime defaults rather than app logic. The client's "Generating…" state has no in-app way to recover except a page refresh.
- **Fix**: Add `signal: AbortSignal.timeout(15_000)` (or similar) to the fetch options, and map an `AbortError` to a `GenerationError` with a clear "request timed out" message.
- **Decision**: FIXED

### F2 — No upper-bound length validation matching the DB's 2000-char constraint; batch insert fails atomically

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/openrouter.ts:22-26 (`isValidProposal`), src/pages/api/decks/[id]/cards.ts:9-13 (`isValidCardInput`) and :51 (insert call)
- **Detail**: `cards` has `check (length(front) <= 2000)` and the same for `back` (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:24-25`). Both validators only check `trim().length > 0`, never an upper bound. The save route inserts all accepted cards in one `supabase.from("cards").insert(rows)` call (cards.ts:51) — if any single accepted proposal exceeds 2000 chars (a plausible AI-verbosity failure mode), the entire batch fails atomically on the Postgres constraint violation, silently losing every other accepted card in that save, not just the oversized one. The raw `error.message` (cards.ts:54) is also surfaced directly to the client, leaking a Postgres error string.
- **Fix A ⭐ Recommended**: Add `front.length <= 2000 && back.length <= 2000` to `isValidProposal` (silently filter oversized AI proposals, consistent with the existing "drop malformed items" behavior) and to `isValidCardInput` (reject the whole save request with a clear 400 if any accepted card is oversized, since the user explicitly chose to save it and should get a chance to fix it rather than lose the batch).
  - Strength: Prevents the atomic-batch-failure surprise entirely; mirrors the DB constraint as the ground truth, consistent with the plan's stated "defensive client-side-shaped validation, not a re-implementation of ownership/RLS" intent.
  - Tradeoff: Two different failure behaviors (silent-filter vs. explicit-reject) across the two call sites — needs a one-line comment explaining why they differ.
  - Confidence: HIGH — the DB constraint is unambiguous; mirroring it is a mechanical, low-risk change.
  - Blind spot: Haven't measured how often the real model config (`openai/gpt-oss-20b:free`) actually emits >2000-char front/back in practice — the risk is plausible but unquantified.
- **Fix B**: Leave as-is; treat the DB constraint as the sole backstop and accept the batch-atomicity behavior as a known, rare-case risk.
  - Strength: Zero code change; the DB already correctly rejects the bad row, so no bad data reaches the table.
  - Tradeoff: One oversized card in a save silently costs the user every other accepted card in that batch — a real (if rare) data-loss-feeling bug — and the raw Postgres error message still leaks to the client either way.
  - Confidence: MEDIUM — depends entirely on how often the model emits oversized output, which isn't measured here.
  - Blind spot: No production data yet on oversized-output frequency (feature just shipped).
- **Decision**: FIXED via Fix A

### F3 — No server-side logging on AI-call failures

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/openrouter.ts, src/pages/api/decks/[id]/generate.ts
- **Detail**: Every failure path (network error, non-2xx, malformed JSON/shape) resolves to a generic `GenerationError` with zero logging anywhere in these files. This correctly satisfies the "never log source text or key" requirement, but leaves no operational signal when OpenRouter starts failing in production (bad key, rate limit, model deprecated).
- **Fix**: Add `console.error("openrouter call failed", { status: response.status })` (status/shape only, never `sourceText` or the key) in the failure branches — `no-console` is only `"warn"` in `eslint.config.js`, so this won't fail lint.
- **Decision**: FIXED

### F4 — No unmount cleanup or re-entrancy guard in GenerateFlashcardsPanel

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/decks/GenerateFlashcardsPanel.tsx:33-73, 86-115
- **Detail**: `handleGenerate`/`handleSave` call `setState` in `finally`/`catch` blocks with no unmount guard (no cleanup-tied `AbortController`, no mounted ref) — navigating away mid-request triggers a set-state-on-unmounted-component scenario (React 18: dev warning only, not a hard crash). Neither handler also guards re-entrancy beyond the `disabled` prop, so a double-fire before repaint could send two concurrent requests.
- **Fix**: Add an `isMounted`/`AbortController` cleanup ref, and an `if (isGenerating) return;` / `if (isSaving) return;` guard at the top of each handler.
- **Decision**: FIXED

### F5 — Unplanned eslint.config.js rule change, broader than strictly necessary

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:70
- **Detail**: `@typescript-eslint/no-misused-promises` is disabled for all `.astro` files, not mentioned anywhere in the plan. Verified this is a genuine, justified companion fix: `generate.astro:9` is the only `.astro` file in the repo with a top-level `return` in frontmatter (`return Astro.redirect(...)`), introduced in the same commit (f97e48b), and the comment matches a real `astro-eslint-parser` crash on that construct. The rule isn't security-relevant and is scoped to `.astro` only, not global — but it's disabled repo-wide for that file type rather than narrowly for the one offending line/file, so it also silences the check for any future `.astro` `<script>` block.
- **Fix**: Optionally replace the file-type-wide disable with an inline `eslint-disable-next-line` on the specific `return` statement in `generate.astro`, or scope the override to that one file, to preserve the check for other `.astro` files.
- **Decision**: FIXED
