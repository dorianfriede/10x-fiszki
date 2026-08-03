# Testing Critical-Path Coverage — Implementation Plan

## Overview

This is Rollout Phase 1 of `context/foundation/test-plan.md` §3: bootstrap Vitest
(and its supporting tools) from zero, and defend the three highest
impact×likelihood risks — FSRS review-session correctness (#1), deck/card
CRUD edge cases (#2), and silent save-loss on multi-row writes (#3) — at
the cheapest layer that gives a real signal, per the project's cost×signal
testing strategy.

## Current State Analysis

**Zero test infrastructure exists.** No test runner, no test files outside
`node_modules`, no test step in CI (`.github/workflows/ci.yml` runs
`lint` + `build` only). `research.md` confirmed all three risks are real
and currently fully unprotected, and surfaced two previously-unknown,
currently-open CRUD gaps plus one client-side race, none of which any
prior change fixed:

- `src/pages/api/decks/[id]/delete.ts:15` deletes with no row-count check
  and no `context.locals.user` gate of its own (every sibling route has
  one) — a nonexistent/foreign deck id silently "succeeds."
- `src/pages/api/decks/[id]/review.ts:107-136` checks existence with
  `.eq("id", body.cardId).eq("deck_id", id)` but updates with `.eq("id",
  body.cardId)` only (line 134) — a check-then-act filter mismatch.
- `src/components/decks/CardListPanel.tsx`'s `confirmDelete` (line 175)
  computes `remainingOnPage` from a `cards` state closure captured before
  the awaited fetch resolves, so a second concurrent delete resolving in
  between makes the page-back decision stale — the same class of bug as
  the already-fixed `saveEdit` edit-race in the same file (line 138).

Risk #3 covers two structurally different code paths that must be tested
differently: `cards.ts`'s batch insert (line 133, `.insert(rows)`) is a
single PostgREST statement and is already atomic; `review-reset.ts`
(lines 106-129) loops one `.update()` per card under `Promise.allSettled`
and is genuinely non-atomic by design, with an existing partial-failure
contract (`{ restored, total }`) that has never been tested against a
real forced failure.

## Desired End State

`npm test` runs a Vitest suite (unit + integration + component) covering
risks #1-#3, wired as a required step in CI. The two confirmed CRUD gaps
and the pagination race are fixed, each behind a test that failed before
the fix. `context/foundation/test-plan.md` §3 Phase 1 reads `complete`,
and §6.1/§6.2 document the patterns used so Phase 2 doesn't re-derive
them.

**Verify by**: `npm test` and `npm run lint` and `npm run build` all pass
locally and in CI; `context/foundation/test-plan.md` §3 Phase 1 row status
is `complete`.

### Key Discoveries:

- Astro's Container API (`renderToResponse`) bypasses `src/middleware.ts`
  entirely — it sets `context.locals.user` directly, satisfying each
  route's own auth gate, but every route's actual Supabase client is
  built independently from the request's `Cookie` header
  (`src/lib/supabase.ts:7`), and RLS enforcement follows that cookie's
  session, not the injected `locals.user`. Confirmed via Context7
  (`withastro/docs` container reference).
- `@supabase/ssr`'s cookie format is chunked base64url-encoded JSON
  (`isChunkLike`/`createChunks`, confirmed via Context7,
  `supabase/ssr`) — non-trivial to hand-construct, and not meant to be.
- `supabase status -o env` (confirmed via Context7, `supabase/supabase`)
  prints `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` directly usable as
  `SUPABASE_URL`/`SUPABASE_KEY` plus a test-only service-role key.
- Astro v6 requires `environment: 'node'` in Vitest config for any test
  that exercises Astro's rendering pipeline (confirmed via Context7,
  breaking change from v5) — but the two new CardListPanel component
  tests need a DOM, which `node` doesn't provide.
- `ts-fsrs`'s own default (`enable_short_term: true`) produces
  `state: Learning` and `reps: 1` on all four grades for a brand-new card
  (confirmed via Context7 reference test); the app's
  `enable_short_term: false` (`src/lib/fsrs.ts:6`) is a deliberate,
  now-confirmed-correct-and-final override — this project has no
  same-session card-reserve mechanism, so minute-scale learning steps
  would strand a missed new card until the user's next unrelated visit.

## What We're NOT Doing

- Not flipping `enable_short_term` — confirmed final as `false` for this
  app's session model (no same-session card-reserve mechanism exists).
  If this is revisited, it's a separate change via `/10x-frame` +
  `/10x-plan`, not a test-authoring decision.
- Not covering risks #4-#7 (cross-user access, AI-call failure handling,
  fail-open account checks, rate/cost bounds) — that's Phase 2 per
  test-plan.md §3.
