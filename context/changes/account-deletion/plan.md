# Account Deletion (30-Day Retention) Implementation Plan

## Overview

Let a logged-in user request deletion of their own account. The account and all its data (decks, cards, review/FSRS state) stay intact but inaccessible for 30 days, during which the user can reverse the request. After 30 days, a scheduled job permanently purges the account and everything it owns.

## Current State Analysis

- Auth is Supabase Auth; `src/middleware.ts` resolves `Astro.locals.user` via `supabase.auth.getUser()` and gates `PROTECTED_ROUTES = ["/dashboard", "/decks", "/api/decks"]`.
- `src/lib/supabase.ts` only ever constructs a client with the **anon key** (`SUPABASE_KEY`, `context: "server"` in `astro.config.mjs`). No service-role key exists anywhere in this codebase today.
- Schema already cascades: `decks.user_id → auth.users(id) on delete cascade` and `cards.deck_id → decks(id) on delete cascade` (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql`). Deleting an `auth.users` row already wipes all of that user's decks and cards for free.
- No `profiles` table, no account/settings page, no `deleted_at`/soft-delete concept anywhere in the codebase. `supabase/config.toml` has a commented-out, never-configured `custom_access_token` hook stub.
- No email-sending infrastructure exists beyond Supabase Auth's own transactional emails (signup confirmation).
- The one existing destructive-action confirm pattern is a custom `<dialog>` + React state (`pendingDelete`/`isDeleting`) in `src/components/decks/CardListPanel.tsx`, used for card deletion. Deck deletion (`src/pages/api/decks/[id]/delete.ts`) trusts RLS for ownership rather than an app-level check — the house pattern per `context/changes/deck-management/plan.md`.
- No `pg_cron` extension or scheduled job exists in any migration today.

## Desired End State

A logged-in user can go to `/account`, type their email to confirm, and request deletion. They're immediately redirected to a locked `/account/pending-deletion` screen showing their request date and days remaining; any other protected route also redirects there while a request is pending. From that screen they can cancel (restoring full access) or sign out. If they never cancel, a daily database job permanently deletes their `auth.users` row (and, via existing FK cascades, every deck/card they own) once 30 days have passed.

Verify by: requesting deletion as a test account, confirming `/decks` and `/dashboard` both redirect to the pending screen, cancelling and confirming normal access returns, then manually back-dating a test row's `requested_at` and confirming the purge job removes the account and its data.

### Key Discoveries:

- `auth.admin.deleteUser(id, shouldSoftDelete: true)` looked like the obvious built-in answer, but Supabase documents it as **not reversible via the API** — it conflicts with the roadmap's explicit "window to reverse the request," so it's not used here.
- Because the FK cascade chain already terminates at `auth.users`, a single `delete from auth.users where …` in a `pg_cron` job purges decks and cards with no extra cleanup code — no service-role key or Admin API call is needed for the purge path at all.
- `pg_cron` (Supabase Cron) runs entirely inside Postgres and is unaffected by the app's Cloudflare Workers deployment target — no `scheduled()` handler needs to be added to the Astro Cloudflare adapter's build output.

## What We're NOT Doing

- Email notifications (deletion confirmation or pre-purge reminder) — no email infra exists in this codebase; out of proportion to this slice.
- Data export before purge — not part of the roadmap outcome for this slice.
- Any special-cased handling for signing up again with the same email while a deletion is pending — Supabase's native `signUp` error/behavior is left exactly as-is.
- Read-only or continued access to decks/cards during the 30-day window — access is fully locked to the pending-deletion screen for the duration.
- Admin/support tooling to cancel or force-purge another user's account.
- Supabase's native `shouldSoftDelete` and any Custom Access Token Hook configuration — superseded by the app-owned table + middleware approach below.

## Implementation Approach

Own the retention state in a small new table (`account_deletion_requests`) instead of touching `auth.users` at request time. This keeps the request/cancel paths on the existing anon-key RLS-enforced client (no new secret), lets the existing per-request middleware pattern do the access-gating (no Supabase-project-level hook config to manage outside migrations), and leaves the one-time purge as a single scheduled SQL statement that rides the FK cascades already in place.

## Critical Implementation Details

- **pg_cron availability**: some hosted Supabase plans require enabling the `pg_cron` extension via the Dashboard (Database → Extensions) before a migration's `create extension if not exists pg_cron` will succeed. Check this early in Phase 1 rather than discovering a permissions error mid-`db push`.
- **Cron job lifecycle isn't migration-tracked**: `cron.schedule('purge-expired-account-deletions', ...)` upserts by job name, so re-running the migration is safe. But the job lives in `cron.job`, not in migration history — deleting or editing the migration file later will *not* remove or change an already-scheduled job. Any future change to this job needs an explicit `cron.unschedule('purge-expired-account-deletions')` in a new migration.

## Phase 1: Retention schema & purge job

### Overview

Add the table that tracks a pending deletion request and the scheduled job that permanently purges expired ones.

### Changes Required:

#### 1. Retention table + RLS

**File**: `supabase/migrations/<timestamp>_account_deletion_requests.sql` (generate via `supabase migration new account_deletion_requests` to get a correctly-ordered timestamp at implementation time)

**Intent**: One row per user marks a pending deletion request. RLS scopes every operation to the owning user, matching the house pattern. The FK cascade means this row also disappears automatically if the user is ever removed through any other path.

**Contract**: `account_deletion_requests(user_id uuid primary key references auth.users(id) on delete cascade, requested_at timestamptz not null default now())`, RLS enabled, with owner-scoped `select`/`insert`/`delete` policies following the `auth.uid() = user_id` style already used in `20260729164431_deck_card_schema_foundation.sql`. No `update` policy — a request is either present or cancelled (deleted), never edited.

#### 2. Scheduled purge job

**File**: `supabase/migrations/<timestamp>_account_deletion_purge_cron.sql`

**Intent**: Daily, automatically hard-delete any account whose deletion was requested 30+ days ago. Relies entirely on existing FK cascades to remove dependent decks/cards — no application code runs this.

**Contract**: `create extension if not exists pg_cron with schema extensions;` followed by a named `cron.schedule('purge-expired-account-deletions', '0 3 * * *', $$ ... $$)` job. The purge statement itself is the one place a wrong join could delete the wrong rows, so it's specified exactly:

```sql
delete from auth.users
using account_deletion_requests
where auth.users.id = account_deletion_requests.user_id
  and account_deletion_requests.requested_at < now() - interval '30 days';
```

### Success Criteria:

#### Automated Verification:

- `supabase db push` completes successfully against the linked cloud project
- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- Query `cron.job` after push and confirm `purge-expired-account-deletions` is registered with schedule `0 3 * * *`
- Manually insert an `account_deletion_requests` row with a backdated `requested_at` (31+ days ago) for a disposable test account, run the job's SQL body directly, and confirm the test account's `auth.users` row, decks, and cards are all gone afterward

---

## Phase 2: Deletion request + cancel API routes

### Overview

The two API routes that let a user move in and out of the pending-deletion state.

### Changes Required:

#### 1. Request deletion

**File**: `src/pages/api/account/delete.ts`

**Intent**: Let the authenticated user request deletion of their own account. Ownership is enforced entirely by RLS (`insert ... with check (auth.uid() = user_id)`) — no application-level ownership check, mirroring `src/pages/api/decks/[id]/delete.ts`.

**Contract**: `POST /api/account/delete`; no request body needed (identity comes from the session); `supabase.from("account_deletion_requests").insert({ user_id: user.id })`; redirect `/account/pending-deletion` on success, `/account?error=<encoded message>` on failure. Follows the existing `signin.ts`/`signup.ts` redirect-with-query-param error convention.

#### 2. Cancel deletion

**File**: `src/pages/api/account/cancel.ts`

**Intent**: Let a user in the pending-deletion window reverse the request and restore full access.

**Contract**: `POST /api/account/cancel`; `supabase.from("account_deletion_requests").delete().eq("user_id", user.id)`; redirect `/dashboard` on success, `/account/pending-deletion?error=<encoded message>` on failure.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes

#### Manual Verification:

- POST to `/api/account/delete` as a signed-in test user; confirm a row appears in `account_deletion_requests` and the response redirects to `/account/pending-deletion`
- POST to `/api/account/cancel`; confirm the row is removed and the response redirects to `/dashboard`

---

## Phase 3: Account settings + pending-deletion UI + middleware gating

### Overview

Wire the two API routes into real screens, and make every protected route respect a pending deletion.

### Changes Required:

#### 1. Middleware gating

**File**: `src/middleware.ts`

**Intent**: Add `/account` to the set of routes that require authentication, and redirect any authenticated user with a pending deletion request to the locked pending-deletion screen regardless of which protected route they hit.

**Contract**: Add `"/account"` and `"/api/account"` to `PROTECTED_ROUTES` (two separate entries — `/api/account/*` does not start with `/account`, mirroring the existing `/decks` + `/api/decks` pairing). Add `pendingDeletionRequestedAt: string | null` to `App.Locals` in `src/env.d.ts`. After `context.locals.user` is resolved and the existing auth-redirect check passes, if `context.locals.user` is set and the path isn't `/account/pending-deletion` or `/api/account/cancel` (and isn't `/api/auth/signout`, so sign-out keeps working), query `account_deletion_requests` for `requested_at where user_id = locals.user.id`; set `context.locals.pendingDeletionRequestedAt` to the row's `requested_at` (or `null` if none), and if a row exists, redirect to `/account/pending-deletion`. This lets the pending-deletion page (item 4) reuse the value instead of re-querying the same row. This check runs on every request where `context.locals.user` is set, regardless of `PROTECTED_ROUTES` membership — it is not scoped to the `if (PROTECTED_ROUTES.some(...))` block — so a pending user hitting any public page (e.g. `/`) is redirected too; this is why `/api/auth/signout` needs its own exemption.

#### 2. Account settings page

**File**: `src/pages/account/index.astro` (new)

**Intent**: Single home for account-level actions; today it only holds the delete-account entry point ("Danger zone").

**Contract**: Server-renders `Astro.locals.user.email` into the `DeleteAccountDialog` island. Follows the `Layout.astro` + glass-panel visual style already used in `dashboard.astro`.

#### 3. Delete-account confirm dialog

**File**: `src/components/account/DeleteAccountDialog.tsx` (new, `client:load`)

**Intent**: Type-to-confirm guard on an irreversible-feeling action, adapted from the `<dialog>` ref pattern already used for card deletion in `CardListPanel.tsx`.

**Contract**: Controlled text input; the submit button (`variant="destructive"`) stays `disabled` until the typed value exactly equals the user's email (passed in as a prop). Wraps a plain `<form method="POST" action="/api/account/delete">` — actual submission goes through the API route per the project's auth-form convention (POST to an endpoint, not `fetch`), not client-side JS.

#### 4. Pending-deletion screen

**File**: `src/pages/account/pending-deletion.astro` (new)

**Intent**: The single locked screen every protected route redirects to while a deletion is pending. Shows the request date, days remaining, and the only two actions available.

**Contract**: Reads `Astro.locals.pendingDeletionRequestedAt` (set by the middleware in item 1 — no re-query), computes days remaining as `Math.max(0, 30 - Math.floor((Date.now() - new Date(requestedAt).getTime()) / 86_400_000))`, renders a cancel form (`POST /api/account/cancel`) and reuses the existing sign-out form markup from `dashboard.astro`.

#### 5. Dashboard nav link

**File**: `src/pages/dashboard.astro`

**Intent**: Make the new settings page discoverable.

**Contract**: One `<a href="/account">Account settings</a>` near the existing sign-out form.

### Success Criteria:

#### Automated Verification:

- `npx astro check` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- As an unauthenticated visitor, confirm `/account` redirects to `/auth/signin`
- Sign in, go to `/account` via the dashboard link, confirm the delete button stays disabled until the typed email matches exactly
- Submit the confirmed delete; confirm redirect to `/account/pending-deletion` showing today's date and "30 days remaining"
- While pending, attempt to visit `/decks` and `/dashboard`; confirm both redirect back to `/account/pending-deletion`
- While pending, visit the public homepage `/`; confirm it also redirects to `/account/pending-deletion`
- Confirm sign-out still works from the pending-deletion screen
- Sign back in while still pending; confirm the redirect to `/account/pending-deletion` still applies
- Cancel the deletion; confirm redirect to `/dashboard` and that `/decks` is reachable again
- Attempt to sign up again with the same email while a deletion is pending (before cancelling); confirm Supabase's native `signUp` error surfaces unchanged on `/auth/signup` (no custom handling added)

---

## Testing Strategy

### Unit Tests:

- None — no test framework is configured in this repo yet (per CLAUDE.md); introducing one is out of scope for this slice.

### Integration Tests:

- None automated — see Manual Testing Steps below.

### Manual Testing Steps:

1. As an unauthenticated visitor, confirm `/account` and `/account/pending-deletion` both redirect to `/auth/signin`.
2. Sign in, request deletion via `/account`, confirm redirect to `/account/pending-deletion`.
3. Confirm `/decks`, `/dashboard`, and `/api/decks` all redirect back to `/account/pending-deletion` while pending.
4. Cancel the deletion; confirm normal access to all of the above returns.
5. Repeat the request, then manually back-date the row and confirm the `pg_cron` job purges the account and its decks/cards on the next run.
6. Attempt signup with the same email as a pending-deletion account; confirm Supabase's default error behavior (unchanged).

## Performance Considerations

The middleware's pending-deletion check adds one indexed primary-key lookup (`account_deletion_requests` by `user_id`) per authenticated request to a route already gated by `PROTECTED_ROUTES` or `/account`. At this app's scale (PRD: medium users, low QPS, small data volume) this is negligible and consistent with the existing per-request `supabase.auth.getUser()` call the middleware already makes.

## Migration Notes

No existing data to migrate — `account_deletion_requests` is a new, empty table and the purge job only ever acts on rows created going forward.

The purge job is the only mechanism that removes expired accounts and has no alerting. Periodically check `select * from cron.job_run_details where jobname = 'purge-expired-account-deletions' order by start_time desc` to confirm it's running and succeeding — a silent failure (e.g. `pg_cron` disabled by a plan change) would leave pending-deletion accounts un-purged with no other signal.

## References

- Roadmap: `context/foundation/roadmap.md` (S-08)
- Cascade delete precedent: `context/changes/deck-card-schema-foundation/plan.md`, `supabase/migrations/20260729164431_deck_card_schema_foundation.sql`
- RLS-over-app-check precedent: `context/changes/deck-management/plan.md:160-186`, `src/pages/api/decks/[id]/delete.ts`
- Confirm-dialog precedent: `src/components/decks/CardListPanel.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Retention schema & purge job

#### Automated

- [ ] 1.1 `supabase db push` completes successfully against the linked cloud project
- [ ] 1.2 `npx astro check` passes
- [ ] 1.3 `npm run lint` passes

#### Manual

- [ ] 1.4 `cron.job` shows `purge-expired-account-deletions` registered with schedule `0 3 * * *`
- [ ] 1.5 Backdated test row is purged (account, decks, cards all gone) after running the job's SQL body

### Phase 2: Deletion request + cancel API routes

#### Automated

- [ ] 2.1 `npx astro check` passes
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 `POST /api/account/delete` creates a row and redirects to `/account/pending-deletion`
- [ ] 2.4 `POST /api/account/cancel` removes the row and redirects to `/dashboard`

### Phase 3: Account settings + pending-deletion UI + middleware gating

#### Automated

- [ ] 3.1 `npx astro check` passes
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 Unauthenticated visitor to `/account` redirects to `/auth/signin`
- [ ] 3.5 Delete button stays disabled until typed email matches exactly
- [ ] 3.6 Confirmed delete redirects to `/account/pending-deletion` showing correct date/days remaining
- [ ] 3.7 `/decks` and `/dashboard` redirect to `/account/pending-deletion` while pending
- [ ] 3.8 Public homepage `/` also redirects to `/account/pending-deletion` while pending
- [ ] 3.9 Sign-out still works from the pending-deletion screen
- [ ] 3.10 Re-signing-in while pending still redirects to `/account/pending-deletion`
- [ ] 3.11 Cancel restores normal access to `/decks` and `/dashboard`
- [ ] 3.12 Re-signup with same email while pending shows Supabase's unmodified native error
