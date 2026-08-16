# Integration Test Type Fixes — Plan Brief

> Full plan: `context/changes/integration-test-type-fixes/plan.md`

## What & Why

Fix the 14 pre-existing `tsc --noEmit` / `astro check` errors in `tests/integration/*.test.ts` so a future typecheck quality gate (per-edit hook, pre-commit, or CI) reports real regressions instead of always failing on unrelated pre-existing errors. Type-only fix — no test logic or runtime behavior changes.

## Starting Point

Four integration test files (`cards-batch-insert.test.ts`, `cards-crud.test.ts`, `deck-delete.test.ts`, `review.test.ts`) call `container.renderToResponse(RouteModule, { routeType: "endpoint", ... })` on imported Astro API endpoint modules. `renderToResponse`'s declared type only accepts `AstroComponentFactory` (a page-component shape), which endpoint modules don't structurally match — 14 `TS2345` errors result, even though the runtime behavior is correct. Verified directly (2026-08-03): 14 errors, not the roadmap's originally-cited 12; confined to exactly these 4 files, single root cause.

## Desired End State

`npx tsc --noEmit` and `npx astro check` both exit clean. Nothing else about the test suite changes — same assertions, same fixtures, same pass/fail behavior.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Cast type source | Derive structurally: `Parameters<experimental_AstroContainer["renderToResponse"]>[0]` | Avoids depending on Astro's internal `astro/runtime/server/index.js` path, which isn't part of the package's intended public export surface | Plan |
| Cast granularity | Once per imported route binding, not per call site | ~6 casts total instead of 14; every existing call-site line stays byte-for-byte unchanged | Plan |
| New `typecheck` script | No — out of scope | This change's job is fixing the errors, not wiring the gate (that's Lesson 3 hooks work / test-plan.md §3 Phase 3) | Plan |
| Verification depth | tsc/astro check clean = automated; full `npm test` (needs local Supabase) = manual | Proves the cast doesn't mask a real binding mistake, without making unavailable local infra a hard automated blocker | Plan |

## Scope

**In scope:** Type-cast fixes in the 4 named integration test files only.

**Out of scope:** Any new npm script, CI step, or hook wiring; any change to route implementation files, fixtures, or test assertions; `auth-contract.test.ts` (not affected).

## Architecture / Approach

Add one structurally-derived type alias per file (next to the existing `noopCookies` precedent), then re-bind each imported route module through `as unknown as ContainerComponent` at its import line — not at each `renderToResponse` call. This means every existing call-site line stays untouched; only the import section of each file changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Cast route imports | All 14 errors resolved across 4 files, zero call-site changes | A binding mistake during the cast (wrong route re-bound to wrong identifier) — caught by the manual `npm test` run, not by typecheck alone |

**Prerequisites:** None — isolated to existing test files, no other change blocks this.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes local Supabase can be started for the manual `npm test` verification step; if not available in this environment, that step is deferred to CI or a follow-up manual check before closing the change out.

## Success Criteria (Summary)

- `tsc --noEmit` and `astro check` both report 0 errors.
- `npm test` still passes with identical assertions (manually confirmed).
- Diff touches only the 4 named test files' import sections.
