# Card Browsing, Editing, and Deletion Implementation Plan

## Overview

Add card browsing, inline editing, and deletion to a deck (FR-010/011/012). A new deck-detail page hosts a paginated card list; a single React panel (`CardListPanel`) owns list state, inline edit-in-place, and a delete-confirm dialog, following the fetch-based client-state convention `CreateCardPanel` established for card creation rather than the deck list's form-POST-redirect convention.

## Current State Analysis

- **Schema/RLS (F-01, live):** `cards` (`src/db/database.types.ts:42-103`) has `id, deck_id, front, back, source, created_at, updated_at`. RLS policies (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:82-131`) gate all four operations via a join to `decks.user_id = auth.uid()` — no denormalized `user_id` on `cards`. A second migration (`20260801114731_cards_unique_front_back.sql`) adds a unique index on `(deck_id, md5(front || back))`, enforced as Postgres error `23505`.
- **No browse/edit/delete surface exists for a single card.** `src/pages/api/decks/[id]/cards.ts` only has `POST` (AI batch insert); `src/pages/api/decks/[id]/cards/manual.ts` only has `POST` (single manual insert). No `GET` list route, no `PATCH`/`DELETE` route for an individual card.
- **Two UI conventions are live and this plan deliberately extends only one.** Deck CRUD (`src/pages/decks/index.astro`) uses native `<form method="POST">` + redirect, with a shared `<dialog>` + vanilla `<script>` for delete confirmation (lines 40-127). Card creation (`src/components/decks/CreateCardPanel.tsx`) uses React state + `fetch()` JSON calls with no page reload. This plan follows the `CreateCardPanel` convention throughout, including a **React-controlled** `<dialog>` for delete confirmation (state-driven, not the vanilla-script/form-submit version decks use).
- **Route protection needs no changes.** `PROTECTED_ROUTES` in `src/middleware.ts:4` is `["/dashboard", "/decks", "/api/decks"]`, matched via `startsWith` (line 18) — the new `/decks/[id]` page and `/api/decks/[id]/cards*` routes are already covered.
- **No shared `Card`/`Deck` type module exists.** Every file redefines its own local `CardInput` interface and `isValidCardInput` type guard (`cards.ts:4-20`, `manual.ts:4-20`, identical). This plan continues that convention rather than introducing a shared types module, since no precedent for one exists yet.

## Desired End State

From `/decks`, each deck row gets a "View cards" link to `/decks/[id]`. That page shows the deck's cards, newest first, 25 per page, with Prev/Next controls. Each card row has Edit and Delete buttons. Edit turns the row's front/back into textareas in place; Save persists via `PATCH`, Cancel discards. Delete opens a confirm dialog showing the card's content; confirming removes it and adjusts pagination if that was the last card on a non-first page. A second user can never browse, edit, or delete another user's cards, including via a forged `deckId`/`cardId` in the URL or request body (RLS-enforced).

**Verification:** `npm run lint`, `npx astro check`, and `npm run build` all pass with no new errors; manual walkthrough of browse/edit/delete against a real deck, plus a forged-ID check with a second account.

### Key Discoveries:

- `src/pages/decks/[id]/cards/new.astro:6-17` is the exact deck-load/404-guard pattern to copy for the new deck-detail page.
- `src/components/decks/CreateCardPanel.tsx:16-82` is the exact fetch/state/validate shape (`isSaving`, `saveError`, `fieldError`, `isMountedRef` unmount guard) to extend for list, edit, and delete state.
- `manual.ts:66-80`'s `23505` → 409 handling is the pattern the new `PATCH` route must reuse for edit-time conflicts.
- Supabase's `.select().single()` on an `UPDATE`/`DELETE` that matches zero rows returns an error object (code `PGRST116`), not a null-without-error — see Critical Implementation Details below.

## What We're NOT Doing

- No schema or migration changes — the existing `cards` table and RLS already support all three operations.
- No batch edit or batch delete.
- No card search/filter — only pagination.
- No change to deck CRUD's existing form-POST-redirect convention.
- No shared `Card`/`Deck` types module — new files follow the existing per-file local-interface convention.
- No dedicated RLS cross-user test script — manual verification includes one forged-ID check per phase, consistent with prior slices' testing bar.

## Implementation Approach

Three phases, one per FR, each independently verifiable: list (FR-010), edit (FR-011), delete (FR-012). All new API routes live under `src/pages/api/decks/[id]/cards*`, matching the existing nesting. All new UI lives in one component, `CardListPanel.tsx`, which Phase 1 creates read-only and Phases 2-3 extend in place — avoiding a churn-y rewrite once edit/delete land.

## Critical Implementation Details

- **Not-found vs. error on `PATCH`/`DELETE`:** Supabase's `.update(...).eq(...).select().single()` (and the `DELETE` equivalent) returns an error with `code === "PGRST116"` when zero rows match — this is the case for both "card doesn't exist" and "card belongs to another user's deck" (RLS silently excludes the row). The new route must check for `PGRST116` explicitly and return 404, before falling through to the generic 400 branch — otherwise a not-found/not-owned request would incorrectly report a generic save failure.
- **Pagination after delete:** if deleting a card empties the current page and `page > 1`, decrement the local `page` state *before* triggering the refetch for that page, not after — otherwise the UI briefly renders an empty page before correcting itself.

## Phase 1: Card list & entry point

### Overview

Adds the paginated list endpoint, the deck-detail page, the read-only `CardListPanel`, and the "View cards" nav link. No edit/delete yet — this phase makes FR-010 independently testable.

### Changes Required:

#### 1. Paginated list endpoint

**File**: `src/pages/api/decks/[id]/cards.ts`

**Intent**: Add a `GET` handler alongside the existing `POST` (AI batch insert) to return one page of a deck's cards, newest first.

**Contract**: `GET /api/decks/[id]/cards?page=&pageSize=`. Reads `page`/`pageSize` from `context.url.searchParams`, defaulting to `1`/`25`; clamps `page >= 1` and `1 <= pageSize <= 100`, returning 400 on invalid values. Requires `context.locals.user` (401 otherwise, matching the existing `POST` handler's check). Queries `supabase.from("cards").select("id, front, back, source, created_at", { count: "exact" }).eq("deck_id", id).order("created_at", { ascending: false }).range(from, to)` where `from = (page - 1) * pageSize` and `to = from + pageSize - 1`. Returns `200 { cards, page, pageSize, total }`. RLS (already live) means a deck the caller doesn't own yields an empty `cards` array and `total: 0`, not an error — no application-level ownership check needed, matching the existing `POST` handler's approach.

#### 2. Deck-detail page

**File**: `src/pages/decks/[id]/index.astro`

**Intent**: New page hosting the card list for one deck.

**Contract**: Mirrors `src/pages/decks/[id]/cards/new.astro:6-17` exactly for the deck-load/guard: load `supabase.from("decks").select("id, name").eq("id", id).maybeSingle()`, redirect to `/decks?error=...` if Supabase is unconfigured or the deck isn't found. Renders `<CardListPanel deckId={deck.id} client:load />` inside the same `Layout`/heading/back-link structure as `cards/new.astro:20-31`.

#### 3. Read-only card list panel

**File**: `src/components/decks/CardListPanel.tsx` (new)

**Intent**: Client component that fetches and displays one page of cards, with Prev/Next controls. Edit/Delete buttons are added in later phases but the component and its state shape are established now.

**Contract**: Props `{ deckId: string }`. State: `cards`, `page` (default 1), `pageSize` (25, fixed), `total`, `isLoading`, `loadError`. On mount and whenever `page` changes, `fetch(`/api/decks/${deckId}/cards?page=${page}&pageSize=25`)`; on non-OK response or thrown error, set `loadError` (reuse `CreateCardPanel.tsx`'s `isMountedRef` unmount-guard pattern for all state updates after an async call). Renders: loading text, `loadError` banner, an empty-deck message when `total === 0`, otherwise a list of cards (front/back shown in full — no truncation, since NFR caps a deck's practical size well under a page) and Prev/Next buttons disabled at the first/last page (`Math.ceil(total / pageSize)`).

#### 4. Nav entry point

**File**: `src/pages/decks/index.astro`

**Intent**: Add a "View cards" link per deck row so the new page is reachable.

**Contract**: Add `<a href={`/decks/${deck.id}`}>View cards</a>` alongside the existing "Generate cards" / "Add card" links at `src/pages/decks/index.astro:34-39`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- A deck with several cards shows them newest-first, 25 per page, with working Prev/Next.
- A deck with zero cards shows a friendly empty message, not an error.
- A deck with a name/ID that doesn't belong to the signed-in user (typed directly into the URL) redirects to `/decks?error=...` rather than leaking another user's deck.
- "View cards" link on `/decks` navigates to the correct deck.

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Inline card editing

### Overview

Adds the edit endpoint and inline edit-in-place UI to `CardListPanel`, making FR-011 independently testable.

### Changes Required:

#### 1. Card update endpoint

**File**: `src/pages/api/decks/[id]/cards/[cardId].ts` (new)

**Intent**: `PATCH` handler to update one card's front/back, scoped to its deck.

**Contract**: `PATCH /api/decks/[id]/cards/[cardId]` with JSON body `{ front, back }`. Same 401 check and `isValidCardInput`/`CardInput` validation as `manual.ts:4-28` (front/back non-empty, ≤2000 chars each). Runs `supabase.from("cards").update({ front, back }).eq("id", cardId).eq("deck_id", id).select("id, front, back, source, created_at").single()`. Error handling, in order: `error.code === "23505"` → 409 with the same message `manual.ts:69` uses; `error.code === "PGRST116"` → 404 `"Card not found"`; any other error → 400 with `error.message`. Success → `200 { card }`.

#### 2. Inline edit UI

**File**: `src/components/decks/CardListPanel.tsx`

**Intent**: Add an Edit button per row that turns that row's front/back into editable textareas, with Save/Cancel.

**Contract**: New state: `editingCardId` (id of the row in edit mode, or `null` — only one row editable at a time), `editFront`, `editBack`, `editFieldError`, `editSaveError`, `isSavingEdit`. Clicking Edit sets `editingCardId` and seeds `editFront`/`editBack` from the card's current values. Save re-runs the same front/back validation as `CreateCardPanel.tsx:32-38`, then `fetch(PATCH ...)`; on 409/other error, set `editSaveError` from the response body and **keep the row in edit mode** (per the confirmed edit-conflict decision) rather than reverting or closing it; on success, replace the card in local `cards` state with the returned `card` and clear `editingCardId`. Cancel clears `editingCardId` without a request, discarding in-progress edits.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Editing a card's front/back persists and re-renders with the new text.
- Editing a card to exactly match another existing card's front+back in the same deck shows the inline "already exists" message and leaves the row open for another attempt.
- Cancel discards in-progress edits without a network call.
- A forged `cardId` belonging to another user's deck returns 404 and the UI surfaces the failure (not a silent no-op).

**Implementation Note**: Pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Card deletion

### Overview

Adds the delete endpoint and a React-controlled confirm dialog to `CardListPanel`, completing FR-012.

### Changes Required:

#### 1. Card delete endpoint

**File**: `src/pages/api/decks/[id]/cards/[cardId].ts`

**Intent**: Add a `DELETE` handler alongside the `PATCH` added in Phase 2.

**Contract**: `DELETE /api/decks/[id]/cards/[cardId]`. Same 401 check. Runs `supabase.from("cards").delete().eq("id", cardId).eq("deck_id", id).select("id").maybeSingle()`. If `data` is `null` (no matching row — nonexistent or not owned), return 404 `"Card not found"`. Otherwise 200 with an empty body.

#### 2. Delete confirm UI

**File**: `src/components/decks/CardListPanel.tsx`

**Intent**: Add a Delete button per row, wired to a single shared `<dialog>` confirm, mirroring `src/pages/decks/index.astro:61-127`'s look and behavior but driven by React state instead of the vanilla-script/form-submit version decks use.

**Contract**: New state: `pendingDelete` (the card object pending confirmation, or `null`), `isDeleting`. Clicking a row's Delete button sets `pendingDelete` to that card and calls the dialog ref's `showModal()`. The dialog shows the card's front text and Cancel/Confirm buttons; Cancel (button, backdrop click, or `Esc`) clears `pendingDelete` and closes the dialog, matching `src/pages/decks/index.astro:106-126`'s cancel/backdrop/`Esc` handling. Confirm calls `fetch(DELETE ...)`; on success, remove the card from local `cards` state and, per the Critical Implementation Details note above, decrement `page` first if the page is now empty and `page > 1`, then let the existing page-change effect refetch; on error, show an inline error near the dialog and leave `pendingDelete` set so the user can retry or cancel.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Delete button opens the confirm dialog showing the correct card's content.
- Cancel (button, backdrop click, `Esc`) leaves the card intact.
- Confirm removes the card and updates the list/pagination correctly, including when deleting the last card on a non-first page.
- A forged `cardId` belonging to another user's deck returns 404 rather than deleting anything.

---

## Testing Strategy

### Manual Testing Steps:

1. As a signed-in user with a deck containing 30+ cards, browse to `/decks/[id]` and page through the full list, confirming order and pagination boundaries.
2. Edit a card, save, and confirm the change persists across a page reload.
3. Attempt to edit a card into a duplicate of another card in the same deck; confirm the inline conflict message and that the row stays open.
4. Delete a card via the confirm dialog; repeat while on the last page with exactly one card remaining to confirm the page-decrement behavior.
5. As a second user, attempt `GET`/`PATCH`/`DELETE` against the first user's `deckId`/`cardId` (e.g. via browser devtools or a manual `fetch` in the console) and confirm 404/empty results, never another user's data.

## Performance Considerations

Server-side pagination (25/page) keeps each list request bounded regardless of deck size, satisfying the NFR's 500-card ceiling with room to spare — no client-side virtualization needed at this scale.

## Migration Notes

None — no schema changes.

## References

- Prior implementation: `context/changes/manual-flashcard-creation/plan.md`, `context/changes/ai-generated-flashcard-review/plan.md`
- Schema: `supabase/migrations/20260729164431_deck_card_schema_foundation.sql`, `supabase/migrations/20260801114731_cards_unique_front_back.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Card list & entry point

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 4b6b019
- [x] 1.2 Type checking passes: `npx astro check` — 4b6b019
- [x] 1.3 Build succeeds: `npm run build` — 4b6b019

#### Manual

- [x] 1.4 Deck with several cards shows newest-first, 25/page, working Prev/Next — 4b6b019
- [x] 1.5 Deck with zero cards shows friendly empty message — 4b6b019
- [x] 1.6 Forged deck id/name redirects to `/decks?error=...` without leaking data — 4b6b019
- [x] 1.7 "View cards" link navigates correctly — 4b6b019

### Phase 2: Inline card editing

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — ebfa196
- [x] 2.2 Type checking passes: `npx astro check` — ebfa196
- [x] 2.3 Build succeeds: `npm run build` — ebfa196

#### Manual

- [x] 2.4 Editing a card persists and re-renders with new text — ebfa196
- [x] 2.5 Duplicate-content edit shows inline conflict message, row stays open — ebfa196
- [x] 2.6 Cancel discards in-progress edits without a network call — ebfa196
- [x] 2.7 Forged cardId returns 404, surfaced in UI — ebfa196

### Phase 3: Card deletion

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Type checking passes: `npx astro check`
- [x] 3.3 Build succeeds: `npm run build`

#### Manual

- [x] 3.4 Delete dialog shows correct card content
- [x] 3.5 Cancel (button/backdrop/Esc) leaves card intact
- [x] 3.6 Confirm removes card and updates pagination correctly, including last-item-on-non-first-page case
- [x] 3.7 Forged cardId returns 404, deletes nothing
