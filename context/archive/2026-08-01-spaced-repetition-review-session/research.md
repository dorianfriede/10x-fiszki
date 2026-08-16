---
date: 2026-08-01T00:00:00Z
researcher: Claude Sonnet 5
git_commit: 2c162d431bfec4fabc35d60a30a0924d763c2a44
branch: main
repository: 10x-fiszki
topic: "Is ts-fsrs-api-docs.md compatible with the current codebase for S-05 (spaced-repetition-review-session)?"
tags: [research, codebase, srs, ts-fsrs, s-05, schema, api-routes, cloudflare]
status: complete
last_updated: 2026-08-01
last_updated_by: Claude Sonnet 5
---

# Research: ts-fsrs compatibility with the codebase for S-05

**Date**: 2026-08-01
**Researcher**: Claude Sonnet 5
**Git Commit**: 2c162d431bfec4fabc35d60a30a0924d763c2a44
**Branch**: main
**Repository**: 10x-fiszki

## Research Question

Review the codebase and decide whether `context/changes/spaced-repetition-review-session/ts-fsrs-api-docs.md` (the Context7-fetched `ts-fsrs` API reference) is compatible with it, in order to implement roadmap item S-05 (`spaced-repetition-review-session`).

## Summary

**Yes, `ts-fsrs` is compatible with this codebase — runtime-wise there is no blocker at all.** The library is pure TypeScript (deps: `dayjs`, `seedrandom`), the project's Cloudflare adapter already runs with `nodejs_compat` enabled (`wrangler.jsonc:6`, more permissive than `ts-fsrs` even requires), and there are no conflicting date-library versions in `package.json`.

However, **none of the schema, API, or UI scaffolding S-05 needs exists yet** — this isn't a blocker, it's simply the expected state for a roadmap item that just moved from "blocked on library choice" to "ready." Three concrete gaps `/10x-plan` must account for:

1. **Schema**: the `cards` table (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:21-29`) has zero FSRS fields — no `due`, `stability`, `difficulty`, `state`, `reps`, `lapses`, `elapsed_days`, `scheduled_days`, `learning_steps`, or `last_review`. A new migration is required, plus a `database.types.ts` regen. No `reviews`/`review_log` history table exists — the already-recorded decision (`srs-library-research.md:33`) is to persist FSRS state directly on `cards` rows, which the docs mark as sufficient (the review-log table is called out as optional).
2. **Serialization boundary** (a nuance not spelled out in `ts-fsrs-api-docs.md`'s "Implementation shape" section): `ts-fsrs`'s `Card.due` / `Card.last_review` are JS `Date` objects, but Supabase/PostgREST returns/accepts `timestamptz` columns as ISO strings over `supabase-js`. The new API route will need explicit `new Date(row.due)` / `.toISOString()` conversions when moving data between the DB row and the `CardInput`/`Card` shape — the docs' step "2. Reconstruct as CardInput/Card" glosses over this.
3. **API + UI**: no review route exists (`src/pages/api/decks/[id]/...` has `cards.ts`, `cards/manual.ts`, `cards/[cardId].ts`, `generate.ts`, `delete.ts` — no `review`), and no review-session UI concept exists at all — card front/back are always shown simultaneously with no flip/reveal interaction, and no 4-button rating component exists. Both are new builds, not extensions of existing code, but both have clear precedent patterns to mirror (see below).

## Detailed Findings

### 1. Schema & migrations (F-01 baseline)

- Migrations live at `supabase/migrations/`: only two files exist —
  - `supabase/migrations/20260729164431_deck_card_schema_foundation.sql` (132 lines) — creates `card_source` enum, `decks`, `cards`, triggers, and all RLS policies.
  - `supabase/migrations/20260801114731_cards_unique_front_back.sql` (7 lines) — unrelated unique-hash index.
- Current `cards` columns (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:21-29`): `id, deck_id, front, back, source, created_at, updated_at`. **No FSRS field exists under any name** (checked for `due`, `interval`, `ease`, `next_review`, etc. — none present).
- `decks` columns (lines 7-13): `id, user_id, name, created_at, updated_at` — also no review-related columns.
- RLS ownership model: `decks.user_id = auth.uid()` is the anchor (`:59-78`). `cards` has **no `user_id` column** — ownership is derived transitively via an `exists (select 1 from decks where decks.id = cards.deck_id and decks.user_id = auth.uid())` subquery on every `cards` policy (`:82-131`). This means **new FSRS columns added to `cards` are automatically covered by the existing row-level policies** — no new RLS policy needed, since RLS is row-scoped, not column-scoped.
- No `reviews`/`review_log`/`card_reviews` table exists anywhere (confirmed via `create table` grep across both migrations).
- TypeScript mirrors of the `cards` row, all missing FSRS fields and needing extension:
  - Generated types: `src/db/database.types.ts:42-79` (`Database["public"]["Tables"]["cards"]`) — regenerated from schema via Supabase CLI, not hand-edited.
  - Component-level subset: `src/components/decks/CardListPanel.tsx:8-14` (`{ id, front, back, source, created_at }`).
  - Request-body `CardInput` interfaces (`{ front, back }` only) in `src/pages/api/decks/[id]/cards.ts:4-7`, `cards/manual.ts:4-7`, `cards/[cardId].ts:4-7` — these are unrelated to the FSRS row shape (they're for create/edit, not review).
- A manual RLS-isolation verification script exists at `supabase/tests/verify-rls-isolation.sql`, exercising cross-user read/update/delete assertions on `cards`/`decks` — worth re-running conceptually once FSRS columns are added, though the policies themselves don't need to change.

### 2. API route conventions (S-01..S-04 precedent)

- Canonical JSON API route shape (`src/pages/api/decks/[id]/cards/[cardId].ts:22-58`): check `context.locals.user` → 401 if absent; destructure `context.params`; parse `context.request.json().catch(() => null)`; validate with a hand-written type guard; create Supabase client per-request via `createClient(context.request.headers, context.cookies)` (`src/lib/supabase.ts:7`) — never a singleton; map Postgres error codes (`23505` → 409, `PGRST116` → 404, else 400) on failure; return `new Response(JSON.stringify(...), { status, headers: {"Content-Type": "application/json"} })`.
- **No Zod** — validation is repeated hand-rolled type-guard functions (e.g. `isValidCardInput`) in `cards/[cardId].ts:4-20`, `cards/manual.ts:4-20`, `cards.ts:4-20`. A new review route validating a grade (1–4) should follow the same convention, not introduce Zod.
- Dynamic params: `[id].ts` for deck-scoped, nested `[cardId]` for card-scoped routes.
- `PROTECTED_ROUTES` in `src/middleware.ts:4` is `["/dashboard", "/decks", "/api/decks"]`, matched via `startsWith` (`:18`). Any new route under `/api/decks/[id]/...` is **already covered** — no middleware change needed.
- No app-level ownership check (no `.eq("user_id", ...)` in application code for mutations) — ownership enforcement is delegated entirely to RLS. App code scopes queries by route params for correctness (e.g. `.eq("id", cardId).eq("deck_id", id)`) and treats an empty result as `404`, which doubles as the ownership-failure path.
- Route-shape recommendation surfaced by the agent (not yet decided, flagging for `/10x-plan`): given S-05's outcome text ("start a review session for a deck **and rate recall on each card**"), a deck-scoped `POST /api/decks/[id]/review` with `cardId` + `grade` in the JSON body matches the existing `decks/[id]/generate.ts` precedent (deck-scoped action route, JSON body) more closely than a doubly-nested `cards/[cardId]/review.ts`.

### 3. Cloudflare/Astro runtime constraints

- `astro.config.mjs:11,16` — `output: "server"`, `adapter: cloudflare()` (no options object — no `platformProxy`/`imageService` overrides).
- `wrangler.jsonc:5-6` — `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]`. **`nodejs_compat` is already enabled**, which is more permissive than `ts-fsrs` even needs (its core scheduler is pure TS/JS with no Node-API dependency per `srs-library-research.md:17`).
- `package.json` has **no existing `dayjs`, `seedrandom`, `date-fns`, `moment`, or `luxon` dependency** — no version-conflict risk when adding `ts-fsrs`'s deps fresh. No `engines` field constraining Node/runtime version.
- No Node built-ins (`crypto`, `Buffer`, `fs`, `node:*`) are used anywhere in `src/` today, despite `nodejs_compat` being on — the project doesn't currently lean on it, but it's available if `ts-fsrs`'s transitive deps need it.
- `tsconfig.json` extends `astro/tsconfigs/strict` → `target: "ESNext"`, `module: "ESNext"`, `moduleResolution: "Bundler"` (from `node_modules/astro/tsconfigs/base.json:5-8`) — no `lib`/`target` mismatch for a modern pure-TS package.

**Conclusion**: the compatibility claim in `srs-library-research.md:35` ("pure TypeScript, runs fine on Workers/edge") is directly confirmed against this project's actual adapter/wrangler config, not just in the abstract.

### 4. Card UI & review-session precedent (S-04)

- Existing card UI (`src/components/decks/CardListPanel.tsx:212-239, 275-280`) always renders front **and** back simultaneously (list/edit view) — **no flip/reveal interaction exists anywhere** (grep for `flip|reveal|show.?back|isFlipped` returns zero matches). The review session's "reveal answer" step is a wholly new interaction pattern.
- Routing convention under `src/pages/decks/[id]/`: flat, verb-suffixed siblings (`index.astro`, `generate.astro`, `cards/new.astro`), each fetching the deck server-side via `.eq("id", id).maybeSingle()`, redirecting to `/decks?error=...` on failure, then rendering a single React panel via `client:load` with a `deckId={deck.id}` prop (e.g. `src/pages/decks/[id]/generate.astro:1-28`). A new review page fits this pattern as `src/pages/decks/[id]/review.astro`.
- `src/components/ui/button.tsx:11-26` defines CVA variants (`default/destructive/outline/secondary/ghost/link`, sizes `default/sm/lg/icon`), but **no existing component actually uses the `variant`/`size` props** — all current `<Button>` usages pass raw Tailwind via `className` instead. No 4-button rating component exists; one would need to be built, and per CLAUDE.md's own convention ("Button variants are defined with CVA... extend there, don't add inline variant logic elsewhere") the 4 FSRS ratings (Again/Hard/Good/Easy) are a good candidate to finally exercise the `variant` prop rather than continuing the raw-Tailwind pattern.
- Zero existing concept of due dates/scheduling/review in the UI, types, or even prompt text (one incidental match: `src/lib/openrouter.ts:6`, just descriptive prose in the AI system prompt, not a code concept).
- Interactivity convention confirmed: every interactive React component mounts via `client:load` only (no `client:visible`/`client:idle` in use anywhere), with server-fetched props passed in from Astro frontmatter and all further data-fetching done client-side via `fetch()` to the matching API route. The closest existing precedent for a modal/interactive-state pattern is the delete-confirmation `<dialog>` in `CardListPanel.tsx:338-381` (`ref` + `showModal()/close()`).

## Code References

- `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:21-29` — current `cards` table definition, no FSRS columns
- `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:82-131` — `cards` RLS policies (deck-ownership subquery pattern)
- `src/db/database.types.ts:42-79` — generated `cards` row type, needs regen after FSRS migration
- `src/lib/supabase.ts:7` — `createClient(headers, cookies)`, per-request client factory
- `src/pages/api/decks/[id]/cards/[cardId].ts:4-20,22-58,68-88` — canonical JSON API route shape, validation, error mapping
- `src/pages/api/decks/[id]/generate.ts` — deck-scoped action-route precedent (closest shape match for a review route)
- `src/middleware.ts:4,18` — `PROTECTED_ROUTES`, already covers `/api/decks/*`
- `astro.config.mjs:11,16` — `output: "server"`, `adapter: cloudflare()`
- `wrangler.jsonc:5-6` — `compatibility_date`, `nodejs_compat` flag
- `src/components/decks/CardListPanel.tsx:212-239,275-280,338-381` — front/back rendering (no flip), delete-dialog interaction precedent
- `src/components/ui/button.tsx:11-26` — CVA button variants, currently unused in practice
- `src/pages/decks/[id]/generate.astro:1-28` — Astro page + `client:load` panel convention to mirror for `review.astro`

## Architecture Insights

- **RLS does the ownership work, not application code.** Any new review-mutation route should follow the established pattern exactly: scope the query by route params for correctness, let RLS silently exclude rows the user doesn't own, and treat an empty result as `404`. No new policy is needed for FSRS columns since RLS is row-scoped.
- **No Zod in this codebase** — hand-rolled type guards are the house style for request validation. A grade validator (`1|2|3|4`, matching `ts-fsrs`'s `Rating` enum) should follow the same shape as `isValidCardInput`.
- **JSON-API routes vs. form-POST routes are a deliberate fork** in this codebase: full-page mutations (create deck, delete deck) redirect with `?error=` query params (CLAUDE.md's documented auth-form pattern); AJAX-style actions (card CRUD, AI generation) return JSON directly. A review-session route is unambiguously the latter.
- **Generated types are regenerated, not hand-edited** — `database.types.ts` will need a Supabase CLI regen after the FSRS migration, not a manual patch.

## Historical Context (from prior changes)

- `context/changes/spaced-repetition-review-session/srs-library-research.md` — the library decision itself: `ts-fsrs` (FSRS v6) chosen over the one hosted alternative (SuperMemo API, rejected for being early-access/unproven pricing against the deadline). States the compatibility claim this research confirms directly against the repo's actual config.
- `context/changes/spaced-repetition-review-session/change.md:18` — records the Unknown as resolved 2026-08-01, unblocking `/10x-plan`.
- `context/foundation/roadmap.md:125-136` (S-05 entry) — outcome, PRD refs (FR-013, FR-014), prerequisites (F-01, S-01, both `impl_reviewed`), and the now-resolved Unknown.

## Related Research

- `context/changes/spaced-repetition-review-session/srs-library-research.md` — SRS library selection research (prerequisite decision to this compatibility check)
- `context/changes/spaced-repetition-review-session/ts-fsrs-api-docs.md` — the API reference this research validates against the codebase

## Open Questions

1. **Route shape**: deck-scoped `POST /api/decks/[id]/review` (body: `{ cardId, grade }`) vs. card-scoped `POST /api/decks/[id]/cards/[cardId]/review` — both fit existing conventions; not yet decided. Recommend resolving in `/10x-plan`.
2. **State column representation**: `ts-fsrs`'s `state: State` is a numeric enum (New/Learning/Review/Relearning). Store as a Postgres enum (mirroring the existing `card_source` enum pattern) or as a `smallint`? Not yet decided — a schema design call for `/10x-plan`.
3. **Review-history table**: `ts-fsrs-api-docs.md:45` calls the `ReviewLog` table "optional, if FR-014/S-05 wants one." FR-014 wasn't read in this research pass (only referenced via the roadmap) — worth confirming against the PRD text during planning whether FR-014 implies a visible review-history feature (which would require the log table) or just the scheduling mechanics (which don't).
4. **"Due card" selection query**: neither this research nor the existing codebase addresses how a review session picks *which* cards are due (e.g. `where due <= now()`, ordering, session size/limit) — this is FR-013/FR-014 territory to nail down in planning, not a `ts-fsrs` API concern.