- Not adding e2e/Playwright — Phase 2, per test-plan.md §4.
- Not adding an AI-native evaluation layer — out of scope for the whole
  rollout per test-plan.md §4.
- Not building a general-purpose test-fixture factory library beyond
  what risks #1-#3 need — no speculative abstraction.
- Not touching `review.ts`'s `SESSION_SIZE=30` or any other previously
  reviewed-and-kept plan/implementation deviation besides what's named
  above.

## Implementation Approach

Bootstrap the environment first (Phase 1), since every later phase
depends on it. Then work risk-by-risk in the order test-plan.md ranks
them (#1 → #2 → #3), cheapest/most-isolated layer first within each risk
(hermetic unit before integration, server before client), so a failure
in a later phase never blocks on tooling gaps found by an earlier one.
Phases 2-6 that name a known, fixable bug follow `/10x-tdd`: write the
failing test against current behavior first, then the minimal fix.
Phase 7 (docs) is `/10x-implement` only — there's no red test for a
markdown cookbook update.

## Critical Implementation Details

### Test auth contract: locals injection + real session cookies must agree

Every route in `src/pages/api/decks/**` guards on `context.locals.user`
itself, so Container API's `locals` option is sufficient to pass that
gate. But the same route's Supabase client reads its session from the
request's `Cookie` header, and RLS follows *that* session — not the
injected `locals.user`. A test that sets `locals.user` without a
matching cookie will see a route "succeed" against data RLS should have
hidden, producing a false-positive ownership test — precisely the
failure mode risk #2's "ownership is RLS-only" finding warns about.
Phase 1's test helper must obtain real cookies rather than hand-building
them: sign in through the app's own `createClient()` wrapper pointed at
an in-memory cookie-jar double, let `@supabase/ssr` write whatever
chunked cookies it writes, then replay those verbatim as the `Cookie`
header on the actual test request. Both `locals.user.id` and the
replayed cookie's session must reference the same seeded test user.

### jsdom is scoped per-file, not global

Only the two new `CardListPanel` tests (Phase 5) need a DOM. Every other
test in this plan (FSRS unit tests, Container API integration tests)
needs `environment: 'node'`, which Astro v6 requires for anything that
touches its rendering pipeline. Use a `// @vitest-environment jsdom`
docblock at the top of the component test files instead of flipping the
global Vitest config, so the rest of the suite is unaffected.

## Phase 1: Test Environment & CI Bootstrap

### Overview

Stand up Vitest, the Container API test harness, a local Supabase
instance (CLI-driven, real Postgres + real RLS), the auth/cookie test
helper described above, and component-testing tooling (RTL + jsdom) —
the foundation every later phase builds on.

### Changes Required:

#### 1. Vitest + component-testing dependencies

**File**: `package.json`

**Intent**: Add the test runner and component-testing libraries as dev
dependencies; add `test`/`test:watch` scripts.

**Contract**: devDependencies gain `vitest`, `jsdom`,
`@testing-library/react`, `@testing-library/dom`,
`@testing-library/jest-dom`. Scripts gain `"test": "vitest run"` and
`"test:watch": "vitest"`.

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new, project root)

**Intent**: Wire Vitest into Astro's own Vite config so path aliases
(`@/*`) and Astro's env schema resolve identically to the app; default to
the `node` environment required for Container API tests.

**Contract**: Wraps `getViteConfig` from `astro/config` (per Context7:
`withastro/docs` testing guide); `test.environment: "node"`;
`test.globals: true` (so React Testing Library's built-in `afterEach`
cleanup auto-registers without a manual import); `test.setupFiles:
["./tests/setup.ts"]`.

#### 3. Global test setup

**File**: `tests/setup.ts` (new)

**Intent**: Extend `expect` with DOM matchers globally — harmless for
`node`-environment tests since it only adds matchers, needed for the
`jsdom`-environment component tests.

**Contract**: Imports `@testing-library/jest-dom/vitest` (its
Vitest-native entry point, extends `expect` directly rather than via a
Jest global).

#### 4. Local Supabase auth/fixture test helper

**File**: `tests/helpers/test-auth.ts` (new)

