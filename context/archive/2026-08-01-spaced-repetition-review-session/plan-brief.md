# Spaced-repetition review session — Plan Brief

> Full plan: `context/changes/spaced-repetition-review-session/plan.md`
> Research: `context/changes/spaced-repetition-review-session/research.md`

## What & Why

Implements FR-013/FR-014: a user starts a review session for a deck and rates their recall on each due card. Scheduling is computed by `ts-fsrs` (FSRS v6), self-hosted in our own Astro API routes — the SRS-library Unknown blocking S-05 was resolved 2026-08-01 (`srs-library-research.md`), unblocking this plan.

## Starting Point

`cards` has no scheduling fields at all — no `due`, `stability`, `state`, etc. Two existing routes create cards (`cards.ts` for AI-accepted batches, `manual.ts` for manual entries) with no concept of scheduling. No flip/reveal UI or rating component exists anywhere; front and back are always shown together today.

## Desired End State

A user opens `/decks/[id]/review`, sees one due card's front at a time, reveals the back with 4 rating buttons labeled with their computed next-interval, rates it, and is auto-advanced. Nothing-due and session-complete states each show one simple message with a link back to the deck.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Review-history table | Skip — persist only current FSRS state on `cards` | Matches the already-recorded decision that a review log is optional, and keeps scope tight against the deadline | Research + Plan |
| Due-card selection & session size | `due <= now()`, ordered by `due`, capped at 50 | Single simple query; no separate new/review caps needed for v1 | Plan |
| `state` column type | `smallint` (0-3), not a new Postgres enum | The value's semantics are entirely owned by `ts-fsrs`'s `State` enum, not our schema | Research + Plan |
| Reveal/advance UX | "Show answer" button, auto-advance after rating | Fastest loop, matches standard FSRS/Anki-style review apps | Plan |
| Rating preview hints | Show computed interval per button via client-side `repeat()` | This is exactly what `repeat()` is for; avoids an extra network round-trip since preview doesn't need server authority | Plan |
| Empty state | One unified "nothing due" message | Covers empty-deck and all-caught-up with a single query/code path | Plan |
| Session completion | Simple message, no per-rating summary | Minimal — no client-side count tracking needed | Plan |
| Route shape | Deck-scoped `GET`/`POST /api/decks/[id]/review` | Matches the existing `generate.ts` action-route precedent | Research + Plan |
| First thing to cut if time runs short | Rating-preview interval hints | Purely additive UI, isolated to one component — doesn't touch schema/API/session logic | Plan |

## Scope

**In scope:**
- Migration adding 10 FSRS fields to `cards` + supporting index
- `GET`/`POST /api/decks/[id]/review` API route
- Review-session UI: fetch, reveal-with-preview, rate, auto-advance, empty/completion states

**Out of scope:**
- Review-history/`review_log` table, review stats or streaks
- Anki-style separate new-card daily cap
- Configurable session size
- Personalized FSRS parameter tuning (weights optimizer)
- Rewriting FR-014's PRD wording (self-hosted vs. "third-party" mismatch is already flagged, not resolved here)

## Architecture / Approach

`ts-fsrs` runs on both sides of the API boundary: server-side in the `POST` handler for authoritative commits, and client-side (bundled directly into `ReviewSessionPanel.tsx`) for non-authoritative preview rendering on the rating buttons — avoiding an extra round-trip without weakening the server's control over what's actually persisted. SQL `DEFAULT`s reproducing `createEmptyCard()`'s initial state mean the two existing card-creation routes need zero changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & types | FSRS columns + index + regenerated types | Getting the SQL defaults exactly right so existing insert paths stay untouched |
| 2. Server-side FSRS integration | `GET`/`POST` review route, scheduling module | Serialization boundary (`timestamptz` ↔ `Date`) bugs |
| 3. Review session UI | Full reveal/rate/advance loop | Client-side preview drifting from server-side commit behavior |

**Prerequisites:** F-01 and S-01 (both `impl_reviewed`) — already satisfied.
**Estimated effort:** ~1 session across 3 phases (schema, API, UI), each independently verifiable before moving on.

## Open Risks & Assumptions

- Assumes a local Supabase stack (or linked cloud project) is available to apply the migration and regenerate types — same assumption S-01..S-04 already depend on.
- Assumes `ts-fsrs`'s browser bundle size is acceptable to ship client-side for the preview feature; if it turns out to be heavy, the fallback (per the Priority decision) is to drop preview hints entirely rather than optimize the bundle.

## Success Criteria (Summary)

- A user can start a review session, see due cards one at a time, reveal and rate each, and reach a completion message.
- Rated cards are correctly rescheduled per FSRS and reappear as due at the right time.
- A deck with nothing due shows a clear message instead of an empty or broken screen.
