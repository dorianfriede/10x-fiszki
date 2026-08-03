# Testing Critical-Path Coverage — Plan Brief

> Full plan: `context/changes/testing-critical-path-coverage/plan.md`
> Research: `context/changes/testing-critical-path-coverage/research.md`

## What & Why

Bootstrap Vitest (and supporting test tooling) from zero, and defend the
three highest-risk failure scenarios named in `context/foundation/test-plan.md`
§2 — FSRS review-session correctness, deck/card CRUD edge cases, and
silent save-loss on multi-row writes — at the cheapest layer that gives a
real signal. This is Rollout Phase 1 of the project's phased test
strategy; today, zero automated tests exist anywhere in the codebase.

## Starting Point

No test runner, no test files, no test step in CI. Research
(`research.md`) confirmed all three risks are real and unprotected, and
surfaced two previously-unknown CRUD bugs (silent no-op deck delete;
check-then-act filter mismatch in the review-rating route) plus one
client-side pagination race — none fixed by any prior change.

## Desired End State

`npm test` runs a Vitest suite (unit + integration + component tests)
covering risks #1-#3, required in CI alongside lint and build. The two
CRUD bugs and the pagination race are fixed, each behind a test that
failed before the fix. `test-plan.md` §3 shows Phase 1 as `complete`,
with §6 cookbook patterns filled in for Phase 2 to reuse.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Integration test DB | Local Supabase via CLI (`supabase start`), real Postgres + RLS, wired into CI | A stub would lie about RLS/constraint behavior — exactly the signal risks #2/#3 need | Plan |
| `enable_short_term` FSRS flag | Pin `false` as correct-and-final spec, not just "today's value" | Confirmed: this app has no same-session card-reserve mechanism, so minute-scale learning steps would strand a missed new card | Plan |
| Confirmed CRUD bugs | Fix both, test-driven (TDD) | Cheap, few-line fixes; matches Phase 1's "defend highest impact×likelihood" goal | Plan |
| Risk #3 test scope | Both flows — atomic-insert assertion *and* non-atomic restore hermetic test | Research confirmed both are cheap and structurally distinct; PRD's NFR guardrail names both shapes | Plan |
| Time determinism | Global clock mock (`vi.useFakeTimers`/`vi.setSystemTime`) | Zero production-code changes; standard Vitest pattern for both FSRS unit and route integration tests | Plan |
| Client-side race coverage | Add React Testing Library + jsdom (scoped per-file, not global config) | Closes the one client-side half of risk #2 that the frozen Vitest+Container-API stack didn't originally cover | Plan |
| CardListPanel pagination race | Fix test-driven, same phase | Same class of bug, same file, as the already-fixed edit-race — inconsistent to pin one and fix the other | Plan |

## Scope

**In scope:**
- Vitest + Container API + local Supabase CLI + RTL/jsdom bootstrap, wired into CI
- FSRS unit + integration tests (risk #1), pinning `enable_short_term:false`
- CRUD edge-case tests + 2 TDD bug fixes (risk #2, server)
- Client-side race tests + 1 TDD bug fix (risk #2, `CardListPanel`)
- Atomic-insert + non-atomic-restore save-loss tests (risk #3)
- `test-plan.md` §3/§4/§6 sync

**Out of scope:**
- Risks #4-#7 (cross-user access, AI-call failure handling, fail-open checks, rate/cost bounds) — Phase 2
- e2e/Playwright — Phase 2
- AI-native evaluation layer — out of scope for the whole rollout
- Flipping `enable_short_term` to `true` — a separate product decision (session-reserve design gap), not this phase's job

## Architecture / Approach

Bootstrap tooling once (Phase 1), then work risk-by-risk in test-plan.md's
priority order, cheapest/most-isolated layer first within each risk
(hermetic unit → integration → component). Bug-fixing phases use
`/10x-tdd` (red test against current behavior, then the minimal fix);
the docs-only phase uses `/10x-implement`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Test Environment & CI Bootstrap | Vitest, Container API harness, local Supabase in CI, auth/cookie test helper, RTL/jsdom | Auth-contract helper is non-trivial (real cookies, not just `locals.user`) — gets its own manual verification step |
| 2. FSRS Unit Tests | Pins FSRS config as spec, hermetically | Needs a reference case independent of the app's own code to avoid a mirror test |
| 3. FSRS Integration Test | Full review round-trip against real Supabase | Oracle must be an independently computed `Card`, not the app's own persisted output |
| 4. CRUD Edge-Case Tests + Fixes | Fixes deck-delete + review.ts filter bugs, TDD | Two real production bugs fixed mid-testing-phase — scope creep risk, deliberately accepted |
| 5. Client-Side Race Tests + Fix | Fixes CardListPanel pagination race, TDD | New DOM-testing tooling added mid-rollout |
| 6. Save-Loss Tests | Atomicity assertion + hermetic partial-failure test | Two structurally different flows under one risk label — must not conflate them |
| 7. Cookbook + test-plan.md Sync | §6 patterns filled in, §3 status updated | None — docs only |

**Prerequisites:** Docker available locally and in CI (for `supabase start`); no other external dependencies.
**Estimated effort:** ~5-7 sessions across 7 phases — Phase 1 is the long pole (new tooling + auth helper), Phases 2-6 are each roughly one session.

## Open Risks & Assumptions

- `supabase start` adds real startup time to every local test run and CI run (Docker container boot) — accepted cost for real RLS signal.
- The auth/cookie-replay helper (Phase 1) is the riskiest single piece of new infrastructure in this plan; its own manual verification step (1.5) exists specifically to catch a false-positive-permissive test harness before any risk-specific test relies on it.
- Fixing 3 real bugs (deck-delete, review.ts filter, pagination race) inside a nominally "testing infrastructure" phase is a deliberate, acknowledged scope decision — cheap enough to justify, but worth flagging if a future reviewer expects this phase to be test-only.

## Success Criteria (Summary)

- `npm test` passes locally and in CI, required alongside lint/build
- All three CRUD/pagination bugs are fixed and each has a test that would have failed before the fix
- FSRS scheduling behavior (`enable_short_term:false`) is pinned as verified, intentional behavior — not an untested assumption
- `test-plan.md` §3 Phase 1 reads `complete`; §6 cookbook is usable by Phase 2 without re-deriving these patterns