**Intent**: Provide the reusable seed-user → real-cookie flow described
in Critical Implementation Details, plus per-test cleanup, so every
integration/component test in Phases 3-6 can get a real authenticated
user without duplicating this logic.

**Contract**: Exports `createTestUser()` (uses a service-role admin
client's `auth.admin.createUser` against the local instance),
`getAuthenticatedRequestInit(user)` (returns `{ locals: { user }, request:
new Request(url, { headers: { Cookie: <replayed cookies> } }) }` ready to
spread into `container.renderToResponse`), and `deleteTestUser(userId)`
for `afterEach` cleanup (cascade-deletes that user's decks/cards via the
service-role client, not a global table truncate, so parallel test files
don't collide).

#### 5. CI wiring

**File**: `.github/workflows/ci.yml`

**Intent**: Give CI a real local Supabase instance and run the new test
suite as a required gate, per test-plan.md §5.

**Contract**: In the `ci` job, after `actions/setup-node` and before
`npm run build`: add `supabase/setup-cli@v1`, `run: supabase start`, and a
step that captures `supabase status -o env` output into `$GITHUB_ENV` to
populate `SUPABASE_URL`/`SUPABASE_KEY` (mapping `API_URL`→`SUPABASE_URL`,
`ANON_KEY`→`SUPABASE_KEY`) and a test-only `SUPABASE_SERVICE_ROLE_KEY`
env var (consumed only by `tests/helpers/test-auth.ts`, never by app
code). Add `- run: npm test` after `npm run lint`, before `npm run
build`.

### Success Criteria:

#### Automated Verification:

- `npm test` runs and exits 0 with zero test files collected
- `supabase start` succeeds locally (`supabase status` reports all
  services healthy)
- `npm run lint` passes on all new files
- CI pipeline (`ci.yml`) runs `supabase start` + `npm test` successfully
  on a push

#### Manual Verification:

- A throwaway test using `tests/helpers/test-auth.ts` confirms a seeded
  user's cookie actually scopes an RLS-protected query (e.g., a second
  seeded user cannot see the first user's deck) — proves the auth
  contract from Critical Implementation Details actually holds before
  any risk-specific test depends on it

---

## Phase 2: FSRS Unit Tests (Risk #1)

### Overview

Pin the app's FSRS configuration as correct-and-final at the unit level,
hermetically (no DB needed) — the cheapest layer for pure scheduling
logic.

### Changes Required:

#### 1. FSRS transition unit tests

**File**: `tests/unit/fsrs.test.ts` (new)

**Intent**: Prove the app's exported `scheduler` (from `src/lib/fsrs.ts`,
built with `enable_short_term: false`) produces day-scale, `Review`-state
transitions for a brand-new card on all four grades, and that this is a
real effect of the override, not a coincidence of the test's fixture —
by contrasting against a second scheduler instantiated with
`enable_short_term: true` inside the same test, which must reproduce
`ts-fsrs`'s own documented default behavior (`state: Learning` for
Again/Hard/Good, `reps: 1` across all four grades — confirmed via
Context7 reference test). Also regression-guards `SESSION_SIZE=30`
(`review.ts:7`) isn't silently changed, via a targeted assertion in the
Phase 3 integration test rather than here (this file stays pure
scheduling logic).

**Contract**: Uses `vi.useFakeTimers()` + `vi.setSystemTime()` for a
fixed reference `now`; builds a fresh `Card` via `toFsrsCard()`-shaped
input; calls both schedulers' `.next(card, now, grade)` for grade 1-4;
asserts on `state` and `scheduled_days` per the reference behavior above.

### Success Criteria:

#### Automated Verification:

- `npm test -- fsrs` passes
- `npm run lint` passes

#### Manual Verification:

- None — pure unit test, no manual step needed

---

## Phase 3: FSRS Integration Test (Risk #1)

### Overview

Prove the full `GET`/`POST /api/decks/[id]/review` round trip persists
exactly what the scheduler computed, against a real deck/card in local
Supabase.

### Changes Required:

#### 1. Review route integration tests

**File**: `tests/integration/review.test.ts` (new)

