# Manual Flashcard Creation Implementation Plan

## Overview

Implement FR-009: a signed-in user can manually create a flashcard (front and back) within one of their decks. This is S-03, fully independent of AI generation (S-02) and card browsing/editing (S-04, not yet built) — it only adds a `source: 'manual'` insert path against the schema F-01 already provides.

## Current State Analysis

- The `decks`/`cards` schema with RLS is live (F-01); `cards.source` already includes the `'manual'` enum value — no migration needed.
- The deck list (S-01) and AI generation/review (S-02) are both done, and establish two divergent conventions in this codebase: form-POST-redirect (deck create/delete) vs. JSON `fetch()` from client state (AI generate/save). This plan follows the latter, because "save a card, clear the form, keep a running list" is inherently a client-state interaction — the same reasoning S-02 documented for its own departure from the redirect convention.
- No card-browsing page exists yet (S-04 not built) — after creating a card there is currently nowhere else in the app to see it, so this plan's UI must give the user its own visibility into what they've just added (confirmed design decision, see below).
- `src/components/auth/FormField.tsx` only wraps a single-line `<input>`. The closest actual precedent for multi-line text entry is `GenerateFlashcardsPanel.tsx`'s raw `<textarea>` (label above, inline error below, matching Tailwind classes) — no shared wrapper component exists for it. This plan follows that raw-textarea precedent for both front and back fields rather than introducing a new wrapper component.
- `src/pages/api/decks/[id]/cards.ts` (existing, AI batch-save) inserts with a hardcoded `source: "ai"` — the client never controls `source`. This plan preserves that invariant with its own hardcoded `source: "manual"` in a new, separate route rather than parameterizing the existing one.
- `PROTECTED_ROUTES` in `src/middleware.ts` already guards by string prefix: `/decks` covers `/decks/[id]/cards/new` and `/api/decks` covers `/api/decks/[id]/cards/manual` — no middleware change needed.

## Desired End State

From `/decks`, each deck row has an "Add card" link leading to `/decks/[id]/cards/new`. There, the user fills in a front and back textarea and clicks "Add card"; the card is inserted immediately with `source: 'manual'`, the form clears, and the card appears at the top of a "Cards added this session" list below the form — so the user can add several cards in a row without re-navigating. A link back to `/decks` is always visible. A second user cannot create cards in, or see cards added to, the first user's deck (enforced by the same RLS policies F-01 already proved for the AI path).

Submitting a front/back pair that exactly matches an existing card already in that deck (whether from the AI path or a prior manual entry) is rejected with a clear error instead of inserting a duplicate row.

**Verification**: `npm run lint`, `npx astro check`, and `npm run build` all pass; manually, create several cards in a row and confirm each appears in the `cards` table with `source = 'manual'` and the correct `deck_id`; confirm a second user account cannot create a card against the first user's deck id; confirm resubmitting the exact same front/back for the same deck is rejected without inserting a second row.

### Key Discoveries:

