<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account Deletion (30-Day Retention) Implementation Plan

- **Plan**: context/changes/account-deletion/plan.md
- **Scope**: Full plan (Phase 1, 2, 3 of 3)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION (all findings fixed during triage on 2026-08-02)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Middleware fails open if the pending-deletion query errors

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:28-33
- **Detail**: `const { data: pendingDeletion } = await supabase.from("account_deletion_requests").select("requested_at").eq("user_id", ...).maybeSingle();` discards `error`. If this query fails (transient DB/network blip), `pendingDeletion` is `undefined`, the redirect branch is skipped, and the request proceeds as if no deletion were pending. A user who requested deletion regains full access to `/dashboard`, `/decks`, `/api/decks`, etc. for that request, silently, with no logging. The existing `supabase.auth.getUser()` call two lines above has the same lax pattern, so this is consistent with an existing (lax) convention in this file — but here the consequence is an access-control bypass rather than just falling back to `user: null`.
- **Fix A ⭐ Recommended**: Check `error` and fail closed — on error, treat it the same as "pending deletion" (redirect) rather than "no pending deletion," since the safer default for an unknown state is to lock, not unlock.
  - Strength: Matches the feature's own stated intent (lock access whenever request state is uncertain) and requires touching only this one block.
  - Tradeoff: A transient DB hiccup would incorrectly lock out users with *no* pending deletion too, for one request.
  - Confidence: MED — no logging/alerting exists yet for this table (plan's own Migration Notes flags the purge job as unmonitored), so a fail-closed bug would be as invisible as the fail-open one is now.
  - Blind spot: Haven't checked whether Supabase client surfaces retryable vs. terminal errors distinctly here.
- **Fix B**: Log the error (e.g. `console.error`) and keep the current fail-open behavior, treating this as an acceptable rare-window risk since the purge job itself already has no alerting per the plan's Migration Notes.
  - Strength: No behavior change for the common case; adds visibility without new failure modes.
  - Tradeoff: The access-control bypass window still exists, just now observable after the fact.
  - Confidence: MED — consistent with this file's existing error-handling posture, but doesn't close the gap.
  - Blind spot: No existing logging/alerting sink in this codebase to confirm errors would actually be seen.
- **Decision**: FIXED (Fix A) — middleware now redirects to `/account/pending-deletion` on query error, treating unknown state as locked.

### F2 — DeleteAccountDialog uses a raw `<input>` instead of `FormField`, and the confirm text is never submitted

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/account/DeleteAccountDialog.tsx:58-68
- **Detail**: CLAUDE.md states `FormField` "wraps inputs with icon, error, and hint layout — use it instead of raw `<input>`," and every other form input in the codebase (`SignInForm`, `SignUpForm`, etc.) follows this. This new input hand-duplicates similar styling instead. Separately, the input has no `name` attribute, so on native form submission the typed confirmation text is never sent to `/api/account/delete` at all — the "type your email to confirm" gate exists only as a client-side `disabled` check on the submit button, which is trivially bypassed via devtools. Low real-world impact since the action is already scoped to the caller's own authenticated account via RLS, but it means the confirmation step is purely cosmetic rather than an enforced guard.
- **Fix**: Refactor to `FormField` (matching `SignInForm.tsx`'s usage) and add `name="confirmEmail"`; either verify it server-side in `delete.ts` or explicitly treat it as a client-side-only UX guard (current behavior, just no longer silently broken by a missing `name`).
- **Decision**: FIXED — refactored to `FormField` and added `name="confirmEmail"`; kept as a client-side-only guard (no server-side verification added).

### F3 — Cancel action implemented as an unplanned confirm-dialog component instead of a plain form

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/account/CancelDeletionDialog.tsx (new, not in plan); src/pages/account/pending-deletion.astro
- **Detail**: Plan's Phase 3 item 4 contract says pending-deletion.astro "renders a cancel form (`POST /api/account/cancel`)." The actual implementation adds a new, unplanned React island (`CancelDeletionDialog.tsx`) that opens a confirmation modal ("Cancel your account deletion request and restore full access?" / "Keep pending" / "Confirm cancel") before the form submits. Functionally it still posts to the correct endpoint and the plan's cancel contract is honored end-to-end, but it's added component surface area not described anywhere in the plan text, and unlike the `review.ts` type-narrowing fix in the same phase, it isn't called out in the commit message either.
- **Fix**: Add a short addendum to plan.md's Phase 3 item 4 documenting the confirm-dialog UX as implemented, since it's benign and consistent with `DeleteAccountDialog`'s own precedent in the same feature.
- **Decision**: FIXED — added an addendum to plan.md's Phase 3 item 4 documenting the `CancelDeletionDialog` confirm-modal as implemented.

## Observations

### O1 — Unrelated one-line fix bundled into the Phase 2 commit

- **Severity**: ℹ️ OBSERVATION
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/decks/[id]/review.ts (commit 8a577f1)
- **Detail**: `isValidGrade` gained a `typeof grade === "number"` check before `Number.isInteger(grade)`. Unrelated to account deletion, but the commit message explicitly discloses it as an unblocking fix for a pre-existing `astro check` type error, and it's a correct, minimal, defensive change.
- **Decision**: ACCEPTED — disclosed in commit message, correct, no action needed.

## Clean areas (no findings)

- **Purge migration** (`20260802133023_account_deletion_purge_cron.sql`): the highest-risk file in this feature — verified the `DELETE ... USING ... WHERE` join is an equi-join on a primary key (no fan-out risk), the time predicate is correct, and it matches the plan's exact specified SQL byte-for-byte.
- **RLS policies** on `account_deletion_requests`: owner-scoped, no cross-user leakage, no `update` policy (correct — a request is present or deleted, never edited).
- **`delete.ts` / `cancel.ts`**: both check `context.locals.user`, construct the Supabase client per-request (not a singleton), check `.error` on the mutation, and follow the existing redirect-with-query-param convention from `signin.ts`/`signup.ts`.
- **`src/env.d.ts`**: `pendingDeletionRequestedAt: string | null` correctly typed.
- **`database.types.ts`**: clean regeneration from the new migration, no hand-editing.
- All Phase 1 and Phase 2 planned changes: MATCH.
