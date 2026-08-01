<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Spaced-repetition review session (S-05)

- **Plan**: context/changes/spaced-repetition-review-session/plan.md
- **Scope**: Full plan (Phase 1, 2, 3 — all complete)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION (triaged — all 6 findings resolved 2026-08-02)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — FSRS scheduler uses an undocumented `enable_short_term: false` override

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/fsrs.ts:6, src/components/decks/ReviewSessionPanel.tsx:61
- **Detail**: The plan's exact contract for `src/lib/fsrs.ts` (plan.md:144) is `export const scheduler = fsrs();` — "no `generatorParameters()` overrides." The actual code in both the server scheduler and the client's local preview scheduler is `fsrs(generatorParameters({ enable_short_term: false }))`, with an inline comment explaining the rationale ("skips the minutes-scale (re)learning steps, so every rating... produces a day-scale interval"). This is a real, consistently-applied behavior change (not a bug — both instances agree, so preview labels match what the server commits), but it deviates from the plan's literal contract and changes what "FSRS's documented default behavior" means for this feature's manual verification step (plan.md:22, 186).
- **Fix A ⭐ Recommended**: Keep the override (the reasoning is sound — without it, a `New`/`Learning` card can resurface minutes later, which is awkward for a single review "session" with no per-day new-card cap) and document it as a deliberate addendum in plan.md's Key Discoveries or Phase 2 section.
  - Strength: Preserves already-tested behavior that's arguably a better fit for this app's session model (no new-card-per-day cap exists here per the plan's own "What We're NOT Doing").
  - Tradeoff: The plan becomes a record of a decision made during implementation rather than before it.
  - Confidence: HIGH — the override is small, well-commented, and applied consistently on both sides of the API boundary.
  - Blind spot: Unclear whether this was a deliberate call the user should sign off on, or an unreviewed agent improvisation during Phase 2/3 implementation.
- **Fix B**: Revert both instances to plain `fsrs()` with no overrides, matching the plan exactly.
  - Strength: Restores literal plan compliance and vanilla FSRS defaults.
  - Tradeoff: Reintroduces the minutes-scale relearning-step behavior the override was written to avoid.
  - Confidence: MED — depends on which behavior is actually wanted; not verifiable from code alone.
  - Blind spot: No record of user intent either way.
- **Decision**: FIXED via Fix A — documented as an addendum in plan.md's Key Discoveries (2026-08-02).

### F2 — `SESSION_SIZE` is 30, not the specified 50

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/decks/[id]/review.ts:5
- **Detail**: Plan.md:172 and :268 explicitly specify `const SESSION_SIZE = 50`, tying that number to the NFR reasoning ("50-card session cap keeps... well under the NFR's 500-cards-per-account ceiling"). The actual constant is `30`. The cap is correctly enforced via `.limit(SESSION_SIZE)` — this isn't a missing-pagination bug — but the value silently diverges from the documented contract with no comment explaining why, unlike F1's override which is explained inline.
- **Fix**: Change `SESSION_SIZE` to `50` to match the plan and its NFR reasoning; if 30 is intentional, add a comment explaining the deviation and update plan.md to match.
- **Decision**: FIXED (differently) — kept 30, intentional (shorter/easier sessions). Added explanatory comment in review.ts and an addendum in plan.md Phase 2 + Performance Considerations (2026-08-02).

### F3 — Rating buttons bypass the CVA `variant` prop

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/decks/ReviewSessionPanel.tsx:15-20, 258-274
- **Detail**: Plan.md:221 explicitly calls this component out as "the first real usage of the CVA variants per CLAUDE.md's documented convention" — `destructive`/`secondary`/`default`/`outline` for Again/Hard/Good/Easy. The actual `RATING_BUTTONS` array hardcodes raw Tailwind classes (`bg-red-600 hover:bg-red-500`, etc.) passed via `className` instead, and `variant` is never passed to `<Button>`. `src/components/ui/button.tsx` already defines equivalent semantic variants (`destructive`, `secondary`, `default`, `outline`) that would cover this exact case. This directly contradicts both the plan's contract and CLAUDE.md's "extend there, don't add inline variant logic elsewhere."
- **Fix**: Replace each `RATING_BUTTONS` entry's `className` with the corresponding `variant` (`destructive`/`secondary`/`default`/`outline`) and pass `variant` to `<Button>` instead of `className`.
- **Decision**: FIXED — RATING_BUTTONS now carries `variant`, `<Button variant={...}>` used, unused `cn` import removed. Lint verified clean (2026-08-02).

### F4 — Unplanned nav entry point and eslint ignore-list addition

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/decks/index.astro (+3 lines, "Review" link), eslint.config.js (+1 line)
- **Detail**: Neither change is in the plan's "Changes Required" for any phase. Both are necessary and benign: the deck list needed a link to `/decks/[id]/review` for the feature to be reachable at all, and `review.astro` needed adding to the existing per-page `astro-return-workaround` ignore list (same pattern already used for `generate.astro`, `cards/new.astro`, `index.astro`) to pass lint. This is a plan omission, not an implementation problem.
- **Fix**: Add both files to plan.md's Phase 3 "Changes Required" as an addendum so the plan reflects what was actually needed to ship the feature.
- **Decision**: FIXED — added as Phase 3 item #3 in plan.md (2026-08-02).

### F5 — `continueReviewing()` has no re-entrancy guard

- **Severity**: ✅ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/decks/ReviewSessionPanel.tsx:99-117
- **Detail**: `rate()` guards re-entry with `if (isRating || ...) return;` (line 134), but `continueReviewing()` has no equivalent top-of-function guard — it only relies on `isLoading` hiding the "Continue reviewing" button on the next render, unlike the mount effect's `cancelled` flag (line 70) for out-of-order responses. Low real-world risk (GET is idempotent; a double-click racing a re-render is unlikely), but it's an inconsistency with the rest of the file's guard pattern.
- **Fix**: Add `if (isLoading) return;` at the top of `continueReviewing`, mirroring `rate()`.
- **Decision**: FIXED (2026-08-02).

### F6 — `GET /review` over-fetches columns via `select("*")`

- **Severity**: ✅ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/review.ts:44
- **Detail**: The plan's contract for `GET` describes returning `front`, `back`, and the FSRS fields — `select("*")` also returns `deck_id`, `source`, `created_at`, `updated_at`, which the client never uses. Not a security issue (RLS already scopes rows to the owner), just unnecessary payload.
- **Fix**: Narrow the `.select(...)` to the fields the client actually consumes.
- **Decision**: FIXED — `review.ts` GET now selects only `id, front, back` + FSRS fields; added a shared `FsrsFields` type in `fsrs.ts` and narrowed `toFsrsCard`'s param type and the client's `ReviewCard` type to match. Lint + build verified clean (2026-08-02).
