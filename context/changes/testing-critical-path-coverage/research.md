---
date: 2026-08-02T23:40:24+02:00
researcher: Claude Sonnet 5
git_commit: 21fbe1e179595c208ac056f1617980db1c58bce4
branch: main
repository: 10x-fiszki
topic: "testing-critical-path-coverage — grounding risks #1-#3 from test-plan.md §2 before planning Phase 1"
tags: [research, codebase, testing, fsrs, ts-fsrs, crud, concurrency, atomicity, supabase, postgrest]
status: complete
last_updated: 2026-08-02
last_updated_by: Claude Sonnet 5
---

# Research: Testing critical-path coverage (Phase 1 — risks #1–#3)

**Date**: 2026-08-02T23:40:24+02:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 21fbe1e179595c208ac056f1617980db1c58bce4
**Branch**: main
**Repository**: 10x-fiszki

## Research Question

Ground the three highest-priority risks from `context/foundation/test-plan.md` §2 against the current codebase, ahead of `/10x-plan` for Phase 1 ("Critical-path coverage & floor"):

- **Risk #1** — Review session (FSRS) produces incorrect or inconsistent recall ratings / due-dates.
- **Risk #2** — Deck/card CRUD behaves incorrectly under edge-case or concurrent input.
- **Risk #3** — Accepted cards or SRS state are silently lost on save (partial batch insert, non-atomic multi-row update).

For each risk, find: the actual code path, the actual configuration/behavior (not assumed defaults), and any already-known deviations, bugs, or gaps — plus whether zero, partial, or full test coverage exists today.

## Summary

**Zero automated tests exist in this codebase today.** No test runner is configured (`package.json` has no test script/dependency), confirming CLAUDE.md's note. The only test-shaped artifact anywhere is a manual, CI-unwired SQL script for RLS isolation (`supabase/tests/verify-rls-isolation.sql`). All three risks are fully unprotected at present — this matches test-plan.md's framing of them as the Phase 1 floor.

All three risks are **confirmed real**, not hypothetical, with concrete evidence:

1. **Risk #1 (FSRS):** The app deliberately overrides one FSRS parameter — `generatorParameters({ enable_short_term: false })` — in exactly two places ([`src/lib/fsrs.ts:6`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/lib/fsrs.ts#L6), [`ReviewSessionPanel.tsx:116`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/ReviewSessionPanel.tsx#L116)) — a documented deviation from the original plan's literal `fsrs()` spec, caught at impl-review and *kept* rather than reverted. No test today would notice if this flag silently flipped back, which would materially change scheduling for New/Learning cards. Every other FSRS parameter (retention 0.9, max interval 36500, fuzz off, default weight vector) runs as pure library default, unmodified.
2. **Risk #2 (CRUD edge cases):** A real cross-card edit-state race was found and fixed in a prior change (`CardListPanel.tsx`'s `saveEdit` unconditionally clearing `editingCardId`, discarding a second card's unsaved edit). Live-code research surfaced two more, currently-unfixed gaps: deck delete silently "succeeds" on a nonexistent/foreign ID with no row-count check, and the review-rating route's existence-check and its write use different filter sets (check-then-act).
3. **Risk #3 (silent save-loss):** The two candidate batch-write flows behave *differently*, and the difference matters for test design. The AI-generated-card batch save (`cards.ts` POST) is a **single-statement, single-request `.insert(rows)`** — confirmed via Context7 docs (see below) to run inside one PostgREST/Postgres transaction, so it is genuinely atomic today (all-or-nothing on a constraint violation). The review-session **restore/undo path** (`review-reset.ts`) is the actual non-atomic flow: `Promise.allSettled` over one `.update()` per card, explicitly tolerating and reporting partial failure (`{ restored, total }`) — this is the correct target for the "partial failure in a sequence" hermetic test named in test-plan.md §2's Risk Response Guidance, not the AI batch-save endpoint.

## Detailed Findings

### Risk #1 — FSRS review-session correctness

