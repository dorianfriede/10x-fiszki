# Spaced-repetition review session (S-05) Implementation Plan

## Overview

Implements FR-013/FR-014: a user can start a review session for a deck and rate their recall on each due card. Scheduling is computed by `ts-fsrs` (FSRS v6), self-hosted inside our own Astro API routes — a decision already made in `srs-library-research.md` and confirmed compatible with this codebase's Cloudflare/Astro stack in `research.md`. This plan adds the FSRS columns to `cards`, a review API route, and a new review-session UI (front/reveal/rate/advance) — none of which exist today.

Note: PRD FR-014's wording ("scheduling delegated to a third-party SRS service") predates the self-hosted decision. This mismatch was already identified and deliberately left unresolved in the PRD text (`prd.md` Open Question #1) rather than silently rewritten — this plan implements the self-hosted approach per the roadmap's resolution, not FR-014's literal wording.

## Current State Analysis

- `cards` (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:21-29`) has only `id, deck_id, front, back, source, created_at, updated_at` — no FSRS fields under any name.
- Ownership is enforced entirely by RLS via a `decks.user_id = auth.uid()` subquery on every `cards` policy (`:82-131`) — row-scoped, so new columns need no new policy.
- Two existing insert paths create cards without any scheduling concept: `src/pages/api/decks/[id]/cards.ts:131` (AI-accepted batch insert) and `src/pages/api/decks/[id]/cards/manual.ts:62` (manual create).
- No Zod anywhere — every route hand-rolls a type-guard validator (`isValidCardInput` pattern) and maps Postgres error codes (`23505`→409, `PGRST116`/empty→404, else→400).
- No flip/reveal interaction and no interactive rating component exist in the UI. `src/components/ui/button.tsx` defines CVA `variant`/`size` props that no current usage actually exercises.
- Confirmed via Context7 (`/open-spaced-repetition/ts-fsrs`): `createEmptyCard()`'s default state is `{ due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: State.New (0), last_review: undefined }`; `State` is `New=0/Learning=1/Review=2/Relearning=3`; `Rating`'s `Grade` values are `Again=1/Hard=2/Good=3/Easy=4`.

## Desired End State

A logged-in user opens `/decks/[id]/review`, sees the front of one due card at a time, reveals the back with computed interval hints on 4 rating buttons, rates it, and is auto-advanced to the next due card. When nothing is due, they see a single "nothing due" message. When the batch (up to 50 cards) is exhausted: if no due cards remain, they see a "session complete" message linking back to the deck; if due cards still remain beyond the cap, they see a "Session complete — N more cards are due" message with two choices — "Finish for now" (back to the deck) or "Continue reviewing" (fetches and starts a fresh batch of up to 50 more due cards in the same session). Rated cards persist updated FSRS scheduling state on their `cards` row so they become due again at the correct future time.

Verification: rate a card as each of the 4 grades in turn (across separate reviews) and confirm in Supabase Studio that `due`, `state`, `stability`, `difficulty`, `reps`, `lapses` change consistently with FSRS's documented behavior for that grade.

### Key Discoveries

- SQL `DEFAULT` clauses reproducing `createEmptyCard()`'s state mean the two existing insert paths need **zero code changes** — new cards get valid FSRS state automatically.
- The serialization boundary (`timestamptz` ↔ `Date`) is the one nuance `ts-fsrs-api-docs.md` glosses over (`research.md:33`) — both the API route and the client component must convert `due`/`last_review` between ISO string and `Date` explicitly.
- `state` fits a plain `smallint` (0–3, library-owned semantics) rather than a new Postgres enum — there's no independent domain meaning for this column beyond what `ts-fsrs`'s `State` enum already defines, and a `smallint` avoids keeping a second enum in sync with the library.
- The deck-scoped action-route precedent (`generate.ts`) is the shape to follow: `GET`+`POST /api/decks/[id]/review`, not a doubly-nested `cards/[cardId]/review.ts`.
- Sending `back` and raw FSRS fields to the client before "reveal" is not a security boundary — the rest of the app already renders front+back simultaneously everywhere (`CardListPanel.tsx`); reveal here is purely a UX device.

**Addendum (post-implementation, recorded during impl-review 2026-08-02)**: `scheduler` in `src/lib/fsrs.ts` and the client's local preview scheduler in `ReviewSessionPanel.tsx` both use `fsrs(generatorParameters({ enable_short_term: false }))` rather than the plain `fsrs()` specified below in Phase 2 — a deliberate deviation, not an oversight. Without it, a `New`/`Learning` card can resurface within minutes of being rated, which is awkward for this app's single-session review flow (no per-day new-card cap exists here per "What We're NOT Doing"). Disabling short-term steps makes every rating produce a day-scale interval instead. Both instances apply the override consistently, so client preview intervals match what the server actually commits.

## What We're NOT Doing

- No `review_log`/review-history table — only current FSRS state is persisted on `cards`, per the already-recorded decision in `srs-library-research.md` and this planning session's confirmation.
- No Anki-style separate "new cards per day" cap — due-card selection is a single `due <= now()` query, capped at a fixed session size.
- No session-size configurability — hardcoded at 50.
- No per-session rating-count summary screen — completion shows only a remaining-due-count check (see Phase 3), not stats like accuracy or a breakdown by grade.
- No weights-optimizer/personalized FSRS parameters — `fsrs()` runs with library defaults (`generatorParameters()`), matching `srs-library-research.md`.
- No changes to `FR-014`'s PRD wording — the third-party-vs-self-hosted mismatch is left as-is (already flagged in `prd.md`).

## Implementation Approach

Three phases, following the established `schema → backend/API → UI` pattern: add the FSRS columns with defaults so existing insert code is untouched, add the FSRS scheduling module + review route, then build the review-session UI on top. `ts-fsrs` is used on both sides of the API boundary — server-side for authoritative commits (`POST`), client-side for non-authoritative preview rendering (`repeat()` on the 4 rating buttons) — avoiding an extra network round-trip for preview data without weakening the server's authority over what actually gets persisted.

## Critical Implementation Details

**Timing & lifecycle**: The review batch is fetched on mount (up to 50 cards) and the session advances through it entirely client-side; only the `POST` per rating hits the server again. A card's `due` at the moment of `POST` may differ slightly from the batch's original snapshot if the session runs long, but this doesn't matter — `scheduler.next()` always uses the current server time, not the batch's fetch time. If the batch is exhausted and cards remain due beyond the 50-cap, choosing "Continue reviewing" re-fetches a fresh batch (same `GET`, same 50-cap) and resets the session's local state (`currentIndex` back to 0, new `cards` array, reveal state cleared) — this is the one point after mount where the batch is fetched again.

**Debug & observability**: There's no application logging in this codebase (see roadmap `## Baseline`) — verify FSRS state transitions directly via Supabase Studio's table view, not logs.

## Phase 1: Schema & types

### Overview

Adds the FSRS columns to `cards` with defaults matching `createEmptyCard()`, an index to support the due-card query, and regenerates the TypeScript row types.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/20260801130000_cards_fsrs_fields.sql`

**Intent**: Add FSRS scheduling fields to `cards` so every card (existing or new) has valid FSRS state without touching the existing insert code paths, add an index supporting the review query's access pattern, and drop the now-redundant single-column `deck_id` index it supersedes.

**Contract**:

```sql
alter table cards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column elapsed_days integer not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0 check (state between 0 and 3),
  add column last_review timestamptz;

create index cards_deck_id_due_idx on cards (deck_id, due);

-- cards_deck_id_idx (deck_id) is now a strict prefix subset of the composite
-- index above and gives no read benefit while still costing a write on every
-- insert/update — drop it.
drop index cards_deck_id_idx;
```

No RLS policy changes — the existing `cards_*_own` policies (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:82-131`) are row-scoped via the `decks` ownership subquery and already cover these new columns.

