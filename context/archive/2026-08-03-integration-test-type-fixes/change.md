---
change_id: integration-test-type-fixes
title: Integration test type fixes (tsc --noEmit gate)
status: archived
created: 2026-08-03
updated: 2026-08-16
archived_at: 2026-08-16T11:44:29Z
---

## Notes

Sourced from roadmap item S-09 (`context/foundation/roadmap.md`) — tech debt / quality gate.

- Outcome: (cross-cutting, tech debt) the pre-existing `tsc --noEmit` / `astro check` errors in `tests/integration/*.test.ts` are fixed, so a typecheck quality gate (local hook or CI) reports real regressions instead of always failing on unrelated pre-existing errors.
- PRD refs: — not in PRD v1; discovered while wiring the Module 3 Lesson 3 per-edit hook (`context/foundation/test-plan.md` §5 "post-edit hook" gate).
- Prerequisites: — none.
- Parallel with: S-02, S-03, S-04, S-05, S-06, S-07, S-08 — isolated to existing integration test files.
- Verified during planning (2026-08-03): actual error count is **14**, not the roadmap's originally cited 12 (`npx tsc --noEmit` and `npx astro check` agree exactly), confined to `cards-batch-insert.test.ts`, `cards-crud.test.ts`, `deck-delete.test.ts`, `review.test.ts`. Single root cause: `container.renderToResponse(RouteModule, {...})` — endpoint route modules aren't structurally `AstroComponentFactory`, even though `routeType: "endpoint"` handles them correctly at runtime.
- Scope explicitly excludes wiring a `typecheck` script or CI/hook gate — that's the Module 3 Lesson 3 hooks work and test-plan.md §3 Phase 3, not this change.
- **Implementation discovery (2026-08-03, during Phase 1):** the `ContainerComponent` cast alone dropped the original 14 `TS2345` errors to 0, but unmasked 14 *new*, previously-invisible errors at the same call sites — TS never type-checked the `options.locals` argument while the `component` argument outright failed to match. Root causes, both pre-existing and unrelated to the component-type fix: (1) `tests/helpers/test-auth.ts`'s `TestUser` doesn't structurally satisfy Supabase's `User` (missing `app_metadata`, `user_metadata`, `aud`, `created_at`); (2) `@astrojs/cloudflare`'s adapter augments `App.Locals` to require `cfContext: ExecutionContext`, which no test fixture provides. Resolved with the same `as unknown as <Type>` convention, cast on each `locals: {...}` literal (`as unknown as App.Locals`) across all 14 call sites in the 4 files — approved by user via AskUserQuestion in lieu of re-planning, since it's the same mechanical, type-only pattern already established. This means the plan's "every call-site line byte-for-byte unchanged" success-criteria note is superseded: call-site `locals:` lines now carry the added cast; assertions/request/params lines remain untouched.
