---
project: "10xFiszki"
version: 1
status: draft
created: 2026-07-28
updated: 2026-08-01
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xFiszki

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Manual flashcard creation is slow enough that people abandon spaced repetition entirely, even though they know it works. 10xFiszki lets a user paste any text and get an AI-generated deck of flashcards in seconds instead of hours, with a review step (accept/reject each proposal) before anything lands in their deck. Manual card creation stays available as a fallback for cases the AI misses.

## North star

**S-02: User pastes text, gets AI-generated flashcard proposals for a deck, and accepts or rejects each before they're saved** — this is the *north star*: the smallest end-to-end flow whose success proves the product works, here meaning whether AI-generated cards clear the 75% acceptance bar that the whole product's value proposition rests on. Everything else only matters if this works, so it's sequenced as early as its prerequisites (F-01, S-01) allow.

## At a glance

| ID   | Change ID                          | Outcome (user can …)                                              | Prerequisites | PRD refs               | Status  |
| ---- | ----------------------------------- | ------------------------------------------------------------------ | -------------- | ----------------------- | ------- |
| F-01 | `deck-card-schema-foundation`       | (foundation) decks/cards schema + row-level isolation exist        | —               | NFR (data isolation), Access Control | in-progress |
| S-01 | `deck-management`                   | create, view, and delete a named deck                              | F-01            | FR-004, FR-005, FR-006  | in-progress |
| S-02 | `ai-generated-flashcard-review`     | paste text, get AI-generated cards, accept/reject each into a deck | F-01, S-01      | US-01, FR-007, FR-008   | in-progress |
| S-03 | `manual-flashcard-creation`         | manually create a flashcard (front/back) in a deck                 | F-01, S-01      | FR-009                  | in-progress |
| S-04 | `card-browsing-and-editing`         | browse, edit, and delete cards in a deck                           | F-01, S-01      | FR-010, FR-011, FR-012  | in-progress |
| S-05 | `spaced-repetition-review-session`  | start a review session and rate recall per card                    | F-01, S-01      | FR-013, FR-014          | ready |
| S-06 | `ux-improvements`                   | bulk accept/reject candidates during AI review; reset an in-progress review session | F-01            | — (not in PRD v1)       | planned |
| S-07 | `ui-polish`                          | (cross-cutting) experience a visually polished UI across all existing screens | F-01, S-01, S-02, S-03, S-04, S-05 | — (not in PRD v1) | planned |
| S-08 | `account-deletion`                   | delete their account, data retained 30 days before permanent purge  | F-01            | — (not in PRD v1)       | planned |

## Streams

Navigation aid — groups items that share a prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                        | Chain                        | Note                                                                 |
| ------ | ----------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| A      | Data foundation & generation loop | `F-01` → `S-01` → `S-02`     | Carries the north star; sequenced first under the speed priority.     |
| B      | Manual entry & card curation  | `S-03` / `S-04`                | Both join Stream A at `S-01`; independent of AI generation, so they can run in parallel with S-02. |
| C      | Review & scheduling            | `S-05`                          | Joins Stream A at `S-01`; SRS library choice resolved (`ts-fsrs`, self-hosted) — no longer blocked. |
| D      | UX & account lifecycle        | `S-06` / `S-08`                | Both join Stream A at `F-01` only; independent of AI generation and deck management, so they can run in parallel with S-02/S-03/S-04/S-05. |
| E      | Cross-cutting polish           | `S-07`                          | Joins after S-01–S-05 all exist — polish needs every existing screen built first, so it's sequenced last among current slices by design, not by priority. |

## Baseline

What's already in place in the codebase as of `2026-07-28` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React wired (`astro.config.mjs`), Tailwind/shadcn primitives; real auth pages/components exist (`src/pages/auth/*`, `src/components/auth/*`), no deck/card/review UI yet.
- **Backend / API:** partial — Astro SSR (`output: "server"`) with Cloudflare adapter wired; only `src/pages/api/auth/*` routes exist — no deck/card/AI-generation/review routes.
- **Data:** partial — Supabase client wired (`src/lib/supabase.ts`), but no schema/migrations and no tables (decks, cards, reviews) exist anywhere. This gap is what F-01 closes.
- **Auth:** present — Supabase Auth, `src/middleware.ts` session check + `PROTECTED_ROUTES`, signin/signup/signout API routes and forms. **This already satisfies FR-001, FR-002, FR-003 (must-have) in full — no roadmap item is created for auth; it is not re-scaffolded and is not a blocker for any slice below.**
- **Deploy / infra:** present — `wrangler.jsonc`, `@astrojs/cloudflare`, CI `deploy` job in `.github/workflows/ci.yml` gated on push to `main`.
- **Observability:** partial — only Cloudflare's platform-level `observability.enabled: true` flag; no application-level logging/error tracking. Not promoted to a Foundation — given the speed priority and the 13-day window to the hard deadline, this is intentionally deferred (see `## Parked`).

## Foundations

### F-01: Decks/cards schema and row-level isolation

