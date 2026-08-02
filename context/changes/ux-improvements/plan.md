# UX Improvements Implementation Plan

## Overview

Two independent, small changes to two already-shipped features: bulk accept/reject actions in the AI candidate review panel (`GenerateFlashcardsPanel.tsx`, from S-02), and a "reset session" action in the spaced-repetition review panel (`ReviewSessionPanel.tsx`, from S-05). Neither touches the other's code; they're grouped under one roadmap slice (S-06) purely because both were identified as the same kind of gap during earlier implementation.

## Current State Analysis

**Candidate review (S-02)** — `GenerateFlashcardsPanel.tsx` holds all proposal state client-side (`Proposal[]` with a per-item `decision: "accepted" | "rejected" | null`). Accept/Reject are per-item toggle buttons only (`setDecision(index, decision)`, `GenerateFlashcardsPanel.tsx:87-94`) — no bulk affordance exists. Save is already a single batch `POST /api/decks/[id]/cards` sending every accepted proposal in one call (`GenerateFlashcardsPanel.tsx:104-130`); the server (`cards.ts:111`) validates the whole array with `cards.every(isValidCardInput)` and 400s the entire batch if any single item is invalid (empty or >2000 chars) — an atomic, all-or-nothing save with no per-item failure detail returned.

**Review session (S-05)** — `ReviewSessionPanel.tsx` has no session concept in the schema: no session id, no rating-history/log table (`context/changes/spaced-repetition-review-session/plan.md` explicitly scoped this out). Every rating commits immediately: `rate()` (`ReviewSessionPanel.tsx:134-172`) POSTs to `/api/decks/[id]/review`, which calls `scheduler.next()` and writes the new FSRS fields straight onto the `cards` row (`review.ts:100-129`) — there is no deferred/staged commit to roll back. The one existing "restart" precedent is `continueReviewing()` (`ReviewSessionPanel.tsx:99-118`), which re-fetches the due queue and resets `currentIndex`/`revealed`/`preview` to zero — but this is purely a local navigation reset; it doesn't touch any card's FSRS fields and the array it operates on gets fully replaced on each call.

### Key Discoveries:

- `cards[i]` in `ReviewSessionPanel` is never mutated after being fetched — a rated card's array entry still holds its pre-rating FSRS values until `continueReviewing()` (or the initial mount) replaces the whole array. This is what makes a true "undo my ratings" possible without a new history table, but only if a snapshot is captured before the array gets replaced.
- `fromFsrsCard`/`toFsrsCard` (`src/lib/fsrs.ts:22-62`) already define the exact 10-field shape (`due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`) that both a rating write and a restore write need to touch.
- No checkbox or multi-select UI primitive exists anywhere under `src/components/ui/` — only `button.tsx`. Per the confirmed design, this plan doesn't need one (global "accept all / reject all" buttons only).
- The only existing confirm-before-destructive-action pattern in the app is `CardListPanel.tsx`'s native `<dialog>` delete confirmation (`CardListPanel.tsx:145-190`) — reused here for reset confirmation.

## Desired End State

A user reviewing AI-generated candidates can click "Accept all" or "Reject all" to set every proposal's decision in one action (overwriting any individual decisions already made), and gets a clear inline warning if an accepted proposal is too long to save, without the save endpoint's contract changing. A user mid-review-session (or having just finished one) can click "Reset session," confirm, and have every card they rated since the review page loaded — across any number of "Continue reviewing" batches — restored to its exact pre-rating FSRS state, with the due queue then reloading fresh as if the session had just started.

Verify: run through both manual testing sections below; `npm run build`, lint, and typecheck all pass.

## What We're NOT Doing

