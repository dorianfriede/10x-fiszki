<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account Deletion (30-Day Retention) Implementation Plan

- **Plan**: `context/changes/account-deletion/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE (all findings fixed during triage — see Decisions below)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

8/8 paths verified (`src/middleware.ts`, `src/lib/supabase.ts`, `supabase/migrations/20260729164431_deck_card_schema_foundation.sql`, `src/components/decks/CardListPanel.tsx`, `src/pages/api/decks/[id]/delete.ts`, `src/pages/dashboard.astro`, `supabase/config.toml`, `context/changes/deck-management/plan.md`), symbols verified (`auth.uid() = user_id` RLS pattern, FK `on delete cascade` chain, `PROTECTED_ROUTES` `startsWith` matching, `custom_access_token` commented-out stub), brief↔plan consistent.

## Findings

### F1 — /api/account/* never added to PROTECTED_ROUTES

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 1 (middleware gating) / Phase 2 (API routes)
- **Detail**: Phase 3's middleware contract added `"/account"` to `PROTECTED_ROUTES` but never added `/api/account`. `PROTECTED_ROUTES` matching is `startsWith`, so `"/api/account/delete".startsWith("/account")` is false — this exact footgun is already documented in this codebase's own history (`context/changes/deck-management/plan.md:26`: "`/api/decks` does not start with `/decks` as a string prefix, so it needs its own entry"). Consequence: `src/pages/api/account/delete.ts` and `cancel.ts` would be reachable by an unauthenticated request and would reference `user.id` on a `null` `context.locals.user`, throwing instead of redirecting to sign-in. This wouldn't surface in Phase 2's own manual verification, since that test is run "as a signed-in test user."
- **Fix**: Add `"/api/account"` to `PROTECTED_ROUTES` alongside `"/account"` in the Phase 3 middleware contract (mirrors the existing `/decks` + `/api/decks` pairing).
- **Decision**: FIXED (Fix in plan)

### F2 — No visibility into pg_cron purge-job failures

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, item 2 (scheduled purge job)
- **Detail**: The daily purge is the only mechanism that ever removes an expired account, with no application code and no alert path. A silent failure (permissions change, plan downgrade disabling `pg_cron`) means pending-deletion accounts simply never get purged, with nothing surfacing the failure.
- **Fix**: Added a note to Migration Notes to periodically check `cron.job_run_details` for the job.
- **Decision**: FIXED (Fix in plan)

### F3 — Redundant query: middleware existence check vs. page's own fetch

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3, items 1 & 4
- **Detail**: Middleware queried `account_deletion_requests` for existence on every request; `pending-deletion.astro` then queried the same table again for `requested_at` — two round-trips to the same row in one request lifecycle.
- **Fix**: Middleware now selects `requested_at` and stashes it on `context.locals.pendingDeletionRequestedAt` (new field added to `App.Locals` in `src/env.d.ts`); the pending-deletion page reads it from locals instead of re-querying.
- **Decision**: FIXED (Fix in plan)

### F4 — "Days remaining" rounding formula unspecified

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, item 4
- **Detail**: "30 - days since requested_at" didn't specify floor/ceil or timezone handling. The purge condition uses a precise `now() - interval '30 days'` comparison — an unspecified rounding could make the UI say "1 day remaining" while the row is actually already eligible for purge, or vice versa.
- **Fix**: Specified the exact formula: `Math.max(0, 30 - Math.floor((Date.now() - new Date(requestedAt).getTime()) / 86_400_000))`.
- **Decision**: FIXED (Fix in plan)

### F5 — Pending-deletion redirect's global scope is implied, not stated

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3, item 1
- **Detail**: Exempting `/api/auth/signout` only makes sense if the pending-check runs on every request (not just `PROTECTED_ROUTES`-gated ones) — e.g. a pending user hitting the public homepage `/` would also redirect. The contract never stated this scope explicitly, and no manual verification step exercised a non-gated public route.
- **Fix**: Contract now states explicitly that the check runs regardless of `PROTECTED_ROUTES` membership; added manual verification step (Phase 3, Progress 3.8) exercising the public homepage.
- **Decision**: FIXED (Fix in plan)

## Triage Summary

All 5 findings were fixed directly in `plan.md` during triage. `change.md` status updated to `plan_reviewed`.