#### 2. Regenerated types

**File**: `src/db/database.types.ts`

**Intent**: Bring the generated `cards` Row/Insert/Update types in sync with the new columns.

**Contract**: Run `npm run db:types` (`supabase gen types typescript --linked`) — do not hand-edit this file.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against the local Supabase stack (`npx supabase db reset` or equivalent)
- `npm run db:types` completes and `src/db/database.types.ts`'s `cards` types include all 10 new fields
- `npm run lint` passes

#### Manual Verification:

- In Supabase Studio, confirm the 10 new columns exist on `cards` with the expected defaults
- Create a card via the existing "Generate" or "Manual create" flow and confirm its new row has `due ≈ now()`, `state = 0`, all other numeric fields `= 0`, `last_review = null` — proving the existing insert paths needed no code changes
- Re-run `supabase/tests/verify-rls-isolation.sql` and confirm cross-user isolation still holds with the new columns present

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Server-side FSRS integration

### Overview

Adds the `ts-fsrs` dependency, a small scheduling module, and the `GET`/`POST` review API route.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `ts-fsrs` as a runtime dependency.

**Contract**: `npm install ts-fsrs`.

#### 2. FSRS scheduling module

**File**: `src/lib/fsrs.ts` (new)

**Intent**: One scheduler instance with library defaults, plus the DB-row↔`Card` conversion that bridges the `timestamptz`/`Date` serialization boundary. `toFsrsCard`/`fromFsrsCard` are pure functions with no server-only dependency, so they're imported on both sides of the API boundary: the API route uses them for the authoritative, commit-side `POST`, and `ReviewSessionPanel.tsx` (Phase 3) imports `toFsrsCard` directly for its client-side, non-authoritative preview — one conversion function, not two.