- No checkbox-based arbitrary-subset selection in candidate review — only global "accept all" / "reject all" (confirmed design decision).
- No change to the existing atomic all-or-nothing `POST /api/decks/[id]/cards` save contract — oversized/invalid accepted proposals are caught client-side before the request fires, not handled via a new partial-success API shape.
- No proposal text editing to "fix" an oversized card — the only remediation is rejecting it individually.
- No rating-history/review-log table, and no true cross-mount session persistence — reset only covers cards rated since the review page's current mount, consistent with the schema's existing "current FSRS state only, no history" design (`context/changes/spaced-repetition-review-session/plan.md`).
- No reset/undo concept added to the candidate review flow — "reset" is scoped only to the spaced-repetition review session, per the roadmap's S-06 outcome wording.

## Implementation Approach

Both phases are additive to existing, working components — no refactor of the surrounding save/rating logic. Phase 1 is pure client-state (no new endpoint). Phase 2 adds one small new API route mirroring the existing `review.ts` POST's auth/ownership pattern, plus a client-side snapshot map that must survive `continueReviewing()`'s re-fetch — the one genuinely non-obvious piece of state sequencing in this plan.

## Critical Implementation Details

### State sequencing: the session snapshot must outlive batch re-fetches

`continueReviewing()` replaces the entire `cards` array and resets `currentIndex` to 0 — if the reset feature captured "cards rated this session" by reading back from `cards`/`currentIndex`, it would lose everything rated before the most recent re-fetch. The snapshot must instead be a separate piece of state (e.g. a `Map<string, FsrsFields>` in a ref or state variable) populated inside `rate()` at the moment each card is rated — capturing the *pre-rating* values of `currentCard` (already in scope before the POST fires) — and never cleared except when the user actually confirms a reset. This map, not the `cards` array, is the source of truth for what reset restores.

## Phase 1: Bulk accept/reject in candidate review

### Overview

Add "Accept all" / "Reject all" actions to the candidate review list, and catch oversized/invalid accepted proposals before the batch save fires so a large bulk-accept doesn't silently fail the entire save with no indication of which card caused it.

### Changes Required:

#### 1. Bulk decision actions

**File**: `src/components/decks/GenerateFlashcardsPanel.tsx`

**Intent**: Let the user set every proposal's decision to accepted or rejected in one click, overwriting any decisions already made on individual items (confirmed scope — bulk actions apply unconditionally to all proposals, not just undecided ones).

