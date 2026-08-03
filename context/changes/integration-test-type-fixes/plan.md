# Integration Test Type Fixes Implementation Plan

## Overview

Fix the 14 pre-existing `tsc --noEmit` / `astro check` errors in `tests/integration/*.test.ts` so a typecheck quality gate (local per-edit hook, pre-commit, or CI) can be trusted to report real regressions instead of always failing on unrelated pre-existing errors. This is a type-only fix — no test logic, assertions, or runtime behavior change.

## Current State Analysis

Four integration test files import Astro API endpoint route modules and pass them to `experimental_AstroContainer.renderToResponse(component, options)`:

- `tests/integration/cards-batch-insert.test.ts` — 1 call site (`CardsRoute`)
- `tests/integration/cards-crud.test.ts` — 5 call sites (`CardRoute` x3, `CardsRoute` x1, `ReviewRoute` x1)
- `tests/integration/deck-delete.test.ts` — 4 call sites (`DeleteRoute`)
- `tests/integration/review.test.ts` — 4 call sites (`ReviewRoute`)

`renderToResponse`'s declared parameter type is `AstroComponentFactory` (`node_modules/astro/dist/container/index.d.ts:246`), a page-component shape with a `(result, props, slots)` call signature. An endpoint module (`export const POST: APIRoute = ...`) doesn't structurally match that signature — TypeScript flags every call site with `TS2345`, even though `routeType: "endpoint"` makes the Container API handle it correctly at runtime. Confirmed via direct `npx tsc --noEmit` and `npx astro check` runs (2026-08-03): both report exactly these 14 errors, no others anywhere in the codebase.

These same four files already carry an identical shaped workaround for a different value — `const noopCookies = { set: () => undefined } as unknown as AstroCookies;` — establishing the `as unknown as <Type>` cast as the codebase's existing convention for "the real Astro type doesn't fit this test double/usage, but the runtime contract is satisfied."

No `typecheck` npm script exists today, and `.github/workflows/ci.yml` runs `npm run lint`, `npm test`, `npm run build` — no `tsc`/`astro check` step. This change does not add one; it only makes the underlying errors go away so a future gate (Module 3 Lesson 3 hooks work, or `test-plan.md` §3 Phase 3) can rely on a clean baseline.

## Desired End State

`npx tsc --noEmit` and `npx astro check` both exit clean (0 errors) with no changes to test assertions, fixtures, or any file outside the 4 listed integration test files. `npm run lint` and `npm test` still pass.

### Key Discoveries:

- `node_modules/astro/dist/container/index.d.ts:246` — `renderToResponse(component: AstroComponentFactory, options?: ContainerRenderOptions): Promise<Response>` is the exact signature the route modules fail to satisfy.
- `experimental_AstroContainer` (the class) is usable as a type position in TS, so `Parameters<experimental_AstroContainer["renderToResponse"]>[0]` resolves to the same `AstroComponentFactory` type without importing it from Astro's internal `astro/runtime/server/index.js` path (not part of Astro's public `exports` map's intended surface — only reachable via the catch-all `./runtime/*` entry).
- `tests/integration/deck-delete.test.ts:32` (and the equivalent line in the other 3 files) — the existing `noopCookies` cast is the precedent for this fix's shape and placement (top-level `const`, right after imports).

## What We're NOT Doing