**Intent**: Close the gap between "the FSRS library call succeeded" and
"the persisted row is the FSRS-correct next state" (test-plan.md §2's
Risk #1 Must-challenge line) — verify against an independently computed
expected `Card`, not by re-reading the app's own persisted output as the
oracle.

**Contract**: Seed one deck + several cards (mixed past-due/future-due,
using the `test-auth.ts` helper for the owning user) directly via an
authenticated Supabase client, not through the API under test. Call
`container.renderToResponse` against the real `GET`/`POST` handlers with
`routeType: "endpoint"`, `params: { id: deckId }`, and the
`locals`/cookie pair from Phase 1's helper. Assertions: `GET` returns
only cards with `due <= now`, capped at 30, ordered ascending by `due`
(regression-guards `SESSION_SIZE`); `POST` on a valid due card persists
FSRS fields matching an independent `scheduler.next()` call made in the
test with the identical pre-state and frozen `now` (via
`vi.setSystemTime`), read back from the DB after the request — not
computed by re-invoking the app's own code path; `POST` on a foreign
deck's card id returns 404; `POST` with `grade` outside 1-4 returns 400.

### Success Criteria:

#### Automated Verification:

- `npm test -- review` passes
- `npm run lint` passes

#### Manual Verification:

- Confirm in Supabase Studio (local, `supabase status` → Studio URL)
  that the seeded fixture rows are cleaned up after the test run (no
  leaked fixture data in the local DB)

---

## Phase 4: CRUD Edge-Case Tests + Fixes (Risk #2, Server)

### Overview

TDD the two confirmed-open CRUD gaps, and regression-protect the
already-correct patterns in sibling routes so they don't silently
regress later.

### Changes Required:

#### 1. Deck delete: row-count check + own auth gate

**File**: `src/pages/api/decks/[id]/delete.ts`

**Intent**: A delete on a nonexistent or foreign deck id must not report
success. Also bring this route in line with every sibling route's
pattern of checking `context.locals.user` itself, rather than relying
solely on `middleware.ts`.

**Contract**: Add `.select("id").maybeSingle()` after the `.delete().eq("id",
id)` call; when no row comes back, redirect with an explicit not-found
error param instead of the current unconditional `/decks` success
redirect. Add the same `if (!context.locals.user)` early-return every
other route in this directory already has.

#### 2. Review rating: align update filter with existence check

**File**: `src/pages/api/decks/[id]/review.ts`

**Intent**: The `.update()` at line 134 should not be able to affect a
row outside the deck already verified to own it.

**Contract**: Add `.eq("deck_id", id)` to the `.update()` call, matching
the filter pair already used by the preceding `.select()` existence
check (lines 108-112).

#### 3. Deck delete tests

**File**: `tests/integration/deck-delete.test.ts` (new)

**Intent**: TDD-drive change #1. Prove: deleting an owned deck succeeds;
deleting a nonexistent/foreign deck id surfaces as a failure, not a
silent success; an unauthenticated request is rejected.

**Contract**: Container API tests against the real `POST` handler, using
Phase 1's auth helper for the owned case and a second seeded user for
the foreign-id case.

#### 4. Card CRUD edge-case tests

**File**: `tests/integration/cards-crud.test.ts` (new)

**Intent**: Regression-protect the already-correct behaviors research
confirmed in `cards/[cardId].ts` and `cards.ts`, and TDD-drive change #2.

**Contract**: Container API tests asserting: PATCH/DELETE on a foreign
card id return 404; PATCH producing a duplicate front+back returns 409
(`23505` mapping); POST to the AI-batch endpoint with one oversized
(>2000 char) proposal in the batch is rejected (400) before any insert;
POST `/review` rating a card whose id exists but under a different deck
than the URL's `id` returns 404 both before and after change #2 (proves
the fix didn't change the existence-check's own behavior, only the
update's blast radius).

### Success Criteria:

#### Automated Verification:

- `npm test -- deck-delete` passes (fails before change #1, passes after)
- `npm test -- cards-crud` passes
- `npm run lint` passes
- `npm run build` passes (no type regressions from the route edits)

#### Manual Verification:

- Manually delete a deck via the UI and confirm the redirect/error
  behavior matches the new not-found-on-foreign-id contract

---

## Phase 5: Client-Side Race Tests + Fix (Risk #2, CardListPanel)

### Overview

Add component-level testing for the one client-side piece of risk #2:
regression-protect the already-fixed edit-race, and TDD the
stale-snapshot pagination race in the same file.

### Changes Required:

#### 1. Pagination race fix

**File**: `src/components/decks/CardListPanel.tsx`

**Intent**: `confirmDelete`'s page-back decision must reflect the latest
card list, not a closure captured before its `await fetch` resolved.

**Contract**: Move the `remainingOnPage` computation (currently line 175)
into the `setCards` functional updater's callback (or derive it from
that updater's `current` parameter) so it's computed from state at
update time, not render time — mirroring the pattern already used for
`editingCardId` at line 138.

#### 2. Component race tests

**File**: `tests/components/card-list-panel.test.tsx` (new)

**Intent**: Regression-test the existing edit-race fix; TDD-drive change
#1 above.

**Contract**: `// @vitest-environment jsdom` docblock; renders
`CardListPanel` with RTL; mocks global `fetch` (native mock, per
test-plan.md §4 — not MSW, which is reserved for the external AI-call
edge). Test 1: open edit on card A, trigger `saveEdit(A)` but don't let
its fetch promise resolve yet, open edit on card B, resolve A's fetch,
assert B's edit UI is still showing (not clobbered). Test 2: with two
cards remaining on the current page, trigger delete on both without
awaiting the first to finish, resolve the deletes out of order, assert
the page only navigates back once the page is genuinely empty — not
based on a stale count.

### Success Criteria:

#### Automated Verification:

- `npm test -- card-list-panel` passes (pagination-race assertion fails
  before change #1, passes after)
- `npm run lint` passes

#### Manual Verification:

- In the running app, open two cards' edit forms in quick succession and
  confirm the second edit's text survives the first save

---

## Phase 6: Save-Loss Tests (Risk #3)

### Overview

Test both structurally different multi-row-write shapes named in risk
#3: the already-atomic batch insert (assert the guarantee), and the
genuinely non-atomic restore loop (assert the partial-failure contract).

### Changes Required:

#### 1. Atomic batch-insert assertion

**File**: `tests/integration/cards-batch-insert.test.ts` (new)

**Intent**: Prove the AI-generated card batch save is genuinely
all-or-nothing against a real constraint violation, not merely assumed
safe.

**Contract**: Seed one existing card in a deck; POST a batch to
`cards.ts` where one of several rows exactly duplicates that card's
front+back (triggering the `cards_unique_front_back` unique index);
assert the response is a 400 and the deck's row count afterward is
unchanged from before the request — none of the batch's other,
non-conflicting rows persisted either.

#### 2. Non-atomic restore partial-failure test

**File**: `tests/unit/review-reset.test.ts` (new, hermetic)

**Intent**: Prove `review-reset.ts`'s `{ restored, total }` contract is
trustworthy under a real partial failure — real infra can't easily be
forced to fail mid-sequence, so this is the hermetic-stub case
test-plan.md's Risk Response Guidance names for risk #3.

**Contract**: Stub the Supabase client's `.update()` chain so one call
among several rejects (or returns an `error`) while the others succeed;
call the route's `POST` handler directly with a valid multi-card
payload; assert `restored === total - 1` and that the response never
silently reports full success when one row failed.

### Success Criteria:

#### Automated Verification:

- `npm test -- cards-batch-insert` passes
- `npm test -- review-reset` passes
- `npm run lint` passes

#### Manual Verification:

- None — both cases are deterministic, forced-failure scenarios with no
  meaningful manual angle

---

## Phase 7: Cookbook + test-plan.md Sync

### Overview

Fill in the test-plan.md sections this phase was scoped to leave `TBD`,
and close out Phase 1's status.

### Changes Required:

#### 1. Cookbook patterns

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholders this phase resolves, and add
one this phase discovered wasn't anticipated — component testing — so
future phases and future contributors don't re-derive these patterns.

**Contract**: §6.1 documents the FSRS fake-timers + contrast-scheduler
pattern (Phase 2). §6.2 documents the Container API + real local
Supabase + `test-auth.ts` cookie-replay pattern (Phases 3-4, 6.1). Add a
new §6.x for component tests documenting the `// @vitest-environment
jsdom` per-file override pattern (Phase 5). §4's stack table gains a row
for React Testing Library + jsdom (added mid-rollout, not anticipated at
`--refresh` time), with `checked:` dated to this phase's landing. §3's
Phase 1 row status updates to `complete`. §6.5 gets a short per-phase
note: tools added (Vitest, RTL, jsdom, local Supabase CLI in CI), bugs
fixed (deck-delete no-op, review.ts filter mismatch, pagination race),
and the FSRS config decision (confirmed final, not just today's value).

### Success Criteria:

#### Automated Verification:

- `npm run lint` / `npm run format` pass on the edited markdown (per
  lint-staged's `*.md` → Prettier rule)

#### Manual Verification:

- Read through the updated §6 cookbook entries and confirm they're
  accurate enough for a future `/10x-implement` run on Phase 2 to follow
  without re-reading this plan

---

## Testing Strategy

### Unit Tests:

- FSRS transition logic (`tests/unit/fsrs.test.ts`) — hermetic, no DB
- `review-reset.ts` partial-failure contract (`tests/unit/review-reset.test.ts`)
  — hermetic, stubbed Supabase client

### Integration Tests:

- `review.ts` GET/POST round trip against real local Supabase
- `delete.ts`, `cards.ts`, `cards/[cardId].ts` CRUD edge cases against
  real local Supabase (RLS genuinely enforced via the auth/cookie helper)
- `cards.ts` batch-insert atomicity against a real constraint violation

### Component Tests:

- `CardListPanel` edit-race regression + pagination-race fix, via RTL +
  jsdom, fetch mocked

### Manual Testing Steps:

1. Run `supabase start` locally and confirm `npm test` passes end to end
2. Delete a deck via the UI; confirm the new not-found behavior on a
   stale/foreign id (e.g., double-submit the delete form)
3. Open two cards' edit forms in quick succession; confirm neither
   clobbers the other
4. Delete two cards on the same page in quick succession; confirm the
   page-back logic fires correctly once the page is truly empty

## Performance Considerations

`supabase start` adds real time to local test runs and CI (Docker
container startup); no other performance-sensitive path is touched by
this plan.

## Migration Notes

No data migration. `delete.ts` and `review.ts`'s behavior changes are
additive safety checks (stricter row-matching), not schema changes —
no existing data is affected.

## References

- Research: `context/changes/testing-critical-path-coverage/research.md`
- Strategy: `context/foundation/test-plan.md` §1-§5
- Prior partial-failure UX precedent:
  `context/changes/ux-improvements/plan-brief.md` ("Open Risks"),
  `reviews/plan-review.md` (finding F2)
- Prior edit-race fix precedent:
  `context/changes/card-browsing-and-editing/reviews/impl-review.md`
  (finding F2)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Environment & CI Bootstrap

#### Automated

- [x] 1.1 `npm test` runs and exits 0 with zero test files collected
- [x] 1.2 `supabase start` succeeds locally
- [x] 1.3 `npm run lint` passes on all new files
- [x] 1.4 CI pipeline runs `supabase start` + `npm test` successfully

#### Manual

- [ ] 1.5 Auth-contract throwaway test confirms RLS is actually scoped by the replayed cookie

### Phase 2: FSRS Unit Tests (Risk #1)

#### Automated

- [x] 2.1 `npm test -- fsrs` passes
- [x] 2.2 `npm run lint` passes

### Phase 3: FSRS Integration Test (Risk #1)

#### Automated

- [x] 3.1 `npm test -- review` passes
- [x] 3.2 `npm run lint` passes

#### Manual

- [x] 3.3 Confirm no leaked fixture rows in local Supabase Studio after test run

### Phase 4: CRUD Edge-Case Tests + Fixes (Risk #2, Server)

#### Automated

- [ ] 4.1 `npm test -- deck-delete` passes (red before fix, green after)
- [ ] 4.2 `npm test -- cards-crud` passes
- [ ] 4.3 `npm run lint` passes
- [ ] 4.4 `npm run build` passes

#### Manual

- [ ] 4.5 Manual deck delete via UI matches new not-found contract

### Phase 5: Client-Side Race Tests + Fix (Risk #2, CardListPanel)

#### Automated

- [ ] 5.1 `npm test -- card-list-panel` passes (pagination-race assertion red before fix, green after)
- [ ] 5.2 `npm run lint` passes

#### Manual

- [ ] 5.3 Manual quick-succession edit test in running app confirms no clobbering

### Phase 6: Save-Loss Tests (Risk #3)

#### Automated

- [ ] 6.1 `npm test -- cards-batch-insert` passes
- [ ] 6.2 `npm test -- review-reset` passes
- [ ] 6.3 `npm run lint` passes

### Phase 7: Cookbook + test-plan.md Sync

#### Automated

- [ ] 7.1 `npm run lint` / `npm run format` pass on edited markdown

#### Manual

- [ ] 7.2 Cookbook read-through confirms it's sufficient for Phase 2 without re-reading this plan
