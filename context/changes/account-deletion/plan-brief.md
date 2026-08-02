# Account Deletion (30-Day Retention) — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`

## What & Why

Roadmap item S-08: a logged-in user can request deletion of their own account, with data retained for 30 days before permanent purge — giving them a window to change their mind instead of an instant, irreversible action.

## Starting Point

Auth is Supabase Auth with an anon-key-only client (no service-role key anywhere in the codebase). The schema already cascade-deletes: `auth.users → decks → cards`. There's no `profiles` table, no account/settings page, no soft-delete concept, and no scheduled-job mechanism (`pg_cron` or otherwise) in this codebase today.

## Desired End State

A user can go to `/account`, type their email to confirm, and request deletion. They land on a locked `/account/pending-deletion` screen (any other protected route redirects there too) showing days remaining, with Cancel or Sign-out as the only actions. If they never cancel, a daily database job hard-deletes their account and everything they own once 30 days pass.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Retention/reversibility architecture | App-owned `account_deletion_requests` table + middleware redirect, not Supabase's native `shouldSoftDelete` | Supabase's built-in soft-delete is documented as not reversible via the API, which conflicts with the roadmap's "window to reverse" requirement | Plan |
| Purge mechanism | `pg_cron` scheduled SQL job | Runs entirely DB-side, unaffected by the Cloudflare Workers deployment target, and rides the existing FK cascade for free | Plan |
| Access during the 30-day window | Fully locked to a single pending-deletion screen | Simplest to reason about; avoids the risk/cost of threading a read-only mode through existing forms | User (recommended) |
| Entry point | New `/account` settings page | Standard, discoverable location with room to grow beyond just deletion | User (recommended) |
| Delete confirmation UX | Type-to-confirm (type your email) | Stronger guard against an accidental irreversible-feeling action than a plain confirm modal | User |
| Email notifications | None — in-app only | No email infrastructure exists anywhere in this codebase yet; out of proportion to this slice | User (recommended) |
| Re-signup with same email while pending | No special handling | Supabase's native `signUp` error is left unchanged; not worth a new code path for an edge case | User (recommended) |
| Data export before purge | Out of scope | Not part of the roadmap outcome for this slice | User (recommended) |
| Cancel-deletion entry point | Button directly on the pending-deletion screen | Pairs naturally with the locked-access decision — no extra navigation hop | User (recommended) |

## Scope

**In scope:**
- Request deletion (type-to-confirm), immediate redirect to a locked pending-deletion screen
- Cancel deletion, restoring full access
- Middleware gating so every protected route respects a pending request
- `pg_cron` job that purges the account and all owned data after 30 days

**Out of scope:**
- Email notifications (confirmation or reminder)
- Data export before purge
- Read-only/partial access during the retention window
- Special handling for re-signup with the same email
- Admin/support tooling for another user's account

## Architecture / Approach

A new `account_deletion_requests(user_id, requested_at)` table, RLS-scoped to the owner, is the single source of truth for "is this account pending deletion." Request/cancel are plain insert/delete through the existing anon-key client — no new secret needed. `src/middleware.ts` gets one extra check: if a pending row exists for the logged-in user, redirect protected-route traffic to `/account/pending-deletion`. A `pg_cron` job scheduled in a migration runs daily and deletes `auth.users` rows past the 30-day mark; the existing FK cascade chain (`auth.users → decks → cards`, plus the new table) purges everything else automatically.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Retention schema & purge job | New table + RLS, `pg_cron` extension + daily purge job | Hosted Supabase plan may require enabling `pg_cron` via the Dashboard before the migration succeeds |
| 2. Request & cancel API routes | `POST /api/account/delete`, `POST /api/account/cancel` | Low — thin RLS-backed insert/delete, mirrors existing deck-delete pattern |
| 3. Account UI + pending-deletion screen + middleware gating | `/account`, `/account/pending-deletion`, type-to-confirm dialog, middleware redirect | Middleware change touches every protected-route request — needs care not to break existing auth-redirect behavior |

**Prerequisites:** F-01 (`deck-card-schema-foundation`) — already `impl_reviewed`, schema/RLS and cascade FKs live.
**Estimated effort:** ~1 session across 3 phases; Phase 1 is the only part with external-service uncertainty (pg_cron enablement).

## Open Risks & Assumptions

- Assumes `pg_cron` can be enabled via migration on the linked Supabase project; if the hosted plan restricts this, enabling it via the Dashboard first is a manual one-time step, not a plan change.
- Assumes a daily purge cadence (`0 3 * * *`) is fine given the 30-day granularity — no requirement for tighter timing.

## Success Criteria (Summary)

- A user can request and, within 30 days, reverse an account deletion entirely through the UI, with no other protected page usable in between.
- Once 30 days pass without cancellation, the account and all its decks/cards are permanently gone with no manual intervention required.