**Contract**: Exports `scheduler` (`fsrs()`, no `generatorParameters()` overrides) and two pure functions, `toFsrsCard(row: Tables<"cards">): Card` and `fromFsrsCard(card: Card): { due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number; learning_steps: number; reps: number; lapses: number; state: number; last_review: string | null }`.

```typescript
import { fsrs, type Card } from "ts-fsrs";
import type { Tables } from "@/db/database.types";

export const scheduler = fsrs();

export function toFsrsCard(row: Tables<"cards">): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}
```

(`fromFsrsCard` is the routine reverse mapping — no snippet needed.)

#### 3. Review API route

**File**: `src/pages/api/decks/[id]/review.ts` (new)

**Intent**: `GET` returns the current due-card batch with everything the client needs to render and preview locally; `POST` commits a rating and persists the resulting FSRS state.

**Contract**:

- `GET`: auth check → validate `id` → `select *` from `cards` where `deck_id = id and due <= now()`, `order by due asc`, `limit 50` (`const SESSION_SIZE = 50`) → respond `{ cards: [...] }`, each card including `front`, `back`, and every FSRS field as stored (ISO strings for `due`/`last_review`).

  **Addendum (post-implementation, recorded during impl-review 2026-08-02)**: `SESSION_SIZE` was shrunk to `30` for shorter, easier review sessions — still comfortably under the NFR's 500-cards-per-account ceiling. Treat `30` as the current intended value; the `limit 50` above is superseded.
