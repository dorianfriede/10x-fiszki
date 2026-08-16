<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bulk candidate review actions + review session reset

- **Plan**: context/changes/ux-improvements/plan.md
- **Scope**: Full plan — Phase 1 of 2, Phase 2 of 2
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks re-run for this review: `npm run lint` (pass, 5 pre-existing `no-console` warnings in `openrouter.ts`, 0 errors) and `npm run build` (pass, includes Astro's type-check pass). Both match the plan's Progress checkboxes (1.1–1.3, 2.1–2.3).

## Findings

### F1 — Save button's disabled condition drops the plan's "zero accepted" clause; redirect behavior duplicates existing nav

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Scope Discipline
- **Location**: src/components/decks/GenerateFlashcardsPanel.tsx:122-128, 331

- **Detail**: The plan's contract for Phase 1 item 2 specifies the save button's disabled condition as `isSaving || acceptedProposals.length === 0 || invalidAcceptedIndices.size > 0`. The implementation ships `disabled={isSaving || invalidAcceptedIndices.size > 0}` — the `acceptedProposals.length === 0` clause was dropped. To compensate, `handleSave()` (lines 122-128) was given a new branch not described anywhere in the plan: when `acceptedProposals.length === 0`, clicking the button redirects to `/decks` instead of saving. The button's label still reads `Save 0 cards` in this state (line 335-337), so a user who rejects everything sees an enabled "Save 0 cards" button that silently navigates away without saving anything. This redirect also duplicates functionality that already exists: `src/pages/decks/[id]/generate.astro:23` renders an unconditional "← Decks" link on the same page, so the "how do I leave when I've rejected everything" gap this change was trying to close was already closed one level up.

- **Fix A ⭐ Recommended**: Revert to the plan's literal contract — restore `acceptedProposals.length === 0` to the disabled condition and remove the redirect branch from `handleSave()`.
  - Strength: Matches the plan exactly; removes a button whose label ("Save 0 cards") contradicts its actual action (silent redirect); the pre-existing "← Decks" link at `generate.astro:23` already covers this case.
  - Tradeoff: None significant — the redirect wasn't filling a gap that wasn't already covered by the page's nav link.
  - Confidence: HIGH — verified the nav link exists and renders unconditionally.
  - Blind spot: None significant.
- **Fix B**: Keep the redirect, but fix the label mismatch (e.g. swap to "Return to decks" when `acceptedProposals.length === 0`) and record it as a plan addendum.
  - Strength: Preserves the discovered behavior in case there's a reason (e.g. discoverability, keeping the user's eyes at the bottom of the list) the implementer wanted a second exit path.
  - Tradeoff: Adds a redundant "exit" affordance next to the existing nav link, plus upkeep of a plan addendum for something with no demonstrated need.
  - Confidence: MEDIUM — no evidence found that the existing nav link is insufficient.
  - Blind spot: Haven't asked why this was added if the nav link already existed.