**Contract**: Two new handlers (`acceptAll`, `rejectAll`) that map `proposals` to the same `decision` value for every item, following the existing `setDecision` update pattern (`GenerateFlashcardsPanel.tsx:87-94`). Two new buttons rendered above the proposal `<ul>`, disabled while `isSaving`, styled consistently with the existing inline-Tailwind button pattern already used in this file (not the CVA `variant` prop — this file doesn't use it today, and introducing it here alone would be an inconsistent partial migration).

#### 2. Pre-save validation surfacing

**File**: `src/components/decks/GenerateFlashcardsPanel.tsx`

**Intent**: Since bulk-accepting raises the odds of including an oversized or empty card, catch that client-side before the batch POST fires (server validation is unchanged and stays atomic), so the user sees exactly which card is blocking the save instead of a generic 400.

**Contract**: Compute a derived `invalidAcceptedIndices` value on every render — the same style as the existing `acceptedProposals` derivation (`GenerateFlashcardsPanel.tsx:96`), not state set inside `handleSave` — by filtering `proposals` for `decision === "accepted"` items that fail the same rule the server enforces (`cards.ts:9-20`: non-empty trimmed, ≤2000 chars front/back). Render an inline warning on each list item whose index is in `invalidAcceptedIndices` ("This card is too long to save — reject it to continue"), live as decisions change — no save attempt required to trigger it. The save button's `disabled` condition becomes `isSaving || acceptedProposals.length === 0 || invalidAcceptedIndices.size > 0`, so it re-enables the moment the user rejects the offending proposal. `handleSave` itself needs no separate abort check — the disabled attribute already prevents the click path from firing while any accepted proposal is invalid.

### Addendum (found during impl review, 2026-08-02)

The "Contract" above specifies the save button's `disabled` condition as `isSaving || acceptedProposals.length === 0 || invalidAcceptedIndices.size > 0`. The shipped implementation (17eb00d) instead drops the `acceptedProposals.length === 0` clause and repurposes a click in that state as a redirect to `/decks` (discovered as a UX dead-end during Phase 1 manual verification: rejecting every proposal left no way to leave the page via this button). Confirmed design decision: the button keeps reading "Save 0 cards" in that state — no separate label — and the click still redirects to `/decks` instead of saving (impl review F1, fixed via Fix B, label choice revisited 2026-08-02). Kept as designed — `disabled` intentionally no longer includes the zero-accepted clause.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (or equivalent script in `package.json`)
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking "Accept all" marks every proposal accepted (styling updates on all items) and the save button label updates to reflect the full count.
- Clicking "Reject all" marks every proposal rejected, including ones previously individually accepted.
- After "Accept all," individually rejecting one proposal excludes only that one from the save count.
- A proposal whose front or back exceeds 2000 characters (or is empty) shows the inline warning when accepted (individually or via "Accept all"), and the save button stays disabled until it's rejected.
- Saving a batch with no invalid accepted proposals still works exactly as before (no regression to the existing single-POST save flow).

---

## Phase 2: Reset an in-progress review session

### Overview

Add a new API route that restores a set of cards' FSRS fields to caller-supplied values, and wire `ReviewSessionPanel` to track a cross-batch snapshot of every card rated since the page mounted, exposing a "Reset session" action that restores them and reloads the due queue fresh.

### Changes Required:

#### 1. Restore endpoint

**File**: `src/pages/api/decks/[id]/review-reset.ts` (new)

**Intent**: Given a list of cards and their FSRS field values, write those values back onto the corresponding rows — the inverse of what `review.ts`'s `POST` does on each rating.

**Contract**:
```
POST /api/decks/:id/review-reset
body: { cards: Array<{ id: string; due: string; stability: number; difficulty: number;
                        elapsed_days: number; scheduled_days: number; learning_steps: number;
                        reps: number; lapses: number; state: number; last_review: string | null }> }
→ 200 { restored: number; total: number }
```
Same auth (`context.locals.user`) and ownership pattern as `review.ts`'s `POST` (`review.ts:100-105`): each update scoped by `.eq("id", item.id).eq("deck_id", id)`, RLS as the authorization boundary. Validate array non-emptiness and per-item shape with a hand-rolled type guard in the same style as `isValidGrade` (`review.ts:14-18`), extended with value-level bounds beyond type checks: `due`/`last_review` parse to a valid `Date`, `stability`/`difficulty`/`elapsed_days`/`scheduled_days`/`learning_steps`/`reps`/`lapses` are non-negative finite numbers, `state` is within FSRS's valid state enum range (0-3) — mirroring `isValidGrade`'s own `grade >= 1 && grade <= 4` bounds style rather than accepting arbitrary numeric input. Apply the updates via `Promise.allSettled` over individual `.from("cards").update(...)` calls (no cross-row transaction — consistent with this codebase's existing non-transactional posture); `total` is `cards.length`, `restored` counts only the settled calls that both fulfilled and returned no Supabase `error`. A settled-but-errored or rejected individual update does not fail the whole request — it's simply excluded from `restored`.

Client-side, only remove an entry from the snapshot map if its card id was among the successfully-restored ones (or, at minimum, only clear the whole map when `restored === total`; otherwise keep the map intact and show "N of M cards restored — click Reset session again to retry the rest" instead of silently dropping unrestored entries).

#### 2. Cross-batch session snapshot + reset action

**File**: `src/components/decks/ReviewSessionPanel.tsx`

