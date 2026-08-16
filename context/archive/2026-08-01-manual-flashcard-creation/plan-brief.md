# Manual Flashcard Creation — Plan Brief

> Full plan: `context/changes/manual-flashcard-creation/plan.md`

## What & Why

FR-009: a signed-in user can manually create a flashcard (front and back) within a deck. This is the fallback path for whatever AI generation (S-02) misses, and doubles as the escape hatch if AI quality is initially disappointing — kept deliberately independent of the AI flow so it can ship without any contention.

## Starting Point

The `decks`/`cards` schema, RLS, and `cards.source` enum (`'ai' | 'manual'`) are all live from F-01. Deck list/create/delete (S-01) and AI generation/review (S-02) are both done. No card-browsing page exists yet (S-04) — so today there is no way to see a card after creating it, manual or otherwise.

## Desired End State

Each deck row on `/decks` gets an "Add card" link. On the resulting page, the user fills a front/back form and clicks "Add card": the card saves immediately as `source: 'manual'`, the form clears, and the card appears in a running "added this session" list — letting the user add several cards in one sitting despite there being no permanent card list to check against yet.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Entry point / page structure | Dedicated page `/decks/[id]/cards/new` | Mirrors the existing `/decks/[id]/generate` pattern; a two-field form doesn't fit cleanly inline in the deck list row. | Plan |
| Post-save flow | Stay on page, clear form, add another | No card-browsing page exists yet, so repeat-add-in-place is the only way to create several cards without re-navigating each time. | Plan |
| Session feedback | Running list of cards added this session | Mirrors S-02's post-save confirmation list; gives real visibility into a gap S-04 hasn't filled. | Plan |
| Field input type | Textarea for both front and back | Both fields are capped at 2000 chars in the DB; a "front" can legitimately be a longer prompt, not just a short question. | Plan |
| Implementation pattern | JSON `fetch()` + client state (not form-POST-redirect) | "Save, clear, keep a list" is a client-state interaction — same reasoning S-02 used to justify its own departure from the redirect convention. | Plan |
| API route boundary | New separate route (`cards/manual.ts`), not a parameterized `cards.ts` | Keeps `source` a server-decided value never accepted from the client, for both the AI and manual paths. | Plan |

## Scope

**In scope:**
- "Add card" entry point on `/decks`
- New page `/decks/[id]/cards/new`
- New API route `/api/decks/[id]/cards/manual` (single-card insert, `source: 'manual'`)
- New `CreateCardPanel` component: form + client-side validation + session-local created-cards list

**Out of scope:**
- Card browsing, editing, or deletion (S-04)
- Batch/multi-card creation in one request
- Duplicate-content detection
- Any new shared textarea wrapper component (raw `<textarea>`, matching `GenerateFlashcardsPanel`'s existing precedent)
- Middleware changes (existing `/decks` and `/api/decks` prefixes already cover the new routes)

## Architecture / Approach

A single new page/route/component trio, following the same JSON-fetch-from-client-state shape S-02 introduced for its generate/save flow — deliberately not the form-POST-redirect shape used by deck create/delete, because clearing a form and accumulating a list in place isn't representable as a page navigation. `source: 'manual'` is hardcoded server-side in the new route, exactly mirroring how `source: 'ai'` is hardcoded in the existing batch-save route.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Manual card creation flow | Nav entry point, page, API route, and component — the complete feature | Low — single cohesive unit of work reusing fully-proven schema/RLS/patterns from S-01/S-02 |

**Prerequisites:** F-01 (schema/RLS) and S-01 (deck list) — both done.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- None outstanding — all four design decisions were resolved during questioning (entry point, post-save flow, session feedback, field type), and the remaining implementation choices (raw textarea vs. new wrapper, separate route vs. parameterized) were resolved by following the closest existing precedent in the codebase.

## Success Criteria (Summary)

- A user can create a manual flashcard from any of their decks and see it persist with `source = 'manual'`.
- A user can create several cards in one visit without re-navigating, and see all of them reflected in a session list.
- A second user cannot create or see cards against another user's deck (RLS-enforced, already proven by S-02).
