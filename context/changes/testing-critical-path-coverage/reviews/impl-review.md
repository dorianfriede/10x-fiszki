<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testing Critical-Path Coverage

- **Plan**: context/changes/testing-critical-path-coverage/plan.md
- **Scope**: Phase 1-7 of 7 (full plan)
- **Date**: 2026-08-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Phase 7 cookbook entry for the Phase 5 fix doesn't match the shipped code

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/test-plan.md:281-286 (§6.6, Phase 5 note)
- **Detail**: The cookbook says the pagination-race fix "moved into the `setCards` functional updater ... mirroring the already-fixed `saveEdit` edit-race pattern." The actual fix in `src/components/decks/CardListPanel.tsx:83-95` uses a different mechanism entirely: a `cardsLengthAtLastCheck` state variable compared against `cards.length` during render, calling `setPage` directly in the render body (React's "adjust state during render" pattern), explicitly to avoid the `react-hooks/set-state-in-effect` lint rule per the commit message. No `setCards` functional updater is involved. Phase 7's own Manual Verification criterion required the cookbook to be "accurate enough for a future `/10x-implement` run on Phase 2 to follow without re-reading this plan" — this entry currently fails that bar.
- **Fix**: Rewrite the §6.6 Phase 5 bullet to describe the actual "adjust state during render" technique (compare `cards.length` to a tracked previous value each render; call `setPage` synchronously in the render body when it drops to 0) instead of the unshipped functional-updater description.
- **Decision**: FIXED — rewrote context/foundation/test-plan.md §6.6 Phase 5 bullet to describe the actual render-time state-adjustment mechanism.

### F2 — Unplanned infra/tooling additions not recorded anywhere in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: astro.config.mjs, eslint.config.js, .gitignore, tests/setup.ts, vitest.config.ts
- **Detail**: Several changes were necessary to make Vitest/Container-API tests work but were never named in any phase's "Changes Required": `astro.config.mjs` gates the Cloudflare adapter behind `process.env.VITEST`; `eslint.config.js` adds a Node-globals override for `*.config.*` files; `.gitignore` adds `.env.test.local`; `tests/setup.ts` grew an env loader for `SUPABASE_SERVICE_ROLE_KEY` plus `Uint8Array`/`HTMLDialogElement` polyfills; `vitest.config.ts` gained `pool: "vmThreads"`. All verified low-risk during this review — `npm run build` still produces the Cloudflare adapter correctly, `npm run lint` is clean, and all node/jsdom-environment tests pass. Not defects, just undocumented scope.
- **Fix**: Add a short addendum note to plan.md (or fold into Phase 1/5's Changes Required retroactively) listing these five files so the plan stays an accurate record of what shipped.
- **Decision**: FIXED — added "Addendum: Unplanned Infra Changes" section to plan.md listing all five files.

### F3 — Integration test `afterAll` cleanup isn't resilient to a partial `beforeAll` failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/deck-delete.test.ts:41-54 (same pattern in cards-crud.test.ts, cards-batch-insert.test.ts, review.test.ts)
- **Detail**: `beforeAll` creates two users sequentially (`userA`, `userB`) and `afterAll` unconditionally runs `deleteTestUser(userA.id)` then `deleteTestUser(userB.id)`. If the second `createTestUser()` call throws, `userB` stays `undefined` and `afterAll` throws a `TypeError` on `userB.id`, masking the original failure in noisy output (though `userA` still gets cleaned up first, so this is a diagnostics problem more than a leak). `tests/integration/auth-contract.test.ts` already uses a safer `try/finally` pattern for the same cleanup problem, so the other three files are inconsistent with the more robust sibling.
- **Fix**: Guard `afterAll` with optional chaining (`deleteTestUser(userB?.id)`) or adopt `auth-contract.test.ts`'s `try/finally` pattern in the other three integration files for consistency.
- **Decision**: FIXED — wrapped each `deleteTestUser` call in `afterAll` in its own try/catch (deck-delete.test.ts, cards-crud.test.ts, cards-batch-insert.test.ts, review.test.ts) so one missing user can't abort cleanup of the other. Also fixed the same underlying issue in `auth-contract.test.ts`, discovered during this fix: its `userA`/`userB` creation happened *before* the `try` block, so a throw creating `userB` would have skipped cleanup of `userA` too, despite being cited as the "safer" example — moved creation inside `try` and guarded `finally` with presence checks.

### F4 — `test-auth.ts`'s `getAuthenticatedRequestInit` returns a different shape than the plan specified

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/helpers/test-auth.ts:71-110
- **Detail**: The plan's Contract specified this helper returns `{ locals, request: new Request(url, {...}) }`. The shipped version returns `{ locals, cookieHeader }` and leaves `Request` construction to each call site (each of which needs a different method/URL/body). Every caller adapted consistently; this is a reasonable design, just a literal interface deviation from the plan text.
- **Fix**: No action needed — accept as an intentional, better-fitting design. Optionally update plan.md's Phase 1 contract text to match what shipped.
- **Decision**: SKIPPED

### F5 — "Throwaway" auth-contract test shipped as a permanent, docs-cited test file

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/integration/auth-contract.test.ts; context/foundation/test-plan.md:162
- **Detail**: Plan's Manual Verification 1.5 called for "a throwaway test" proving the auth/cookie contract. What shipped is a permanent file wired into `npm test` and now cited in test-plan.md §6.2 as canonical documentation of the pattern. This is a good outcome — the auth contract stays regression-protected — but the plan's own wording ("throwaway") doesn't match what's on disk.
- **Fix**: No action needed — positive deviation, keep as-is.
- **Decision**: SKIPPED

## Verification notes

- `npm run lint`: clean (0 errors, 7 pre-existing warnings unrelated to this change's files).
- `npm run build`: succeeds; Cloudflare adapter still resolves correctly outside `VITEST`, confirming the `astro.config.mjs` gate (F2) is safe.
- `npx vitest run tests/unit` and `tests/components`: 9/9 tests pass (hermetic + jsdom tiers, no external infra needed).
- `tests/integration/*` and the Supabase-dependent auth-contract test could not be independently re-run in this review environment — the Supabase CLI is not installed here. Their green status rests on the commit-stamped Progress checkboxes (bc532b3, 08e1471, 3351454) rather than a fresh run in this session.
- Both named bug fixes (`delete.ts` row-count check, `review.ts` update-filter) were read and confirmed correct: the delete fix is a single atomic `DELETE ... RETURNING` (no TOCTOU window), and the review fix's added `.eq("deck_id", id)` matches the filter pair already used by sibling routes (`review-reset.ts`, `cards.ts`, `cards/[cardId].ts`).