**Intent**: Track every card rated since this component mounted (surviving `continueReviewing()`'s re-fetches), and let the user restore them and restart the due queue.

**Contract**: A new snapshot map populated inside `rate()` (`ReviewSessionPanel.tsx:134-172`), captured from `currentCard`'s values immediately before the existing `POST` fires, keyed by card id, added only once per id, and never cleared by `continueReviewing()`. A new `resetSession()` handler, guarded by `isRating` (disabled while any rating request is in flight — reuses the existing flag) and a non-empty snapshot map: on confirm, `POST`s the snapshot entries to `/api/decks/${deckId}/review-reset`, then on success clears the snapshot map, resets `remainingDue`/`revealed`/`preview`/`rateError`, and re-runs the same due-cards fetch used on mount so the queue reflects the restored state. A "Reset session" button (visible whenever the snapshot map is non-empty) placed near the rating buttons during active review and near "Finish for now"/"Continue reviewing" in both session-complete states, gated behind a confirm dialog reusing `CardListPanel`'s native `<dialog>` pattern (`CardListPanel.tsx:145-190`), worded to state how many ratings will be undone.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck` (or equivalent script in `package.json`)
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Rate 2-3 cards, click "Reset session," confirm the dialog, and verify (via the cards list or by re-entering review) that those cards' due dates and FSRS state are back to what they were before the session.
- Rate a card, exhaust the batch to reach a "session complete — N more due" state, click "Continue reviewing" to fetch a new batch, rate one more card, then reset — verify cards from *both* batches are restored, proving the snapshot survives the re-fetch.
- Click a rating button, then immediately try to click "Reset session" before the rating request resolves — verify the reset button is disabled until the rating completes.
- With zero ratings made this mount, verify no "Reset session" button is rendered at all.
- After a successful reset, verify the panel shows the freshly reloaded due queue starting at card 1 (not the old, exhausted batch).

---

## Testing Strategy

### Manual Testing Steps:

1. Walk through Phase 1's manual verification steps against a real generated batch (paste text, generate, use both bulk buttons and individual toggles together).
2. Walk through Phase 2's manual verification steps against a real deck with several due cards, confirming DB state via a quick `select` in the Supabase dashboard or SQL editor before/after reset.
3. Confirm no regression in the untouched paths: single-item accept/reject and single-item rating still work exactly as before in both panels.

## Performance Considerations

Reset writes at most `SESSION_SIZE` (30, per `review.ts:7`) rows via `Promise.all`, well within the NFR's 500-cards-per-account ceiling — no batching/pagination concerns.

## Migration Notes

No schema changes — both phases work entirely within the existing `cards` table shape.

## References

- Related features: `context/changes/ai-generated-flashcard-review/plan.md` (S-02), `context/changes/spaced-repetition-review-session/plan.md` (S-05)
- Roadmap: `context/foundation/roadmap.md` (S-06)
- Key files: `src/components/decks/GenerateFlashcardsPanel.tsx`, `src/components/decks/ReviewSessionPanel.tsx`, `src/pages/api/decks/[id]/cards.ts`, `src/pages/api/decks/[id]/review.ts`, `src/lib/fsrs.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bulk accept/reject in candidate review

#### Automated

- [x] 1.1 Type checking passes — 17eb00d
- [x] 1.2 Linting passes — 17eb00d
- [x] 1.3 Build succeeds — 17eb00d

#### Manual

- [x] 1.4 "Accept all" marks every proposal accepted — 17eb00d
- [x] 1.5 "Reject all" marks every proposal rejected, including previously accepted ones — 17eb00d
- [x] 1.6 Individual toggle after a bulk action still works on a single item — 17eb00d
- [x] 1.7 Oversized/empty accepted proposal shows inline warning and blocks save — 17eb00d
- [x] 1.8 Normal save (no invalid proposals) still works unchanged — 17eb00d

### Phase 2: Reset an in-progress review session

#### Automated

- [x] 2.1 Type checking passes — 6b63f57
- [x] 2.2 Linting passes — 6b63f57
- [x] 2.3 Build succeeds — 6b63f57

#### Manual

- [x] 2.4 Reset restores rated cards' due dates/FSRS state — 6b63f57
- [x] 2.5 Reset restores cards across multiple "Continue reviewing" batches — 6b63f57
- [x] 2.6 Reset button disabled while a rating request is in flight — 6b63f57
- [x] 2.7 Reset button hidden when zero ratings made this mount — 6b63f57
- [x] 2.8 Post-reset, due queue reloads fresh starting at card 1 — 6b63f57