- Not adding a `typecheck` (or similar) npm script to `package.json`.
- Not wiring any typecheck step into CI, a git hook, or an agent per-edit hook.
- Not changing any test assertion, fixture, seed helper, or route implementation file.
- Not touching `tests/integration/auth-contract.test.ts` (not in the error list — it doesn't call `renderToResponse` with a route needing this cast).

## Implementation Approach

Add one structurally-derived type alias per file, defined once next to the existing `noopCookies` constant, and cast each imported route module to it once — right after its import — rather than at each individual `renderToResponse` call site. All downstream call sites keep using the same identifier they already do (e.g. `CardRoute`, `DeleteRoute`), so no call-site lines change at all; only the import/cast lines change.

## Phase 1: Cast route module imports to the Container API's component type

### Overview

Apply the same fix shape to all 4 files: define `type ContainerComponent = Parameters<experimental_AstroContainer["renderToResponse"]>[0];` once per file, then re-bind each imported route module through `as unknown as ContainerComponent` at the import site.

### Changes Required:

#### 1. `tests/integration/cards-batch-insert.test.ts`

**Intent**: Fix the 1 `TS2345` error on `CardsRoute` at line 85.

**Contract**: Add `type ContainerComponent = Parameters<experimental_AstroContainer["renderToResponse"]>[0];` near the top of the file (after imports, alongside where `noopCookies` is declared). Re-bind the `CardsRoute` import through this type so the existing `container.renderToResponse(CardsRoute, {...})` call at line 85 type-checks without changing the call site itself — e.g. `import * as CardsRouteImport from "@/pages/api/decks/[id]/cards"; const CardsRoute = CardsRouteImport as unknown as ContainerComponent;` (adjust the import/binding split to keep every existing usage of the `CardsRoute` identifier working unmodified).

#### 2. `tests/integration/cards-crud.test.ts`

**Intent**: Fix the 5 `TS2345` errors across 3 distinct route bindings (`CardRoute` x3 at lines 85/104/126, `CardsRoute` x1 at line 149, `ReviewRoute` x1 at line 180).

**Contract**: Same `ContainerComponent` type alias (defined once in this file), applied to all 3 route bindings (`CardRoute`, `CardsRoute`, `ReviewRoute`) at their import sites. All 5 existing call sites keep referencing the same identifiers unchanged.

#### 3. `tests/integration/deck-delete.test.ts`

**Intent**: Fix the 4 `TS2345` errors on `DeleteRoute` at lines 70/89/108/128.

**Contract**: Same `ContainerComponent` type alias, applied once to the `DeleteRoute` import binding. All 4 existing call sites keep referencing `DeleteRoute` unchanged.

#### 4. `tests/integration/review.test.ts`

**Intent**: Fix the 4 `TS2345` errors on `ReviewRoute` at lines 142/183/213/228.

**Contract**: Same `ContainerComponent` type alias, applied once to the `ReviewRoute` import binding. All 4 existing call sites keep referencing `ReviewRoute` unchanged.

### Success Criteria:

#### Automated Verification:

- `npx tsc --noEmit` exits 0 with no errors
- `npx astro check` exits 0 with no errors (0 errors; pre-existing hints, if any, are not a regression from this change)
- `npm run lint` passes
- No changes outside the 4 listed test files (`git diff --stat` shows only those 4 paths)

#### Manual Verification:

- `npm test` passes locally with Supabase running (`supabase start`, env vars exported per `.github/workflows/ci.yml`'s pattern) — confirms the casts don't mask a real binding mistake (e.g. wrong route type-cast to the wrong variable) that a type-only review wouldn't catch
- Spot-check one modified file's diff to confirm every original call-site line (`container.renderToResponse(XRoute, {...})`) is byte-for-byte unchanged — only import/cast lines moved

**Implementation Note**: After this phase and all automated verification passes, pause here for manual confirmation that `npm test` was run successfully before considering the change complete — this is also the only phase in this plan.

---

## Testing Strategy

### Unit Tests:

- Not applicable — no new logic, no new unit tests. Existing unit tests are unaffected by this change.

### Integration Tests:

- No new integration tests are added. The existing 4 files' test suites (already covering risks #1–#4 per `test-plan.md`) must continue passing unchanged — this proves the type cast is inert at runtime, matching what it already does (the `routeType: "endpoint"` option, not the static type, drives correct behavior).

### Manual Testing Steps:

1. Run `npx tsc --noEmit` and confirm 0 errors (currently 14).
2. Run `npx astro check` and confirm 0 errors (currently 14).
3. Run `npm run lint` and confirm it still passes.
4. Start local Supabase (`supabase start`) and run `npm test`; confirm all 4 modified files' suites still pass with the same assertions as before.
5. Review the diff for each of the 4 files to confirm only import/type-cast lines changed, no call-site or assertion lines.

## Performance Considerations

None — compile-time-only change, no runtime code path is altered.

## Migration Notes

Not applicable — no data or schema changes.

## References

- Roadmap: `context/foundation/roadmap.md` (S-09)
- Type declaration: `node_modules/astro/dist/container/index.d.ts:246`
- Existing cast precedent: `tests/integration/deck-delete.test.ts:32` (`noopCookies`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cast route module imports to the Container API's component type

#### Automated

- [x] 1.1 `npx tsc --noEmit` exits 0 with no errors
- [x] 1.2 `npx astro check` exits 0 with no errors
- [x] 1.3 `npm run lint` passes
- [x] 1.4 No changes outside the 4 listed test files

#### Manual

- [x] 1.5 `npm test` passes locally with Supabase running
- [x] 1.6 Spot-check diffs show only import/cast lines changed
