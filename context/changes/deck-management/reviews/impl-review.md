<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deck create, view, and delete

- **Plan**: context/changes/deck-management/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION (pre-triage) → all findings resolved in triage
- **Findings**: 0 critical, 3 warnings, 1 observation — 4 fixed, 0 skipped

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

### F1 — Unsafe `FormDataEntryValue` cast can throw an unhandled exception

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/index.ts:8
- **Detail**: `const trimmedName = (form.get("name") as string).trim();` casts an unchecked `FormDataEntryValue | null` straight to `string`. If the `name` field is missing (`null`) or submitted as a `File` (e.g. a forged multipart POST via curl — the kind of request this plan's own Phase 3 manual test explicitly exercises for the delete route), `.trim()` throws a `TypeError`, producing an unhandled 500 instead of the graceful `?error=` redirect every other failure path in this route (and `signup.ts`/`signin.ts`) uses.
- **Fix**: Guard the type before trimming — `const raw = form.get("name"); const trimmedName = typeof raw === "string" ? raw.trim() : "";` — then let the existing length check (line 10) produce the normal validation-error redirect.
- **Decision**: FIXED

### F2 — Duplicate-name pre-check doesn't escape SQL `LIKE` wildcards

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/index.ts:28
- **Detail**: `.ilike("name", trimmedName)` passes the user-supplied name directly as a `LIKE` pattern without escaping `%`/`_`. A name containing those characters produces false-positive or false-negative duplicate detection (e.g. `"a_c"` matching an existing `"abc"`). Not an injection risk — PostgREST parameterizes the value — just a logic bug in the pre-check the plan added specifically for UX (the `23505` catch on the actual insert, which is unaffected by this bug, remains the real guarantee).
- **Fix**: Escape `%`, `_`, and `\` in `trimmedName` before passing it to `.ilike()`.
- **Decision**: FIXED

### F3 — Delete confirmation is a full custom `<dialog>` with client-side state, not the planned native `confirm()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: src/pages/decks/index.astro:51-117
- **Detail**: Phase 3's contract specified an inline script calling `confirm(...)` and `e.preventDefault()` on cancel — explicitly "without introducing a React component or client-side state for a single yes/no gate," and the plan's top-level "What We're NOT Doing" list rules out "client-side state management" altogether. The implementation instead ships a styled `<dialog id="delete-confirm-dialog">` (lines 51-74) plus ~40 lines of script (lines 77-117) that tracks a `pendingForm` variable, wires cancel/backdrop-click/`cancel`-event handling, and defers `form.submit()` until explicit confirmation. It's still vanilla JS (no React) and still ends in a full-page POST + redirect, so it doesn't violate the letter of "no React component," but it does introduce exactly the kind of client-side state (`pendingForm`, dialog open/close) the plan called out to avoid, and materially more surface area than the one-liner `confirm()` the contract specified. Functionally it's fine — manual criteria 3.4/3.5 (confirm/cancel) already passed — this is a scope/contract fidelity question, not a bug.
- **Fix A ⭐ Recommended**: Document this as a plan addendum (the styled dialog matches the app's existing glassmorphism aesthetic that a jarring native `confirm()` would break) and accept it as implemented.
  - Strength: No code churn; preserves a working, already manually-verified UX improvement; native `confirm()` would look out of place next to the rest of this app's styled surfaces.
  - Tradeoff: The plan's explicit "no client-side state" boundary is set aside here, which slightly weakens that boundary as a guardrail for future phases/reviews.
  - Confidence: MED — reasonable given the UX payoff, but it does normalize a deviation from an explicitly-stated scope line.
  - Blind spot: Haven't checked whether any accessibility issues exist in the custom dialog (focus trap, ESC key) beyond the click-outside/`cancel`-event handling already present.
- **Fix B**: Simplify to the plan's literal `confirm()` + `preventDefault()`, deleting the `<dialog>` markup and the `pendingForm` state.
  - Strength: Matches the contract exactly; removes the state the plan explicitly wanted to avoid; ~70 fewer lines.
  - Tradeoff: Regresses a working, styled UX to a plain browser-native dialog that clashes with the rest of the app.
  - Confidence: HIGH — mechanical, low-risk change, but throws away already-tested work for contract literalism alone.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — documented as a plan addendum in `plan.md` Phase 3 §2 (2026-07-31); code unchanged.

### F4 — Deck-list query errors are silently swallowed

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/decks/index.astro:9-11
- **Detail**: `const { data: decks } = supabase ? await supabase.from("decks")... : { data: null };` discards `error`. A failed query (e.g. transient DB error) is indistinguishable from "user has no decks" and silently renders the empty-state message instead of surfacing a problem.
- **Fix**: Destructure `error` alongside `data` and render it (or log it) instead of falling through to the empty state.
- **Decision**: FIXED — destructured `decksError` and rendered a distinct error message; skipped `console.error` (no logging precedent in this codebase, and it tripped the `no-console` lint rule).
