# Card Browsing, Editing, and Deletion — Plan Brief

> Full plan: `context/changes/card-browsing-and-editing/plan.md`

## What & Why

FR-010/011/012: a signed-in user can browse all cards in a deck, edit a card's front/back, and delete a card. Until now there's been no way to see a card after creating it (manual or AI-generated) — this slice closes that gap and gives users a way to fix or remove cards without deleting and recreating a whole deck.

## Starting Point

Schema/RLS (F-01) and deck CRUD (S-01) are both `impl_reviewed` and live. Card creation exists via two paths (manual: S-03, AI: S-02) but there is no list/edit/delete surface for an individual card anywhere — no `GET` list route, no `PATCH`/`DELETE` route. The codebase currently has two competing UI conventions: deck CRUD uses form-POST-redirect, while card creation uses React state + `fetch()`.

## Desired End State

From `/decks`, each deck gets a "View cards" link to a new `/decks/[id]` page showing that deck's cards, newest first, 25 per page. Each card has Edit (turns the row into an inline form) and Delete (opens a confirm dialog) actions. A second user can never browse, edit, or delete another user's cards, even via a forged ID.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| UI convention | React fetch-based, extending `CreateCardPanel`'s style | Inline edit-in-place is far more natural as client state than a page navigation; matches the two most recently-built card features | Plan |
| Entry point | New deck-detail page at `/decks/[id]` | Natural, extensible home for anything deck-scoped, matching existing `/decks/[id]/*` nesting | Plan |
| Edit interaction | Inline edit-in-place per row | Fastest interaction, no navigation, keeps list context | Plan |
| Delete confirmation | React-controlled `<dialog>`, mirroring the deck-list's confirm modal | Reuses a proven look/behavior without adopting the vanilla-script/form-submit mechanics that don't fit a fetch-based component | Plan |
| List scale | Server-side pagination, 25/page | Bounds load time regardless of deck size, ahead of the NFR's 500-card ceiling | Plan |
| Default ordering | Newest first (`created_at desc`) | Matches the deck list's own convention exactly | Plan |
| Edit conflict (duplicate front+back) | Inline error, edit row stays open | Directly reuses `manual.ts`'s existing `23505` → friendly-message handling | Plan |
| Testing bar | Lint + typecheck + build, manual for behavior | Matches every prior slice's precedent; no test framework exists yet | Plan |

## Scope

**In scope:**
- Paginated `GET` list endpoint and deck-detail page
- `PATCH`/`DELETE` endpoints for a single card, scoped to its deck
- `CardListPanel` component: paginated list, inline edit-in-place, delete-confirm dialog
- "View cards" nav link on `/decks`

**Out of scope:**
- Any schema/migration change
- Batch edit or batch delete
- Search/filter (pagination only)
- Changing deck CRUD's existing form-POST-redirect convention
- A shared `Card`/`Deck` types module (no precedent exists yet)
- A dedicated automated RLS cross-user test script (manual forged-ID checks only)

## Architecture / Approach

Three phases, one per FR, each independently verifiable. New API routes nest under the existing `src/pages/api/decks/[id]/cards*` structure: a `GET` handler added to `cards.ts`, and a new `cards/[cardId].ts` file holding `PATCH` and `DELETE`. All new UI lives in one component, `CardListPanel.tsx`, built read-only in Phase 1 and extended in place for edit (Phase 2) and delete (Phase 3) rather than rewritten. RLS is the real authorization boundary throughout — no application-level ownership re-checks, consistent with every prior slice.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Card list & entry point | `GET` list endpoint, `/decks/[id]` page, read-only paginated `CardListPanel`, nav link | Low — read-only, fully precedented by `cards/new.astro`'s deck-load pattern |
| 2. Inline card editing | `PATCH` endpoint, edit-in-place UI, 409-conflict handling | Getting the "conflict keeps the row open" interaction right, and correctly distinguishing 404 (`PGRST116`) from other errors |
| 3. Card deletion | `DELETE` endpoint, React-controlled confirm dialog | Pagination bookkeeping when deleting the last card on a non-first page |

**Prerequisites:** F-01 (schema/RLS) and S-01 (deck CRUD) — both done.
**Estimated effort:** ~1-2 sessions across 3 phases; similar scope to deck-management, plus one new interaction pattern (inline edit).

## Open Risks & Assumptions

- Assumes Supabase's `.single()`-on-zero-rows error code (`PGRST116`) is stable across the installed `@supabase/supabase-js` version — Phase 2's manual verification includes a forged-ID check that would surface a mismatch immediately.
- No dedicated automated RLS test exists (by design, per the confirmed testing bar) — cross-user isolation is checked manually once per phase, same residual risk every prior slice already accepted.

## Success Criteria (Summary)

- A signed-in user can browse, edit, and delete cards in their own decks, with changes persisting correctly.
- Editing into a duplicate front+back within the same deck is caught and surfaced inline, not silently rejected or crashed.
- A second user can never browse, edit, or delete another user's cards, including via forged IDs.
