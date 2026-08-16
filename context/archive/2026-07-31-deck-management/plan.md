# Deck Management Implementation Plan

## Overview

Implement create, view, and delete for named decks (FR-004, FR-005, FR-006) — the first user-visible slice on top of F-01's schema, and the prerequisite every other roadmap slice (S-02 through S-05) needs a deck to target. No schema work is required; this is purely an app-layer feature that follows the existing auth feature's conventions.

## Current State Analysis

- The `decks`/`cards` schema, RLS policies, and generated `Database` types are live (F-01, `context/changes/deck-card-schema-foundation/`). `decks` has a case-insensitive unique-per-user name constraint (`decks_user_id_lower_name_idx`) and cascades to `cards` on delete.
- The auth feature (`src/pages/api/auth/*.ts`, `src/pages/auth/*.astro`, `src/components/auth/*`) establishes the pattern every new form-driven feature in this codebase follows: native `<form method="POST" action="...">` submission (never `fetch`), a single `export const POST: APIRoute` handler per route reading `context.request.formData()`, and redirect-on-both-success-and-error with failures encoded as `?error=<message>`.
- `src/middleware.ts`'s `PROTECTED_ROUTES = ["/dashboard"]` is the single source of truth for route protection; neither `/decks` nor `/api/decks` exist yet, so they get no auth guarantee until added here.
- `src/components/Topbar.astro` (a user-aware nav bar with Dashboard/Sign out or Sign in/Sign up links) exists but is not rendered by `src/layouts/Layout.astro` or any page — there is currently no in-app navigation at all.
- No `src/pages/decks/` or `src/pages/api/decks/` directories exist. No dynamic (`[id]`) routes exist anywhere in the repo yet — this plan introduces the first one.
- `src/lib/supabase.ts`'s `createClient(requestHeaders, cookies)` must be called per-request (never a singleton) and returns `SupabaseClient<Database> | null` — every route must null-check it, matching the auth routes' handling of missing env config.

## Desired End State

A signed-in user can reach `/decks` from a nav link, see all decks they own (or an empty-state message if they have none), create a new deck by typing a name into an inline form at the top of that page, and delete any deck (with a confirmation prompt) — with the deck and all its cards removed. A second user never sees or can affect the first user's decks.

**Verification**: `npm run lint`, `npx astro check`, and `npm run build` all pass; manually, two different signed-in users each create decks and confirm neither can see or delete the other's.

### Key Discoveries:

- `src/db/database.types.ts:80-103` — `decks` Insert type requires `user_id` and `name`; nothing else. `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:15` — the unique index is `(user_id, lower(name))`, so duplicate detection must be case-insensitive.
- `src/lib/supabase.ts:7` and all three auth routes — every existing route creates its own client via `createClient(context.request.headers, context.cookies)`; there is no shared `locals.supabase`.
- `src/env.d.ts` — `Astro.locals` only has `user: User | null`, populated by `src/middleware.ts`. Adding `/api/decks` (not just `/decks`) to `PROTECTED_ROUTES` is what guarantees `context.locals.user` is non-null inside the new API routes — `/api/decks` does not start with `/decks` as a string prefix, so it needs its own entry.

## What We're NOT Doing

- No deck rename/edit — not in FR-004/005/006; out of scope for this slice.
- No card creation, browsing, or AI generation UI — that's S-02/S-03/S-04.
- No pagination or search on the deck list — data volume is small per the PRD's `target_scale`, and deck counts per user are expected to be modest.
- No client-side state management or optimistic UI — every action is a full-page POST + redirect, matching the existing auth convention.
- No dedicated `/decks/new` page — creation is inline on the list page (confirmed design decision).
- No success banner/toast on create or delete — only failures are surfaced via `?error=`, matching the existing auth convention; the new deck appearing in (or disappearing from) the list is the success signal.
- No JSON API responses anywhere in this slice — every route redirects, never returns a JSON body.

## Implementation Approach

Three phases, each independently testable: (1) wire up route protection and navigation so `/decks` and `/api/decks` exist as guarded, reachable paths before any deck logic is built; (2) list + inline creation on one page, since both read and write the same `decks` collection; (3) deletion, added last since it depends on decks already existing to delete. Every route and form mirrors the auth feature's shape exactly — no new architectural pattern is introduced.

## Critical Implementation Details

**Auth guarantee inside API routes**: because `/api/decks` is added to `PROTECTED_ROUTES` (see Phase 1), `context.locals.user` is guaranteed non-null by the time either deck API route's handler runs — the middleware will have already redirected an unauthenticated request to `/auth/signin` before the handler executes. The handlers can therefore use `context.locals.user.id` directly; TypeScript still types `locals.user` as `User | null`, so a narrow (`if (!user) return context.redirect(...)`, dead in practice but satisfies the type) is needed at the point of use, not a fresh auth check.

