<!-- PLAN-REVIEW-REPORT -->
# Plan Review: UX Improvements Implementation Plan

- **Plan**: context/changes/ux-improvements/plan.md
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE (verdict after fixes: SOUND — all findings fixed in plan)
- **Findings**: 1 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL (pre-fix) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING (pre-fix) |
| Plan Completeness | WARNING (pre-fix) |

## Grounding

6/6 referenced files exist (`GenerateFlashcardsPanel.tsx`, `ReviewSessionPanel.tsx`, `cards.ts`, `review.ts`, `fsrs.ts`, `CardListPanel.tsx`); 8/8 cited symbols/line ranges verified accurate within ±2 lines (`setDecision`, `handleSave`, `rate()`, `continueReviewing()`, `isValidCardInput`, `isValidGrade`, `fromFsrsCard`/`toFsrsCard`, `CardListPanel` dialog pattern). RLS ownership model confirmed via `supabase/migrations/20260729164431_deck_card_schema_foundation.sql` — the plan's "RLS as authorization boundary" claim for the new `review-reset` endpoint is consistent with `review.ts`'s existing pattern. One brief↔plan inconsistency found (F3).

## Findings

### F1 — Pre-save validation contract deadlocks the Save button

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 — Pre-save validation surfacing
- **Detail**: The original contract computed `invalidIndices` only inside `handleSave`, then disabled the Save button while non-empty. A disabled button can't be re-clicked, so `invalidIndices` could never be recomputed or cleared — even after the user rejected the offending proposal. Also contradicted Success Criteria, which implies live warnings tied to acceptance, not save-attempt-triggered ones.
- **Fix**: Make invalid-and-accepted detection a plain derived value computed every render from `proposals` (same style as `acceptedProposals`), not state set inside `handleSave`. Used for both the inline warning and the Save button's disabled condition.
- **Decision**: FIXED — plan.md's Phase 1 §2 contract rewritten to describe a derived `invalidAcceptedIndices` value; `disabled` condition and warning rendering both keyed off it; `handleSave` no longer needs an abort check.

### F2 — Reset endpoint's partial-failure behavior is undefined

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Restore endpoint / Open Risks & Assumptions
- **Detail**: The plan's own Open Risks section assumed a partially-failed reset could be retried, but the client contract cleared the snapshot map on any 200 response, and the endpoint only returned `{ restored: number }` — no case for `restored < cards.length`. This made the plan's own documented mitigation for its own documented risk unreachable.
- **Fix**: Endpoint uses `Promise.allSettled` per-item and returns `{ restored, total }`. Client only clears the whole snapshot map when `restored === total`; otherwise keeps it and surfaces a partial-restore message.
- **Decision**: FIXED — plan.md's Phase 2 §1 contract updated: response shape now `{ restored, total }`, `Promise.all` → `Promise.allSettled`, explicit client-side partial-clear rule added.

### F3 — plan-brief.md mislabels the reject-all button

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan-brief.md — Key Decisions Made table
- **Detail**: plan-brief.md's "Bulk selection UX" row read "Reject all remaining", contradicting the row directly below it ("Bulk action scope: applies to all proposals, including already-decided ones") and plan.md's Phase 1 contract.
- **Fix**: Changed to 'Global "Accept all" / "Reject all" buttons' — dropped "remaining".
- **Decision**: FIXED — plan-brief.md updated.

### F4 — Reset endpoint trusts client-supplied FSRS values with no bounds check

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Restore endpoint
- **Detail**: Unlike `review.ts`'s POST (server computes FSRS write via `scheduler.next()`, client only sends a bounds-checked grade), `review-reset` accepted raw FSRS field values from the client with only type-level validation. Not a cross-user security hole (RLS still confines writes to the caller's own cards), but a buggy client could persist nonsensical state unchecked.
- **Fix**: Added value-level bounds to the type guard — `due`/`last_review` parse to valid dates, numeric fields non-negative finite, `state` within FSRS's valid enum range (0-3).
- **Decision**: FIXED — plan.md's Phase 2 §1 contract updated with explicit value-level validation requirements.
