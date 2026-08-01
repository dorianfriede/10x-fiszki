<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Flashcard Creation Implementation Plan

- **Plan**: context/changes/manual-flashcard-creation/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — TOCTOU race in duplicate-check-then-insert

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; already a documented, plan-accepted trade-off
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/cards/manual.ts:60-81
- **Detail**: The duplicate check is a separate `SELECT ... {count:"exact",head:true}` (lines 60-65) followed by a plain `insert` (lines 77-81), with no DB-level uniqueness constraint on `(deck_id, front, back)`. Two concurrent identical submissions (double-click racing ahead of the client's `isSaving` guard, or two browser tabs) could both read `count === 0` and both insert, producing a duplicate row. This is not new information — the plan itself (plan.md:35) explicitly chose an application-side check over a schema migration to keep "No schema migration" intact, given `target_scale.data_volume: small` and single-user manual entry.
- **Fix**: Accept as-is per the plan's documented trade-off. If concurrent duplicate submissions become a real problem later, add a partial unique index on `(deck_id, front, back)` and catch the resulting Postgres unique-violation error instead of the current select-then-insert check (removes the race and drops a round-trip).
- **Decision**: FIXED — added `supabase/migrations/20260801114731_cards_unique_front_back.sql` (unique index on `(deck_id, md5(front || E'\x00' || back))` to stay within the btree index-entry size limit) and updated `manual.ts` to remove the select-then-insert check, catching Postgres `23505` on the insert instead and returning the same 409 message.

### F2 — Missing unmount guard in CreateCardPanel (present in sibling component)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/decks/CreateCardPanel.tsx:46-72
- **Detail**: `GenerateFlashcardsPanel.tsx` tracks mount state (`isMountedRef`) and guards every post-`await` `setState` call, added specifically because a prior impl-review (commit 502826d) flagged "set-state-after-unmount" as a reliability risk in that component. `CreateCardPanel.tsx`'s `handleSubmit` has no equivalent guard — `setSaveError`/`setSessionCards`/`setFront`/`setIsSaving` all run unconditionally after `fetch` resolves. If a user navigates away mid-save, this risks a React "state update on unmounted component" side effect (React 18 typically no-ops this silently, so real-world impact is low, but the guard already exists as an established pattern one file away).
- **Fix**: Add the same `isMountedRef` guard used in `GenerateFlashcardsPanel.tsx` to `CreateCardPanel.tsx`'s `handleSubmit`, skipping the post-fetch `setState` calls if the component has unmounted during the request.
- **Decision**: FIXED — added `isMountedRef` (set false on unmount via `useEffect` cleanup) and guarded the post-fetch `setSaveError`/`setSessionCards`/`setIsSaving` calls in `handleSubmit`, mirroring `GenerateFlashcardsPanel.tsx` exactly.

## Supporting notes (not findings)

- **Plan Adherence**: all 4 planned changes (entry point, page, API route, component) match the plan's stated contracts exactly — verified file-by-file against `Changes Required` #1-4. No DRIFT, MISSING, or unplanned functional EXTRA found.
- **Scope Discipline**: `eslint.config.js` changed (extends the existing `astroReturnWorkaroundConfig` file list to cover the new `new.astro` page) but this is a mechanical, incidental consequence of mirroring `generate.astro`'s top-level-`return` shape as the plan explicitly required — not scope creep. All "What We're NOT Doing" boundaries (no browsing/editing UI, no batch creation, no DB uniqueness migration, no new textarea wrapper, no middleware changes) are respected.
- **Architecture**: RLS is the sole authorization mechanism for both the page's deck lookup and the API route's insert (no app-side ownership check) — this is the same intentional design already proven by the AI-generation path (S-02) and stated explicitly in the plan (plan.md:29). No IDOR found; no independent authorization defect.
- **Security**: no injection risk (Supabase query builder is parameterized throughout), no XSS (React escapes card text, no `dangerouslySetInnerHTML`), no hardcoded secrets, auth boundary enforced both at the API route (`context.locals.user` check) and via `PROTECTED_ROUTES` middleware prefixes. JSON body parsing is safely wrapped (`.catch(() => null)`), never crashes on malformed input.
- **Success Criteria**: `npx astro check` (0 errors), `npm run lint` (0 errors — 5 pre-existing unrelated warnings in `openrouter.ts`), and `npm run build` (succeeded) all re-verified directly. All manual checkboxes in the plan's Progress section are checked and are substantiated by code present in the diff (redirect logic, validation logic, session-list state) — no rubber-stamping indication.