**Duplicate-name detection is two-layered, not one**: the pre-check (`.ilike("name", trimmedName)` with no wildcard characters, which PostgREST treats as an exact case-insensitive match) only prevents the common case. Two simultaneous submissions of the same name can both pass the pre-check before either inserts, so the insert's Postgres unique-violation (error code `23505`) must also be caught and mapped to the same friendly message — the pre-check is a UX nicety, the `23505` catch is the actual guarantee, and both are required together.

## Phase 1: Route protection & navigation

### Overview

Make `/decks` and `/api/decks` guarded routes, and give signed-in users a way to reach `/decks` at all.

### Changes Required:

#### 1. Middleware route protection

**File**: `src/middleware.ts`

**Intent**: Extend the single source of truth for route protection so both the deck page and its API routes require an authenticated user before their handlers run.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/decks", "/api/decks"];`

#### 2. Navigation wiring

**File**: `src/layouts/Layout.astro`

**Intent**: Render the existing (currently unused) `Topbar` on every page so there's an actual in-app navigation surface — without this, `/decks` is only reachable by typing the URL.

**Contract**: Import `Topbar` from `@/components/Topbar.astro` and render `<Topbar />` inside `<body>`, before the missing-config banners and `<slot />`.

#### 3. Decks nav link

**File**: `src/components/Topbar.astro`

**Intent**: Give signed-in users a visible entry point to the deck list alongside the existing Dashboard/Sign out links.

**Contract**: Add `<a href="/decks">Decks</a>` inside the existing `user ? (...)` branch.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`

#### Manual Verification:

- An unauthenticated request to `/decks` redirects to `/auth/signin`
- An unauthenticated POST to `/api/decks` redirects to `/auth/signin` (not a 404)
- A signed-in user sees a "Decks" link in the nav on any page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Deck list + inline creation

### Overview

The `/decks` page: lists the signed-in user's decks (or an empty-state message), with an inline creation form above the list.

### Changes Required:

#### 1. Deck list page

**File**: `src/pages/decks/index.astro`

**Intent**: Server-render the caller's decks and surface any create-error redirected back here; uses a subfolder (not a flat `decks.astro`) so a future `/decks/[id]` detail route (S-02/S-04) can sit alongside it without a file-naming clash.

**Contract**: Reads `Astro.locals.user` (non-null, guaranteed by Phase 1) and `Astro.url.searchParams.get("error")`; creates the client via `createClient(Astro.request.headers, Astro.cookies)`; queries `.from("decks").select("id, name, created_at").order("created_at", { ascending: false })` (RLS already scopes results to the caller, no explicit `user_id` filter needed); renders an empty-state message when the result is empty (create form still visible), otherwise a list of deck names; renders `<CreateDeckForm serverError={error} client:load />` above the list.

#### 2. Create deck form

**File**: `src/components/decks/CreateDeckForm.tsx`

**Intent**: Mirror `SignUpForm.tsx`'s structure for a single-field form, reusing the existing `FormField`/`ServerError`/`SubmitButton` components rather than building new ones.

**Contract**: `interface Props { serverError?: string | null }`; one `FormField` for `name` with client-side validation matching the DB constraint (trimmed, non-empty, ≤100 chars); `<form method="POST" action="/api/decks" onSubmit={handleSubmit} noValidate>`.

#### 3. Create deck API route

**File**: `src/pages/api/decks/index.ts`

**Intent**: Validate, detect a duplicate name, insert, and redirect — following the exact auth-route shape (`context.request.formData()`, per-request client, redirect on both outcomes).

**Contract**: `export const POST: APIRoute`; trims `name` from form data; empty or >100 chars → redirect `/decks?error=...`; otherwise pre-check via `.from("decks").select("id").ilike("name", trimmedName)`, and if the insert instead fails with `error.code === "23505"`, map both cases to the same "You already have a deck named "<name>"." message (see Critical Implementation Details for why both checks are needed); insert `{ user_id: context.locals.user.id, name: trimmedName }`; any other error → redirect with `error.message`; success → redirect to `/decks` with no query param.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Creating a deck with a valid name shows it immediately in the list
- Creating a deck with a name already used (any letter case) shows the friendly duplicate-name error and does not create a second row
- Submitting an empty name or one over 100 characters is blocked client-side with a validation message
- A second signed-in user sees an empty list — decks created by the first user are not visible (RLS isolation)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Deck deletion

### Overview

Let a user delete one of their decks, with a confirmation prompt, cascading to its cards.

### Changes Required:

#### 1. Delete deck API route

**File**: `src/pages/api/decks/[id]/delete.ts`

**Intent**: Delete the deck (and cascade its cards, per the FK's `on delete cascade`); ownership is enforced by the `decks_delete_own` RLS policy, not application code.

**Contract**: `export const POST: APIRoute`; reads `context.params.id`; `.from("decks").delete().eq("id", id)` — a request targeting another user's deck id matches zero rows under RLS rather than erroring, so no separate ownership check is written; redirect to `/decks` on success, `/decks?error=...` on failure.

#### 2. Delete form per row

**File**: `src/pages/decks/index.astro` (extends Phase 2's list rendering)

**Intent**: Add a per-deck delete action gated by a confirmation prompt, without introducing a React component or client-side state for a single yes/no gate.

**Contract**: Each row renders `<form method="POST" action={`/api/decks/${deck.id}/delete`} class="delete-deck-form" data-deck-name={deck.name}>`; a small inline module `<script>` attaches a submit listener to every `.delete-deck-form`, calling `confirm(...)` with the deck's name and calling `e.preventDefault()` if the user cancels.

**Addendum (post-implementation, 2026-07-31, via impl-review F3)**: implemented as a styled `<dialog>` with a small `pendingForm` client-side state variable instead of the planned native `confirm()`. This deviates from this section's stated intent ("without introducing ... client-side state for a single yes/no gate") — accepted because the styled dialog matches the app's existing glassmorphism aesthetic, a native `confirm()` would look out of place, and the behavior was already manually verified (criteria 3.4/3.5). See `context/changes/deck-management/reviews/impl-review.md` F3.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Confirming the delete prompt removes the deck from the list
- Canceling the delete prompt leaves the deck untouched
- A forged delete request (e.g. via `curl` with another user's session) for a deck id you don't own returns to `/decks` having deleted nothing — confirming RLS, not app logic, is the actual enforcement boundary

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — no test framework is configured in this repo yet (per CLAUDE.md); introducing one is out of scope for this slice (Module 3 territory, not this lesson's focus).

### Integration Tests:

- None automated — see Manual Testing Steps below.

### Manual Testing Steps:

1. As an unauthenticated visitor, confirm `/decks` and a POST to `/api/decks` both redirect to `/auth/signin`.
2. Sign in, confirm the "Decks" nav link is visible and navigates to `/decks`.
3. On an empty account, confirm the empty-state message shows and the create form is still usable.
4. Create a deck; confirm it appears in the list.
5. Attempt to create a second deck with the same name in different casing; confirm the friendly duplicate error and no new row.
6. Attempt to create a deck with an empty or >100-character name; confirm client-side validation blocks submission.
7. Delete a deck, canceling the confirm prompt first (deck remains), then confirming (deck and its cards, if any, are gone).
8. Sign in as a second user; confirm their deck list is empty and they cannot see or delete the first user's decks (including via a forged request to `/api/decks/<first-user-deck-id>/delete`).

## Performance Considerations

Data volume is small (`target_scale.data_volume: small` in `prd.md`); the deck list is an unpaginated, indexed query scoped by RLS — no performance concern at this scale.

## Migration Notes

No schema changes — F-01's migration already covers this slice's data model.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01, lines 76-86)
- PRD: `context/foundation/prd.md` (FR-004, FR-005, FR-006)
- Schema/RLS: `context/changes/deck-card-schema-foundation/plan.md`
- Auth pattern to mirror: `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Route protection & navigation

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 4518224
- [x] 1.2 Type checking passes: `npx astro check` — 4518224

