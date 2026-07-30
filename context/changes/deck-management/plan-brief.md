# Deck Management — Plan Brief

> Full plan: `context/changes/deck-management/plan.md`

## What & Why

Users need somewhere to put flashcards before anything else in the roadmap can work: this slice adds create, view, and delete for named decks (FR-004/005/006). It's the direct prerequisite for the north star (S-02, AI-generated flashcard review) and every other slice — nothing downstream can persist a card without a deck to hold it.

## Starting Point

The `decks`/`cards` schema and RLS policies are already live (F-01, done). No deck UI or routes exist yet — only auth (`/auth/*`, `/api/auth/*`) and a placeholder `/dashboard` are built. `Topbar.astro` (nav bar) exists but was never wired into the shared layout, so there's currently no in-app navigation at all.

## Desired End State

A signed-in user clicks "Decks" in the nav, lands on `/decks`, types a name into a form to create a deck, sees it appear in their list immediately, and can delete any deck (with a confirmation prompt) — cards cascade-delete with it. A second user never sees or can touch the first user's decks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| List location | New `/decks` page (not dashboard) | Gives S-02–S-05 a namespace to build under without a later split |
| Creation UX | Inline form on the list page | Single text field doesn't justify a dedicated page + extra click |
| Duplicate name detection | Pre-check `SELECT` before insert | Simpler error messaging; still backed by the DB's `23505` unique-violation as a race-condition backstop |
| Delete confirmation | Native `confirm()` dialog | Zero new UI, consistent with the project's plain-HTML-form bias |
| Empty state | Friendly message, create form stays visible | No conditional logic needed — the form is always shown |
| Success/error feedback | Redirect + `?error=`, matching auth | Reuses the existing convention exactly; no new pattern |
| Nav wiring | Wire `Topbar` into `Layout` now, add "Decks" link | Without it `/decks` is only reachable by typing the URL |
| Testing bar | Lint + type-check + build only, manual for behavior | Matches F-01's precedent; test tooling is Module 3's topic, not this slice's |

## Scope

**In scope:** create a deck (name only), list a user's own decks, delete a deck (cascades to cards), route protection for `/decks` and `/api/decks`, nav link wiring.

**Out of scope:** deck rename/edit, card creation/browsing/generation (S-02–S-04), pagination/search, any JSON API or client-side state management, success banners/toasts.

## Architecture / Approach

Every route and form mirrors the existing auth feature exactly: native `<form method="POST">` submissions (no `fetch`), one `APIRoute` handler per action that redirects on both success and failure, and a per-request Supabase client. `/decks` and `/api/decks` are added to `PROTECTED_ROUTES` in `src/middleware.ts` so `context.locals.user` is guaranteed non-null inside the new routes. RLS (already live from F-01) is the actual ownership boundary for both delete and duplicate-name checks — application code never re-implements an ownership check the database already enforces.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Route protection & navigation | `/decks` + `/api/decks` guarded; "Decks" nav link wired | Middleware prefix matching — `/api/decks` needs its own entry, doesn't inherit from `/decks` |
| 2. Deck list + inline creation | List view, empty state, create form + duplicate-name handling | Race between pre-check and insert on duplicate names — needs both layers, not one |
| 3. Deck deletion | Delete action with confirm dialog, cascades to cards | First dynamic (`[id]`) route in the repo — no prior pattern to copy exactly |

**Prerequisites:** F-01 (done — schema/RLS live).
**Estimated effort:** ~1 session across 3 phases; small, well-precedented feature.

## Open Risks & Assumptions

- Astro middleware is assumed to run before route resolution even for not-yet-existing pages — Phase 1's manual verification checks this directly before Phase 2 is built.
- No card-creation path exists yet, so the "delete cascades cards" manual check in Phase 3 may have zero cards to verify against; acceptable since the FK behavior was already proven in F-01's RLS verification script.

## Success Criteria (Summary)

- A signed-in user can create, see, and delete their own named decks end-to-end through the UI.
- A second user can never see or affect another user's decks (RLS holds, including against forged requests).
- `npm run lint`, `npx astro check`, and `npm run build` all pass with no new errors.