**Library & instantiation.** `ts-fsrs@5.4.1` (implements FSRS-6.0). Two independent instantiations exist:
- Server-authoritative: [`src/lib/fsrs.ts:1,6`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/lib/fsrs.ts#L6) — `export const scheduler = fsrs(generatorParameters({ enable_short_term: false }));`
- Client preview-only: [`ReviewSessionPanel.tsx:3,116`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/ReviewSessionPanel.tsx#L116) — used only to label the 4 rating buttons via `.repeat()` ([line 196](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/ReviewSessionPanel.tsx#L196)); never persisted. The server independently recomputes and commits on `POST`, so client preview drift cannot cause data loss — only a misleading label, if the two ever diverged (they currently don't).

**Config vs. library defaults.** Confirmed by reading the installed `node_modules/ts-fsrs` build: defaults are `request_retention=0.9`, `maximum_interval=36500`, `enable_fuzz=false`, `enable_short_term=true`, default weight vector `w`. **The only override anywhere in this codebase is `enable_short_term: false`.** Inline rationale comment: `src/lib/fsrs.ts:4-5` — "skips the minutes-scale (re)learning steps, so every rating ... produces a day-scale interval." This is a **documented, deliberate plan/implementation deviation**: the original plan specified plain `fsrs()` (`context/changes/spaced-repetition-review-session/plan.md:140,146`), the deviation was flagged at impl-review as finding F1 (WARNING, Plan Adherence) and resolved by keeping it, not reverting (`context/changes/spaced-repetition-review-session/reviews/impl-review.md:23-40`). The impl-review explicitly notes it couldn't tell whether this was a signed-off product decision or an unreviewed agent improvisation — i.e., it is exactly the kind of implementation detail a test should pin down going forward, not re-litigate.

A second, related deviation on the same code path: `SESSION_SIZE` is `30` in [`review.ts:5-7`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review.ts#L5) vs. the plan's original `50` — also flagged (F2) and kept intentionally. Not a scheduling-correctness bug, but worth a regression check since it's the same file.

**Request → persistence path:**
- `GET /api/decks/[id]/review` — auth check, queries `cards` where `due <= now()` (UTC `now()` computed server-side), `.limit(30)`, ordered by `due` ascending.
- `POST /api/decks/[id]/review` — validates `{ cardId, grade }` (`grade` integer 1-4 via `isValidGrade`); fetches the row by `id` + `deck_id` (`.maybeSingle()`, 404 if absent); converts to an FSRS `Card` via `toFsrsCard()`; calls **`scheduler.next(toFsrsCard(row), now, body.grade)`** — the sole call site producing the authoritative next state, using server wall-clock `Date`, never a client-supplied timestamp; persists via `fromFsrsCard()` into 10 columns (`due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`).
- `POST /api/decks/[id]/review-reset` — separate undo endpoint; restores client-supplied field snapshots verbatim with **no FSRS recomputation and no invariant validation** (only per-field type/range checks) — a client could in principle restore an internally-inconsistent FSRS state, though the real UI only ever sends its own prior snapshot.

**Timezone/due-date handling.** `due` is Postgres `timestamptz` (a UTC instant, not date-only). No timezone-conversion logic and no date library (`date-fns`/`dayjs`/`Temporal`) anywhere in the review path — pure native `Date`/ISO-string round-tripping in `toFsrsCard`/`fromFsrsCard`. "Due" is always compared against live server `now()` at query time, never a stale client snapshot. No day-boundary rounding exists.

**Test coverage today:** none. This is precisely the gap Phase 1 exists to close (`test-plan.md:79,120`).

**Known non-blocking gap on record:** `src/lib/fsrs.ts:53` carries an eslint-disable noting `elapsed_days` is deprecated in the `ts-fsrs` API but still required by the DB schema — a future `ts-fsrs` upgrade could change this field's semantics; not urgent for Phase 1 but worth a note in test comments if a transition-logic unit test asserts on this field.

### Risk #2 — Deck/card CRUD edge cases & concurrency

**Routes inventory** (all gated by `src/middleware.ts` `PROTECTED_ROUTES`):

| Route | Methods | Ownership check pattern |
|---|---|---|
| [`decks/index.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/index.ts) | POST | create — n/a |
| [`decks/[id]/delete.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/delete.ts#L15) | POST | **no row-count check** — see below |
| [`cards.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards.ts) | GET, POST | list / bulk AI-card insert |
| [`cards/[cardId].ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards/%5BcardId%5D.ts#L60) | PATCH, DELETE | correctly filters by `id` **and** `deck_id`, maps `PGRST116`→404 |
| [`cards/manual.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards/manual.ts) | POST | single manual card insert |
| [`review.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review.ts#L107) | GET, POST | **check-then-act mismatch** — see below |
| [`review-reset.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review-reset.ts#L106) | POST | bulk restore, silently drops unmatched IDs |

**Confirmed, currently-open gaps (not yet fixed by any prior change):**

1. **Silent no-op deck delete** — [`decks/[id]/delete.ts:15-21`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/delete.ts#L15): `.delete().eq("id", id)` with no `.select()`/`.single()`, so zero-row-matched (nonexistent ID, or foreign ID silently excluded by RLS) reports no error — the handler redirects to `/decks` as if it succeeded. This route also never checks `context.locals.user` itself (every card route does), relying solely on middleware + RLS.
2. **Check-then-act in rating** — [`review.ts:107-136`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review.ts#L107): the existence/ownership fetch filters by `id`+`deck_id`, but the subsequent `.update()` filters by `id` only. No deck-reassignment endpoint exists today so practical exposure is low, but it's an inconsistency versus the stricter double-filter pattern used in `cards/[cardId].ts`.
3. **Silent partial-drop in bulk restore** — [`review-reset.ts:106-127`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review-reset.ts#L106): nonexistent/foreign card IDs in the restore payload silently contribute 0 to `restored`, with no per-ID error surfaced (only an aggregate count).

**Already-fixed precedent (historical, for pattern reference, not to re-test as "open"):** `CardListPanel.tsx`'s `saveEdit` used to unconditionally clear `editingCardId` on its own save resolving, discarding a second card's concurrently-opened, unsaved edit — fixed via a functional `setEditingCardId((current) => current === cardId ? null : current)` guard ([`CardListPanel.tsx:136`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/CardListPanel.tsx#L136)). Good regression-test candidate: prove the fix holds (open edit A, save A, open edit B before A resolves, confirm B survives).

**Untested but structurally narrower race:** `CardListPanel.tsx`'s `confirmDelete` computes `remainingOnPage` (used to decide whether to page back) from a `cards` snapshot taken at call-start, not at resolution — a genuine (if narrow) staleness risk if two deletes on the same page overlap.

**Ownership enforcement:** RLS is the *sole* mechanism — no route independently re-checks `deck.user_id`/`card`'s owning deck's `user_id` in application code. A manual, CI-unwired SQL script (`supabase/tests/verify-rls-isolation.sql`) is the only existing verification of this, and it says so explicitly in its own header comment.

**Test coverage today:** none automated.

### Risk #3 — Silent save-loss on batch/multi-row operations

**Two distinct multi-row-write flows exist, and they are not the same risk shape:**

1. **AI-generated card batch save** — [`cards.ts:131-133`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards.ts#L131): `supabase.from("cards").insert(rows).select("front, back")` — **one HTTP request carrying the whole array, i.e. one Postgres statement.** Confirmed via Context7 (`/websites/supabase` docs on the `.rollback()` modifier): *"PostgREST runs the query within a transaction... This functionality is limited to the single request it is chained to, as the client does not support grouping multiple queries into a single transaction."* — i.e. one PostgREST request = one transaction. A constraint violation (e.g. the unique `(deck_id, md5(front)||md5(back))` index from `supabase/migrations/20260801114731_cards_unique_front_back.sql`, or the DB's own `check (length(front) <= 2000)` constraint) fails the *entire* insert atomically — nothing partially persists. The route correctly returns 400 with the raw `error.message` in this case (not specially handling `23505` the way `manual.ts`/`[cardId].ts` do — a minor UX gap, not a data-loss gap). **This endpoint is already structurally safe against silent partial loss; a test here should assert "all-or-nothing," not assume it's broken.** A prior change (`ai-generated-flashcard-review`) already found and fixed one adjacent failure mode — an oversized proposal (>2000 chars) would abort the whole batch — by pre-filtering both `isValidProposal` and `isValidCardInput`; that fix is what makes today's atomic-insert behavior safe in practice.
2. **Review-session restore/undo** — [`review-reset.ts:106-129`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review-reset.ts#L106): `Promise.allSettled` over **one `.update()` call per card** — genuinely non-atomic, by design. Always returns HTTP 200 with `{ restored, total }`, even when `restored < total`. This is the actual "partial failure in a sequence" flow the test-plan's Risk Response Guidance describes, and — per historical context below — it already has a plan-reviewed, implemented partial-failure contract (`ReviewSessionPanel.tsx`'s `confirmReset` checks `restored < total` and keeps the snapshot for retry rather than clearing it). **No test today verifies `restored` actually reflects DB state**, or that a genuinely failed row is retried correctly rather than silently dropped from the next attempt.

**No RPC/stored-procedure/explicit-transaction usage anywhere in `src/`** (confirmed via repo-wide grep for `.rpc(`, `BEGIN`, `transaction` — zero matches). All Supabase access is via the plain REST-backed JS client.

**Frontend truthfulness of "saved" messaging:** `GenerateFlashcardsPanel.tsx`'s success toast count (`data.saved.length`) comes from the same insert's own `.select()` echo, so on the happy path the displayed count already reflects actual persisted rows — no gap there. `ReviewSessionPanel.tsx`'s `confirmReset` already distinguishes full vs. partial success and shows a specific retry message on partial (`ReviewSessionPanel.tsx:299-304`) — this existing contract is exactly what a test should pin down (that `restored`/`total` are trustworthy, and that a partial failure doesn't silently clear the pending-restore snapshot).

**Test coverage today:** none automated on either flow.

## Code References

- [`src/lib/fsrs.ts:1-62`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/lib/fsrs.ts) — scheduler instantiation (`enable_short_term: false` override, line 6), `toFsrsCard`/`fromFsrsCard` serialization boundary
- [`src/pages/api/decks/[id]/review.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review.ts) — `GET` (due-cards fetch, line 51-59), `POST` (rating submission + persistence, lines 107-136), `SESSION_SIZE=30` (line 5-7)
- [`src/pages/api/decks/[id]/review-reset.ts`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/review-reset.ts) — non-atomic bulk restore, `Promise.allSettled` (lines 106-129)
- [`src/components/decks/ReviewSessionPanel.tsx`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/ReviewSessionPanel.tsx) — client scheduler preview (line 116), `rate()` (206-262), `confirmReset()` partial-success handling (275-318)
- [`src/pages/api/decks/[id]/cards.ts:131-148`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards.ts#L131) — atomic batch insert of AI-generated cards
- [`src/pages/api/decks/[id]/cards/[cardId].ts:60-143`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/cards/%5BcardId%5D.ts#L60) — well-behaved PATCH/DELETE pattern (404 on not-found/foreign, contrast reference)
- [`src/pages/api/decks/[id]/delete.ts:4-22`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/pages/api/decks/%5Bid%5D/delete.ts) — silent no-op deck delete gap
- [`src/components/decks/CardListPanel.tsx:136,175-182`](https://github.com/dorianfriede/10x-fiszki/blob/21fbe1e179595c208ac056f1617980db1c58bce4/src/components/decks/CardListPanel.tsx#L136) — fixed edit-race guard; stale-snapshot pagination risk
- `supabase/migrations/20260801130000_cards_fsrs_fields.sql` — FSRS column migration (`due timestamptz`, etc.)
- `supabase/migrations/20260801114731_cards_unique_front_back.sql` — unique index used to force the constraint-violation path in a batch-insert test
- `supabase/tests/verify-rls-isolation.sql` — existing manual (non-CI) ownership-isolation script

## Architecture Insights

- **Single source of scheduling truth.** The server (`scheduler.next()` in `review.ts`) is the only place FSRS state is actually computed and committed; the client-side scheduler instance exists purely for UI preview and cannot cause data drift on its own — this narrows risk #1's test surface to the server route + `fsrs.ts`, not the React component's scheduling logic.
- **Two different "batch write" shapes coexist under one risk label.** Risk #3 as stated in test-plan.md ("partial batch insert, non-atomic multi-row update") actually names two structurally different code paths: a genuinely atomic single-statement insert (safe) and a genuinely non-atomic per-row update loop (the real target). Planning should route the "assert atomicity" test at the insert endpoint and the "assert partial-failure is surfaced, not silently dropped" test at `review-reset.ts`.
- **Ownership enforcement is single-layered (RLS only).** No route in this codebase does defense-in-depth ownership checks in application code; every CRUD route's behavior on a foreign ID is entirely a product of how RLS's row-exclusion interacts with each route's own null/error handling — which is why some routes (with `.single()`/`.maybeSingle()` + explicit null checks) fail safe and one (`decks/[id]/delete.ts`) does not.
- **Existing partial-failure UX pattern already exists and should be extended, not invented.** `review-reset.ts` + `ReviewSessionPanel.tsx`'s `confirmReset` already implement "report counts, keep state for retry on partial failure" — this is the project's de facto convention for non-atomic multi-row operations and should be the reference pattern if any other bulk-write route is added later.

## Historical Context (from prior changes)

- `context/changes/spaced-repetition-review-session/plan.md:140,146` and `reviews/impl-review.md:23-50` (findings F1, F2) — the plan specified plain `fsrs()` and `SESSION_SIZE=50`; implementation shipped `enable_short_term:false` and `SESSION_SIZE=30`. Both deviations were caught, discussed, and kept intentionally (not reverted) — directly the deviation test-plan.md's Risk #1 source note refers to.
- `context/changes/card-browsing-and-editing/reviews/impl-review.md` (finding F2) — the cross-card edit-state race in `CardListPanel.tsx` (`saveEdit` clobbering a second card's edit) was found and fixed here; also flagged the same file's in-place migration edit for NUL-byte handling (schema-adjacent, not test-relevant).
- `context/changes/ai-generated-flashcard-review/reviews/impl-review.md` (finding F2) — the oversized-proposal (>2000 char) whole-batch-abort failure mode was found and fixed by adding length pre-validation to `isValidProposal`/`isValidCardInput`; this is what makes today's atomic batch-insert endpoint safe against silent loss in practice, not just in theory.
- `context/changes/ux-improvements/plan-brief.md` ("Open Risks") and `reviews/plan-review.md` (finding F2) — the plan itself named the non-atomic restore risk in advance; plan-review caught that the originally-designed client contract couldn't actually detect a partial failure (endpoint returned no partial-count signal). Fixed pre-implementation by switching to `Promise.allSettled` + `{ restored, total }` + conditional snapshot-clearing on the client. This is the strongest existing precedent for how Risk #3's Phase 1 test should be framed: assert that a simulated partial failure surfaces via `restored < total` and that client-held state is preserved for retry, not cleared.

## Related Research

- `context/changes/spaced-repetition-review-session/research.md` — original ts-fsrs compatibility research (schema gaps, serialization boundary) predating the scheduler-config deviation found later at impl-review.
- `context/changes/spaced-repetition-review-session/srs-library-research.md`, `ts-fsrs-api-docs.md` — earlier Context7-sourced `ts-fsrs` API reference (predates this session's confirmation of the current installed version's actual default values, which were read directly from `node_modules` in this research pass).

## Open Questions

- **Risk #1:** Was `enable_short_term: false` a signed-off product decision, or should it be revisited before being pinned by a test? (Impl-review flagged this exact ambiguity and it was never resolved either way — test-plan/planning should decide whether the test asserts today's behavior as correct-and-final, or flags it for a product decision first.)
- **Risk #2:** Should the silent no-op on deck delete and the review.ts check-then-act filter mismatch be fixed as part of Phase 1 (test-driven fix) or only covered by a test that documents current behavior for Phase 1, with the fix deferred? test-plan.md's Phase 1 goal line says "defend the highest impact×likelihood scenarios," which could argue either way.
- **Risk #3:** Should `review-reset.ts`'s partial-failure contract be tested only via a hermetic stub (per CLAUDE.md's two-layer strategy, since real infra can't easily force a mid-sequence row failure), or does the project want an integration test asserting the atomic-insert endpoint's all-or-nothing behavior against a real constraint violation too? Both are cheap; Phase 1 planning should decide whether both belong in this phase or whether the atomic-insert assertion is lower priority than the non-atomic restore path.