- **Decision**: FIXED (via Fix B, label choice revisited) — kept the redirect behavior with the button still reading "Save 0 cards" (user's explicit call — no separate label for the zero-accepted state), and `plan.md` carries a dated addendum documenting the intentional deviation from the literal disabled-condition contract.

### F2 — Unplanned openrouter.ts change drops the JSON-parse-failure fallback, misclassifying the error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline / Safety & Quality
- **Location**: src/lib/openrouter.ts:84-93

- **Detail**: `src/lib/openrouter.ts` is not mentioned anywhere in the plan; it was modified in the Phase 1 commit (17eb00d) to extend the AbortSignal timeout across the response-body read, per the commit message a bug found during manual verification — a reasonable, well-scoped fix on its own. But it also removed the previous `.catch(() => null)` fallback around `response.json()`. Previously a malformed/non-JSON body produced `payload = null`, which `extractContent` turned into the accurate `"unexpected response shape"` error. Now `await response.json()` (line 84) sits inside the same try block as `fetch()`, so a `SyntaxError` from a malformed body falls into the generic catch (lines 85-93) and is logged/reported as `{reason: "network error"}` / `"Could not reach the AI service"` — misleading for both the user-facing message and log-based debugging, since the API did respond, just not with valid JSON.
- **Fix**: Wrap `await response.json()` in its own try/catch (or keep a `.catch()`), and on failure log/throw the original `"unexpected response shape"` `GenerationError` rather than falling through to the generic network-error branch.
- **Decision**: FIXED — added a `SyntaxError` branch to the existing catch block (openrouter.ts:88-91) that reclassifies a JSON-parse failure as `"unexpected response shape"` instead of the generic network-error message, keeping the single-try-block timeout coverage intact.

### F3 — review-reset.ts accepts an unbounded cards array

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/review-reset.ts:79

- **Detail**: The plan sizes this endpoint against `SESSION_SIZE` (30, per `review.ts:7`) under "Performance Considerations," but the route itself never enforces that bound — it only checks `Array.isArray(cards) && cards.length > 0 && cards.every(isValidResetCard)` (line 79). Any authenticated user could POST an arbitrarily large, shape-valid `cards` array, triggering that many concurrent `.update()` calls via `Promise.allSettled` (line 94) — unbounded relative to what the UI ever sends.
- **Fix**: Reject requests where `cards.length` exceeds a capped constant (reuse or mirror `SESSION_SIZE`) alongside the existing emptiness check, returning the same 400 shape.
- **Decision**: FIXED — added a local `SESSION_SIZE = 30` constant (mirroring `review.ts:7`) and a `cards.length > SESSION_SIZE` check alongside the existing emptiness/shape validation, with an updated error message reflecting the bound.

### F4 — Reset-confirm dialog's backdrop click isn't guarded by isResetting

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/decks/ReviewSessionPanel.tsx:258-260

- **Detail**: The dialog's `onClick` handler closes it on any click that targets the `<dialog>` element itself (i.e. the backdrop), with no `isResetting` guard — so a user can dismiss the dialog while `confirmReset()`'s POST is still in flight, re-enabling the rating buttons (which are only gated by `isRating`, not `isResetting`) before the reset request resolves. This exact gap already exists in `CardListPanel.tsx`'s delete-confirm dialog (`isDeleting` isn't checked in its backdrop `onClick` either), so this isn't a new class of bug introduced by this plan — it's inherited from the established pattern. Blast radius is low: no data is corrupted (ratings already saved correctly), worst case is a jarring queue reset if `confirmReset()` later succeeds after the user resumed rating.
- **Fix**: Guard both dialogs' backdrop `onClick` with the in-flight flag (`!isResetting` / `!isDeleting`) before closing. Worth fixing in both places together, not just here.
- **Decision**: FIXED — added `!isResetting` to `ReviewSessionPanel.tsx`'s backdrop `onClick` guard and `!isDeleting` to the same in `CardListPanel.tsx`, fixing the inherited pattern in both places.

### F5 — openResetConfirm() doesn't clear partialResetMessage

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/decks/ReviewSessionPanel.tsx:197-200

- **Detail**: `openResetConfirm()` clears `resetError` but not `partialResetMessage`. If a prior reset attempt left a partial-restore banner, it resurfaces on the next, unrelated dialog open even before any new attempt has been made.
- **Fix**: Clear `partialResetMessage` alongside `resetError` in `openResetConfirm()`.
- **Decision**: FIXED — `openResetConfirm()` now clears `partialResetMessage` alongside `resetError` before opening the dialog.

### F6 — review-reset.ts doesn't dedup card ids within a single request

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/review-reset.ts:94-113

- **Detail**: `isValidResetCard` never checks for duplicate `id`s across the payload. Duplicate entries produce redundant, order-dependent concurrent `.update()` calls against the same row (not currently reachable from `ReviewSessionPanel`'s `Map`-based snapshot, which is already deduped by construction — so this only matters against a malformed/hand-crafted request).
- **Fix**: Dedup by `id` before building the update list, or reject on duplicates in the validation step.
- **Decision**: FIXED — added a duplicate-id check (`new Set(cards.map(...)).size !== cards.length`) right after shape validation, returning 400 before any DB call.

## Triage Summary

All 6 findings fixed during triage (2026-08-02):

- **F1**: Fix B — kept the redirect-on-zero-accepted behavior; button label stays "Save 0 cards" (user's explicit call, revisited after initial fix), documented as a dated addendum in `plan.md`.
- **F2**: Added a `SyntaxError` branch to `openrouter.ts`'s catch block, reclassifying JSON-parse failures as "unexpected response shape."
- **F3**: Added a `SESSION_SIZE` cap (30) to `review-reset.ts`'s request validation.
- **F4**: Guarded backdrop-click dismissal with the in-flight flag in both `ReviewSessionPanel.tsx` (`!isResetting`) and `CardListPanel.tsx` (`!isDeleting`).
- **F5**: `openResetConfirm()` now clears `partialResetMessage` on open.
- **F6**: Added a duplicate-id rejection to `review-reset.ts`'s validation.

Re-verified after fixes: `npm run lint` (pass, 6 pre-existing `no-console` warnings, 0 errors) and `npm run build` (pass).