#### Manual

- [x] 1.3 An unauthenticated request to `/decks` redirects to `/auth/signin` — 4518224
- [x] 1.4 An unauthenticated POST to `/api/decks` redirects to `/auth/signin` (not a 404) — 4518224
- [x] 1.5 A signed-in user sees a "Decks" link in the nav on any page — 4518224

### Phase 2: Deck list + inline creation

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 207b4bc
- [x] 2.2 Type checking passes: `npx astro check` — 207b4bc
- [x] 2.3 Build succeeds: `npm run build` — 207b4bc

#### Manual

- [x] 2.4 Creating a deck with a valid name shows it immediately in the list — 207b4bc
- [x] 2.5 Creating a deck with a name already used (any letter case) shows the friendly duplicate-name error and does not create a second row — 207b4bc
- [x] 2.6 Submitting an empty name or one over 100 characters is blocked client-side with a validation message — 207b4bc
- [x] 2.7 A second signed-in user sees an empty list — decks created by the first user are not visible (RLS isolation) — 207b4bc

### Phase 3: Deck deletion

#### Automated

- [x] 3.1 Linting passes: `npm run lint` — c9e7fed
- [x] 3.2 Type checking passes: `npx astro check` — c9e7fed
- [x] 3.3 Build succeeds: `npm run build` — c9e7fed

#### Manual

- [x] 3.4 Confirming the delete prompt removes the deck from the list — c9e7fed
- [x] 3.5 Canceling the delete prompt leaves the deck untouched — c9e7fed
- [x] 3.6 A forged delete request for a deck id you don't own returns to `/decks` having deleted nothing — c9e7fed