- **Outcome:** (foundation) A Supabase Postgres schema for `decks` and `cards` exists with migrations, and row-level security policies guarantee a user can only read/write their own rows.
- **Change ID:** `deck-card-schema-foundation`
- **PRD refs:** NFR ("No user's cards, decks, or review history are accessible to any other user under any circumstances"), Access Control section
- **Unlocks:** S-01, S-02 (north star), S-03, S-04, S-05 — every slice needs a persisted deck/card to exist before it can do anything real.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** — (PRD Open Question #3, deck deletion behavior, resolved during roadmap generation: deleting a deck cascade-deletes its cards and their SRS scheduling state. The cards table's foreign key should be defined accordingly.)
- **Risk:** Every downstream slice needs this schema to persist real data — sequencing it first avoids retrofitting isolation policies after slices are already built against an ad-hoc shape.
- **Status:** in-progress (change `impl_reviewed`, not yet archived)

## Slices

### S-01: User can create, view, and delete decks

- **Outcome:** user can create a named deck, see a list of their decks, and delete a deck.
- **Change ID:** `deck-management`
- **PRD refs:** FR-004, FR-005, FR-006
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Every other slice needs a deck to target (generate into, add cards to, review). Sequenced immediately after F-01 so the north star (S-02) isn't waiting on anything avoidable.
- **Status:** in-progress (change `impl_reviewed`, not yet archived)

### S-02: User pastes text, generates AI flashcards, and accepts/rejects each into a deck

- **Outcome:** user can paste study text, trigger AI generation for a selected deck, see generated card proposals, and accept or reject each before it's saved.
- **Change ID:** `ai-generated-flashcard-review`
- **PRD refs:** US-01, FR-007, FR-008
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - AI generation prompt design (PRD Open Question #2): what instructions produce a 75%+ acceptance rate? Owner: user. Block: no (FR-007 is correct as-is; prompt design is an implementation-time iteration, not a planning blocker).
- **Risk:** This is the north star — the core hypothesis test (does AI-generated quality clear the 75% acceptance bar). Placed as early as F-01/S-01 allow rather than deferred for symmetric ordering, since under the speed priority nothing else matters if this doesn't work.
- **Status:** in-progress (change `impl_reviewed`, not yet archived)

### S-03: User can manually create a flashcard in a deck

- **Outcome:** user can manually create a flashcard (front and back) within a deck.
- **Change ID:** `manual-flashcard-creation`
- **PRD refs:** FR-009
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Fully independent of AI generation — can be built in parallel with S-02 with no contention, and doubles as a fallback path if AI quality is initially disappointing.
- **Status:** in-progress (change `impl_reviewed`, not yet archived)

### S-04: User can browse, edit, and delete cards in a deck

- **Outcome:** user can browse all cards in a deck, edit a card's front/back, and delete a card.
- **Change ID:** `card-browsing-and-editing`
- **PRD refs:** FR-010, FR-011, FR-012
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Only needs the schema and a deck to exist, not a specific card-creation path — can proceed in parallel with S-02/S-03 rather than waiting for either to finish.
- **Status:** in-progress (change `impl_reviewed`, not yet archived)

### S-05: User can run a spaced-repetition review session

- **Outcome:** user can start a review session for a deck and rate their recall on each card; scheduling is computed by the `ts-fsrs` library, self-hosted in our own Astro API routes (not delegated to an external hosted SRS service — see decision below).
- **Change ID:** `spaced-repetition-review-session`
- **PRD refs:** FR-013, FR-014
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - ~~Which third-party SRS service?~~ (PRD Open Question #1) → resolved 2026-08-01: self-hosted `ts-fsrs` (FSRS v6), not a hosted third-party API. Rating scale is FSRS's native 4-button scale (Again/Hard/Good/Easy), so FR-014's review UI can now be finalized against that contract. Full research and rationale: `context/changes/spaced-repetition-review-session/srs-library-research.md`.
- **Risk:** Was genuinely blocked on an external decision; resolved by choosing a self-hosted library instead of a hosted vendor, which also sidesteps the early-access/pricing risk of the one hosted option found (SuperMemo API).
- **Status:** ready

### S-06: User has bulk actions during candidate review and can reset a review session

- **Outcome:** user can select multiple AI-generated candidate cards during the S-02 review step and accept/reject them as a batch, and can reset an in-progress spaced-repetition review session (S-05) back to its starting state instead of abandoning it.
- **Change ID:** `ux-improvements`
- **PRD refs:** — not in PRD v1; gap identified by the user during S-01–S-05 implementation, not a documented FR.
- **Prerequisites:** F-01
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Extends UI already built by S-02 (candidate review) and S-05 (review session) — building it before those land risks rework against a moving target.
- **Status:** planned

### S-07: User experiences a visually polished UI

- **Outcome:** (cross-cutting) user experiences a visually refined, consistent UI across every existing screen (decks, generation/review, manual creation, card browsing, review session) — no new functional capability, purely presentation.
- **Change ID:** `ui-polish`
- **PRD refs:** — not in PRD v1; not tied to any FR/NFR, a quality/perception improvement requested outside the original scope.
- **Prerequisites:** F-01, S-01, S-02, S-03, S-04, S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Depends on every other slice's UI existing first, since there's nothing to polish otherwise — sequenced last among current slices by design.
- **Status:** planned

### S-08: User can delete their account with a 30-day retention window

- **Outcome:** user can request account deletion; the account and its data (decks, cards, review history) are retained for 30 days before permanent purge, giving the user a window to reverse the request.
- **Change ID:** `account-deletion`
- **PRD refs:** — not in PRD v1; relates to Access Control / Auth (FR-001–FR-003) but no FR covers deletion or retention specifically.
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Where the 30-day countdown/purge job runs (cron, Cloudflare scheduled worker, manual admin trigger) is undecided. Owner: user. Block: no (schema/UI can be built against a `deleted_at` timestamp regardless of purge mechanism).
- **Risk:** Introduces a scheduled/background deletion mechanism not present anywhere else in the codebase — the purge job is new infrastructure, not just a new screen.
- **Status:** planned

## Backlog Handoff

| Roadmap ID | Change ID                          | Suggested issue title                                          | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------------ | ----------------------------------------------------------------- | ----------------------- | ----- |
| F-01       | `deck-card-schema-foundation`        | Design decks/cards schema with row-level isolation                 | n/a (already planned)  | Implemented + impl-reviewed; not yet archived |
| S-01       | `deck-management`                    | Deck create/view/delete                                             | n/a (already planned)  | Implemented + impl-reviewed; not yet archived |
| S-02       | `ai-generated-flashcard-review`      | AI flashcard generation with per-card accept/reject (north star)    | n/a (already planned)  | Implemented + impl-reviewed; not yet archived |
| S-03       | `manual-flashcard-creation`          | Manual flashcard creation                                            | n/a (already planned)  | Implemented + impl-reviewed; not yet archived |
| S-04       | `card-browsing-and-editing`          | Card browse/edit/delete                                              | n/a (already planned)  | Implemented + impl-reviewed; not yet archived |
| S-05       | `spaced-repetition-review-session`   | Spaced-repetition review session                                     | yes                     | SRS library decision resolved (`ts-fsrs`, self-hosted) — ready for `/10x-plan` |
| S-06       | `ux-improvements`                    | Bulk accept/reject in candidate review + reset review session       | no                      | Newly added; not in PRD v1 |
| S-07       | `ui-polish`                          | Cross-cutting UI polish pass                                         | no                      | Blocked until S-01–S-05 are all implemented; not in PRD v1 |
| S-08       | `account-deletion`                   | Account deletion with 30-day retention                               | no                      | Purge mechanism (cron/scheduled worker) undecided; not in PRD v1 |

## Open Roadmap Questions

None currently open at the cross-cutting level — all three of the PRD's `## Open Questions` map cleanly to a single roadmap item's Unknowns rather than spanning multiple slices:

1. ~~Deck deletion behavior (cascade vs. archive)~~ → resolved during roadmap generation (2026-07-28): cascade delete. Was embedded in **F-01**'s Unknowns; F-01 is now unblocked (`Status: ready`).
2. AI generation prompt design → embedded in **S-02**'s Unknowns. Owner: user. Block: no.
3. ~~Which third-party SRS service~~ → resolved 2026-08-01: self-hosted `ts-fsrs` library, not a hosted third-party API. Was embedded in **S-05**'s Unknowns; S-05 is now unblocked (`Status: ready`). Details: `context/changes/spaced-repetition-review-session/srs-library-research.md`.
4. **Account-deletion purge mechanism.** Where the 30-day countdown/purge job runs (cron, Cloudflare scheduled worker, manual admin trigger). Embedded in **S-08**'s Unknowns. Owner: user. Block: no.

## Parked

- **Custom SRS algorithm (SM-2, FSRS, or equivalent).** Why parked: PRD Non-Goals — scheduling is fully delegated to a third-party SRS service; building and tuning a scheduling algorithm is a separate domain problem.
- **File import (PDF, DOCX, image, URL parsing).** Why parked: PRD Non-Goals — v1 is paste-only; scope containment.
- **Sharing or collaborative features (public decks, shared collections, team workspaces).** Why parked: PRD Non-Goals — single-user-per-account MVP; multi-user coordination is a separate product surface.
- **Mobile app or mobile-optimized experience.** Why parked: PRD Non-Goals — desktop browsers only for the MVP.
- **Integrations with external learning platforms (LMS, Notion, etc.).** Why parked: PRD Non-Goals — integration development adds scope before the product's core value (AI-generated cards people actually accept) is proven with real users.
- **Application-level observability (error tracking, structured logging, dashboards beyond Cloudflare's built-in flag).** Why parked: not required by any must-have FR or NFR, and the 13-day window to the hard deadline (`2026-08-10`) doesn't leave room for it under the speed priority. Platform-level Cloudflare observability (already present) is the floor for launch.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
