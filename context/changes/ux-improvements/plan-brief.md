# UX Improvements — Plan Brief

> Full plan: `context/changes/ux-improvements/plan.md`

## What & Why

User can select multiple AI-generated candidate cards during the S-02 review step and accept/reject them as a batch, and can reset an in-progress spaced-repetition review session (S-05) back to its starting state instead of abandoning it. Both gaps were identified by the user during S-01–S-05 implementation, not from a documented PRD requirement.

## Starting Point

Both features already ship and work: candidate review (`GenerateFlashcardsPanel.tsx`) supports only per-item accept/reject with a single batch save at the end; the review session (`ReviewSessionPanel.tsx`) commits every rating immediately to the card's FSRS fields, with no session concept, history table, or undo mechanism anywhere in the schema.

## Desired End State

In candidate review, "Accept all" / "Reject all" buttons set every proposal's decision in one click, with an inline warning if a bulk-accepted card is too long to save. In the review session, a "Reset session" button restores every card rated since the page loaded — across any number of batches — to its exact pre-rating state, then reloads the due queue fresh.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Reset semantics | Restore touched cards to their pre-session snapshot (true undo) | The client already receives each card's full FSRS state before rating it, so a snapshot map gives a real undo without a new history table. |
| Session boundary | Cards rated since the review page was mounted (this page load) | Matches how the rest of the feature already works — no new persistence, but means a refresh ends the "session." |
| Bulk selection UX | Global "Accept all" / "Reject all" buttons, no checkboxes | No checkbox/multi-select primitive exists in the codebase yet; global buttons need none. |
| Bulk action scope | Applies to all proposals, including already-decided ones | User's explicit choice — simpler mental model ("accept all" means all), accepting the risk of overwriting individual decisions. |
| Bulk save failure handling | Keep the atomic all-or-nothing save; surface which card(s) block it client-side | No API contract change to an already-shipped endpoint; validation is duplicated client-side instead. |
| Reset trigger | Visible button + confirm dialog | Reset is destructive to session progress — matches the app's only existing confirm-before-destructive-action pattern. |
| In-flight rating during reset | Reset button disabled while a rating request is in flight | Prevents a race between a rating write and a restore write to the same card. |
| Priority | Both features equal priority, no pre-agreed cut | Roadmap S-06 bundles both with no internal split. |

## Scope

**In scope:**
- Bulk accept/reject buttons in candidate review, plus client-side pre-save validation surfacing
- New `review-reset` API route + cross-batch session snapshot + "Reset session" UI in the review panel

**Out of scope:**
- Checkbox-based arbitrary subset selection in candidate review
- Any change to the existing atomic `POST /api/decks/[id]/cards` save contract
- Proposal text editing
- A rating-history/review-log table or true cross-mount session persistence
- A "reset decisions" concept in the candidate review flow itself

## Architecture / Approach

Both phases are additive, client-state-first changes to existing components. Phase 1 needs no new endpoint. Phase 2 adds one small API route mirroring the existing rating endpoint's auth/ownership pattern, plus a client-side snapshot map (keyed by card id) that survives the panel's existing "Continue reviewing" re-fetch — this snapshot, not the visible card list, is what reset actually restores from.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bulk accept/reject | "Accept all"/"Reject all" buttons + inline validation warnings in candidate review | Overwriting individual decisions was an explicit user choice — could still surprise a user who forgot they'd hand-picked some cards |
| 2. Session reset | New restore endpoint + cross-batch snapshot + "Reset session" button in review panel | Snapshot must survive re-fetches correctly — the one real state-sequencing bug risk in this plan |

**Prerequisites:** F-01, S-02, and S-05 all `impl_reviewed` and in place — no additional setup needed.
**Estimated effort:** ~1 session, 2 phases (roughly half a day each — small, self-contained component + one new API route).

## Open Risks & Assumptions

- Reset only covers cards rated during the current page mount — a refresh mid-session silently forfeits the ability to reset (accepted tradeoff, not a bug).
- Reset's restore writes are not transactional across cards (`Promise.all` of independent updates) — a partial failure is possible in theory; re-running reset is idempotent and safe if it happens.
- "Accept all" / "Reject all" overwriting already-decided proposals was the user's explicit choice over the safer "undecided only" default — flagged here since it's a deliberate deviation from the safest option.

## Success Criteria (Summary)

- A user can bulk-set every candidate's decision in one click and gets a clear, specific warning before a bulk save would fail on an oversized card.
- A user can undo every rating made this session (across any number of batches) and land back at a fresh due queue, with no way to race a reset against an in-flight rating.