- `src/db/database.types.ts:42-60` — the `cards` Insert type requires `deck_id`, `front`, `back`, `source`; the DB check constraints cap `front`/`back` at 2000 chars each (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql`), matching the AI path's existing client-side limit.
- `src/pages/api/decks/[id]/cards.ts:61` — the AI save route's insert (`source: "ai" as const`) is the exact shape to mirror, just singular and with `source: "manual"`.
- `src/pages/decks/[id]/generate.astro:6-17` — the deck-lookup + not-found redirect pattern (`.eq("id", id).maybeSingle()`, redirect to `/decks?error=Deck not found` if null) is the exact pattern for this plan's new page.
- The `cards_insert_own` RLS policy (from F-01, already proven by S-02) derives ownership via `decks.user_id`, so a forged `deck_id` for another user's deck is rejected by Postgres — no application-side ownership check is needed in the new API route.

## What We're NOT Doing

- No card browsing, editing, or deletion UI — that's S-04's scope; the session list here is not persisted or re-fetched, it exists only in the component's in-memory state for the current page visit.
- No batch/multi-card-at-once creation — one form submission creates exactly one card (unlike S-02's batch save).
- No DB-level uniqueness constraint on `(deck_id, front, back)` — the duplicate check added mid-implementation (see Changes Required #3) is an application-side query, not a schema migration; this keeps "No schema migration" intact below.
- No new shared textarea wrapper component — this plan follows the raw-`<textarea>` precedent already established by `GenerateFlashcardsPanel.tsx` rather than building a `FormField`-style abstraction for a single new use site.
- No changes to `src/middleware.ts` — existing route-protection prefixes already cover both new routes (see Current State Analysis).

## Implementation Approach

One new page, one new API route, and one new client component — all following the JSON-fetch client-state pattern S-02 established (not the redirect pattern), because "save and immediately clear the form, keep a running list" is inherently a client-state interaction. The API route is deliberately separate from the existing AI batch-save route (`cards.ts`) rather than parameterized, so `source` stays a server-decided value never accepted from the client, for either path.

## Phase 1: Manual card creation flow

### Overview

The full feature in one pass: an entry point on the deck list, a dedicated page, an API route that inserts a single manually-created card, and a component that owns the form and session list.

### Changes Required:

#### 1. Add-card entry point

**File**: `src/pages/decks/index.astro`

**Intent**: Give the user a way to reach the new page from each deck row, alongside the existing "Generate cards" and "Delete" actions.

**Contract**: One `<a href={`/decks/${deck.id}/cards/new`}>Add card</a>` per list item, positioned between "Generate cards" and "Delete", matching the same visual weight as the existing links.

#### 2. Manual card creation page

**File**: `src/pages/decks/[id]/cards/new.astro` (new)

**Intent**: Server-render the page shell (deck name, back link) and mount the client-side create form; mirrors `generate.astro`'s shape exactly.

**Contract**: Reads `Astro.params.id`; creates the per-request Supabase client; queries `.from("decks").select("id, name").eq("id", id).maybeSingle()`; redirects to `/decks?error=${encodeURIComponent("Deck not found")}` if null (RLS-scoped, so this also covers another user's deck id); renders `<CreateCardPanel deckId={deck.id} client:load />` under a "← Decks" back link and an "Add a card — {deck.name}" heading.

#### 3. Manual card creation API route

**File**: `src/pages/api/decks/[id]/cards/manual.ts` (new)

**Intent**: Insert exactly one card tagged `source: 'manual'` for the given deck.

**Contract**: `export const POST: APIRoute`; JSON body `{ front: string; back: string }`; validates both are non-empty (after trim) and ≤2000 characters, mirroring `cards.ts`'s `isValidCardInput` shape but for a single item, not an array; on validation failure, `400 { error: string }`; before inserting, queries `.from("cards").select("id", { count: "exact", head: true }).eq("deck_id", id).eq("front", front).eq("back", back)` (exact match, RLS-scoped to the caller's own decks) — if `count` is non-zero, responds `409 { error: "A card with this exact front and back already exists in this deck" }` without inserting; otherwise inserts `{ deck_id: id, front, back, source: "manual" as const }` via `.from("cards").insert(...).select("front, back").single()`; a forged `id` for another user's deck fails at the database via `cards_insert_own` RLS (see Key Discoveries) and is surfaced as the insert's own `4xx` error, not a separate application check; responds `200 { card: { front, back } }` on success.

#### 4. Create-card panel component

**File**: `src/components/decks/CreateCardPanel.tsx` (new)

**Intent**: Own the front/back form, submit to the new route, clear and refocus on success, and render a running list of cards added during this page visit.

**Contract**: `useState` for `front`, `back`, `fieldError: string | undefined`, `isSaving`, `saveError: string | null`, `sessionCards: { front: string; back: string }[]` (new saves prepended, newest first). Two raw `<textarea>` fields (front, back), each following `GenerateFlashcardsPanel`'s existing textarea markup/classes (label above, inline `CircleAlert` error below) rather than a new wrapper component. Client-side validation before submit: both fields non-empty after trim and ≤2000 characters (same limit as the DB constraint), one shared `fieldError` message covering whichever field fails first. On submit: `fetch(`/api/decks/${deckId}/cards/manual`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front, back }) })`; on success, prepend the returned card to `sessionCards`, clear both fields, refocus the front textarea; on failure, set `saveError` and leave the entered text in place (no clearing) so the user can retry without retyping. Below the form, render "Cards added this session ({sessionCards.length})" and the list itself (front/back, read-only) when non-empty; always render a "← Decks" link.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- The "Add card" link appears on every deck row in `/decks` and navigates to the correct deck's create-card page.
- An unauthenticated request to `/decks/<id>/cards/new` and a direct POST to `/api/decks/<id>/cards/manual` both redirect to `/auth/signin`.
- Visiting the create-card page for a deck id that doesn't belong to you (or doesn't exist) redirects to `/decks` with a "Deck not found" error.
- Creating a card with valid front/back text clears the form, adds the card to the session list, and the textarea keeps focus for immediate next entry.
- Submitting an empty or >2000-character front or back is blocked client-side with a clear message before any network call.
- Creating several cards in a row (without navigating away) shows all of them in the session list, newest first.
- Querying the `cards` table directly confirms each created row has `source = 'manual'` and the correct `deck_id`.
- As a second user account, a forged POST to `/api/decks/<first-user-deck-id>/cards/manual` fails and no row is inserted (RLS holds).
- Submitting a front/back pair that exactly matches an existing card in the same deck is rejected with a clear error and inserts nothing.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

None — no test framework is configured in this repo yet (per `CLAUDE.md`); consistent with the F-01/S-01/S-02 precedent.

### Integration Tests:

None automated — see Manual Testing Steps below.

### Manual Testing Steps:

1. As an unauthenticated visitor, confirm both new routes redirect to `/auth/signin`.
2. Sign in, confirm "Add card" appears on a deck row and navigates correctly.
3. Create a card with valid front/back text; confirm it clears the form and appears in the session list.
4. Create 2-3 more cards in the same visit; confirm the session list accumulates them, newest first.
5. Attempt an empty front, then an empty back, then a >2000-character field; confirm client-side blocks with no network call in each case.
6. Query the `cards` table and confirm the created rows have `source = 'manual'` and the correct `deck_id`.
7. Visit `/decks/<id>/cards/new` for a nonexistent or another user's deck id; confirm redirect to `/decks` with "Deck not found".
8. Sign in as a second user; confirm a forged POST to the first user's deck id is rejected and creates nothing.
9. Create a card, then submit the identical front/back again for the same deck; confirm it's rejected with an error and no second row is created.

## Performance Considerations

Single-row inserts against a small data volume (`target_scale.data_volume: small` in `prd.md`) — no performance concern.

## Migration Notes

No schema migration — `cards.source = 'manual'` already exists from F-01. No existing data to migrate.

## References

- Roadmap: `context/foundation/roadmap.md` (S-03, lines 101-111)
- PRD: `context/foundation/prd.md` (FR-009)
- Precedent implementation: `context/changes/ai-generated-flashcard-review/plan.md`, `src/pages/api/decks/[id]/cards.ts`, `src/pages/decks/[id]/generate.astro`, `src/components/decks/GenerateFlashcardsPanel.tsx`
- Schema: `supabase/migrations/20260729164431_deck_card_schema_foundation.sql` (`cards.source` enum)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Manual card creation flow

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — b52357b
- [x] 1.2 Linting passes: `npm run lint` — b52357b
- [x] 1.3 Build succeeds: `npm run build` — b52357b

#### Manual

- [x] 1.4 The "Add card" link appears on every deck row and navigates correctly — b52357b
- [x] 1.5 Unauthenticated requests to both new routes redirect to `/auth/signin` — b52357b
- [x] 1.6 Visiting the create-card page for a deck you don't own/doesn't exist redirects to `/decks` with "Deck not found" — b52357b
- [x] 1.7 Creating a card with valid text clears the form, adds it to the session list, and refocuses the front field — b52357b
- [x] 1.8 Empty or >2000-character front/back is blocked client-side before any network call — b52357b
- [x] 1.9 Multiple cards created in one visit accumulate in the session list, newest first — b52357b
- [x] 1.10 Created rows have `source = 'manual'` and correct `deck_id` in the database — b52357b
- [x] 1.11 A forged cross-user POST is rejected and inserts nothing — b52357b
- [x] 1.12 Submitting an exact front/back duplicate for the same deck is rejected and inserts nothing — b52357b