- `POST`: body `{ cardId: string, grade: number }`, validated by a hand-rolled `isValidGrade` guard (`Number.isInteger(grade) && grade >= 1 && grade <= 4`), matching `isValidCardInput`'s convention — no Zod. Load the row via `.eq("id", cardId).eq("deck_id", id)`; empty result → 404 (ownership + existence combined, per the existing convention of treating an empty RLS-filtered result as not-found). Reconstruct with `toFsrsCard`, call `scheduler.next(card, new Date(), grade)`, persist `fromFsrsCard(result.card)` via `.update(...)` on the same row. Then run one more `count: "exact", head: true` query on `cards` where `deck_id = id and due <= now()` (same pattern as `cards.ts:142`) and respond with `{ due, remainingDue: count ?? 0 }` — `remainingDue` lets the client show an accurate "more cards are due" prompt after the last card in a batch without a separate round-trip.
- Error mapping follows the existing convention: not-found/empty → 404, else → 400.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes (type-checks `src/lib/fsrs.ts` and the new route against `ts-fsrs`'s types)

#### Manual Verification:

- `GET /api/decks/<id>/review` against a deck with due cards returns a batch (≤50) with all FSRS fields present
- `POST /api/decks/<id>/review` with a valid `{cardId, grade}` updates that row's `due`/`state`/`stability`/etc. in Supabase Studio consistent with FSRS's documented behavior for that grade, and the response's `remainingDue` matches the deck's actual count of still-due cards
- A `cardId` belonging to another user's deck returns 404
- An invalid grade (e.g. `0`, `5`, `"good"`, missing) returns 400

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Review session UI

### Overview

Adds the review page and the interactive session panel: fetch, reveal-with-preview, rate, auto-advance, and the batch-completion states (fully caught up, or more due with a finish/continue choice).

### Changes Required:

#### 1. Review page

**File**: `src/pages/decks/[id]/review.astro` (new)

**Intent**: Server-fetch the deck by `id`, redirect to `/decks?error=...` if missing, and mount the review panel — mirrors `src/pages/decks/[id]/generate.astro:1-28` exactly.

**Contract**: Renders `<ReviewSessionPanel deckId={deck.id} client:load />` inside `Layout`.

#### 2. Review session panel

**File**: `src/components/decks/ReviewSessionPanel.tsx` (new)

**Intent**: Drive the full client-side review loop against the API route from Phase 2.

**Contract**:

- On mount: `GET /api/decks/${deckId}/review`; store the batch and a `currentIndex`. Loading/error states follow `CardListPanel.tsx`'s pattern (`isLoading`, `loadError`, mounted-ref guard).
- Empty batch → the unified "No cards due for review right now" message + link back to the deck (covers both an empty deck and an all-caught-up deck with one code path, per this session's decision).
- Per card: render `front` only, plus a "Show answer" `Button`. On click: reveal `back`, and reconstruct the current card via `toFsrsCard` imported from `@/lib/fsrs` (same conversion the API route uses) to call `scheduler.repeat(card, new Date())` — using a local `fsrs()` instance created in this component, not the server-side `scheduler` singleton, since this runs client-side and is preview-only; the server independently recomputes and commits on `POST`, so this can't affect the persisted schedule — and label each of the 4 rating buttons with its resulting interval via a small local `formatInterval(due: Date, now: Date): string` helper.
- 4 rating buttons use `Button`'s `variant` prop (e.g. `destructive` for Again, `secondary` for Hard, `default` for Good, `outline` for Easy) — the first real usage of the CVA variants per CLAUDE.md's documented convention.
- On rating click: `POST /api/decks/${deckId}/review` with `{cardId, grade}`; on success, advance `currentIndex` and reset reveal state. If that was the last card in the batch, read `remainingDue` from the same `POST` response (Phase 2 computes it server-side right after the update, avoiding an extra request) and branch:
  - `remainingDue === 0` → show "Session complete" message + link back to the deck.
  - `remainingDue > 0` → show "Session complete — {remainingDue} more cards are due" with two actions: **"Finish for now"** (link back to the deck) and **"Continue reviewing"** (re-fetch a fresh batch via the same `GET` used on mount, reset `currentIndex` to 0 and clear reveal state, then resume the loop).
- On failure (non-OK response or network error): set a `rateError` string state (mirroring `CardListPanel.tsx`'s `editSaveError`/`deleteError` pattern) and render it inline below the rating buttons; do **not** advance `currentIndex` — the card stays revealed with its rating buttons re-enabled so the user can retry the same rating.

#### 3. Deck list entry point and lint config (addendum, recorded during impl-review 2026-08-02)

**Files**: `src/pages/decks/index.astro`, `eslint.config.js`

**Intent**: Not originally listed, but required for the feature to actually be reachable and lint-clean. `decks/index.astro` needed a "Review" link (mirroring the existing "Add card" link) pointing to `/decks/[id]/review` on each deck row. `eslint.config.js` needed `review.astro` added to the existing per-page `astro-return-workaround` ignore list, matching the same entry already present for `generate.astro`, `cards/new.astro`, and `index.astro`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Starting a review on a deck with due cards shows the front only, reveals the back + interval-labeled rating buttons on "Show answer", and auto-advances after each rating
- Rating every card in a batch with no remaining due cards shows the plain "Session complete" message
- Rating every card in a batch while due cards remain beyond the cap shows "Session complete — N more cards are due" with "Finish for now" and "Continue reviewing" actions; "Continue reviewing" fetches a fresh batch and resumes the loop from card 1
- Starting a review on a deck with zero due cards (or zero cards at all) shows the unified empty-state message
- Rating a card and re-opening the deck's review later reflects the expected next `due` for the grade chosen (spot-check via Supabase Studio)
- "Show answer" and the 4 rating buttons are real focusable `<button>` elements usable via keyboard, not click-anywhere regions
- Simulate a rating POST failure (e.g. temporarily block the network request) and confirm the panel shows an inline error, keeps the card revealed, and lets you retry the same rating without losing your place

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

No test framework is configured in this project (per `CLAUDE.md`) — verification is manual + automated lint/build only, matching S-01..S-04's precedent.

### Integration Tests:

N/A — same reason as above.

### Manual Testing Steps:

1. Generate or manually add several cards to a deck; confirm they're immediately due (fresh `createEmptyCard()` state) and appear in a review session.
2. Run through a full session: reveal → rate (try all 4 grades across different cards) → confirm auto-advance → reach the completion message.
3. Rate a card, then call `GET /api/decks/<id>/review` again immediately after — confirm the just-rated card is due again only at its new FSRS-computed `due` time, not immediately (unless the grade was `Again`, which typically re-queues it sooner).
4. Start a review on a deck with no cards, and separately on a deck whose cards are all not-yet-due — confirm both show the same empty-state message.
5. Attempt to `POST` a rating for a card belonging to a different user's deck (via direct API call) — confirm 404.

## Performance Considerations

The `(deck_id, due)` index supports the review query's access pattern directly. The 30-card session cap (shrunk from an original 50 during implementation — see Phase 2 addendum) keeps both the query and the client-side render bounded well under the NFR's 500-cards-per-account ceiling.

## Migration Notes

The new columns are additive with `not null default` values, so the migration is safe to apply against any existing `cards` rows (from S-02/S-03/S-04 testing) without a separate backfill step — the defaults themselves are the backfill.

## References

- Related research: `context/changes/spaced-repetition-review-session/research.md`
- Library decision: `context/changes/spaced-repetition-review-session/srs-library-research.md`
- API reference: `context/changes/spaced-repetition-review-session/ts-fsrs-api-docs.md`
- Deck-scoped action-route precedent: `src/pages/api/decks/[id]/generate.ts`
- Astro page + `client:load` panel convention: `src/pages/decks/[id]/generate.astro:1-28`
- Card CRUD route conventions: `src/pages/api/decks/[id]/cards/[cardId].ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & types

#### Automated

- [x] 1.1 Migration applies cleanly against the local Supabase stack — c4b90d6
- [x] 1.2 `npm run db:types` completes with all 10 new fields present — c4b90d6
- [x] 1.3 `npm run lint` passes — c4b90d6

#### Manual

- [x] 1.4 New columns exist on `cards` with expected defaults (Supabase Studio)
- [x] 1.5 New card via existing flows gets valid default FSRS state with no code changes
- [x] 1.6 `verify-rls-isolation.sql` still passes with new columns present

### Phase 2: Server-side FSRS integration

#### Automated

- [x] 2.1 `npm run lint` passes — 4ba9eba
- [x] 2.2 `npm run build` passes — 4ba9eba

#### Manual

- [x] 2.3 `GET /api/decks/<id>/review` returns a correct due-card batch (≤50) — 4ba9eba
- [x] 2.4 `POST /api/decks/<id>/review` persists FSRS state correctly for a valid rating, and `remainingDue` in the response matches the deck's actual due count — 4ba9eba
- [x] 2.5 Cross-user `cardId` returns 404 — 4ba9eba
- [x] 2.6 Invalid grade returns 400 — 4ba9eba

### Phase 3: Review session UI

#### Automated

- [x] 3.1 `npm run lint` passes — dfa036b
- [x] 3.2 `npm run build` passes — dfa036b

#### Manual

- [x] 3.3 Full reveal → rate → auto-advance loop works end to end — dfa036b
- [x] 3.4 Plain "Session complete" shows after the last card when no due cards remain — dfa036b
- [x] 3.5 "Session complete — N more due" with Finish/Continue actions shows when due cards remain beyond the cap; Continue fetches a fresh batch and resumes — dfa036b
- [x] 3.6 Unified empty-state message shows for empty/no-due decks — dfa036b
- [x] 3.7 Rated card's next `due` matches the chosen grade's expected FSRS outcome — dfa036b
- [x] 3.8 Reveal and rating controls are keyboard-usable — dfa036b
- [x] 3.9 A failed rating POST shows an inline error, keeps the card revealed, and allows retry — dfa036b
