# Decks/Cards Schema Foundation — Plan Brief

> Full plan: `context/changes/deck-card-schema-foundation/plan.md`

## What & Why

Create the Supabase Postgres schema for `decks` and `cards`, with row-level security guaranteeing users can only access their own data. This is roadmap item F-01 — the foundation every other slice (deck management, AI generation, manual creation, card browsing, review sessions) needs before it can persist anything real.

## Starting Point

No `decks`/`cards` tables, migrations, or generated types exist. `supabase/config.toml` has migrations enabled but the `supabase/migrations/` folder doesn't exist yet. The project is already linked to a cloud Supabase instance. Auth (`auth.users`, session middleware) is already built and untouched by this change.

## Desired End State

A migration exists and is applied to the linked cloud project defining both tables with enforced RLS; a manual SQL script proves cross-user isolation actually holds; the shared Supabase client (`src/lib/supabase.ts`) is typed against the new schema so every future query gets type-checking for free.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Card origin tracking | `source` enum (`ai`/`manual`) column on cards | PRD's secondary success metric (75% AI-created cards) can't be measured retroactively — must capture it from row one. |
| Cards RLS ownership | Derive via `EXISTS` join to `decks.user_id`, no denormalized `user_id` on cards | Single source of truth for ownership; avoids a sync-drift risk between a duplicated column and the deck's real owner. |
| Deck name uniqueness | Unique per user, case-insensitive | Prevents confusing duplicate deck names; cheap DB-level guarantee. |
| Migration application | Manual `supabase db push` against the linked cloud project, no CI wiring | Matches the project's speed priority; CI migration automation is explicitly deferred, not skipped forever. |
| Content constraints | CHECK constraints: non-empty + max length on `front`/`back`/`name` | Guarantees data integrity regardless of which app layer (or future bug) writes to these tables. |
| TypeScript types | Generate `database.types.ts` now, type the client immediately | Matches the stack's stated TypeScript-end-to-end rationale; every downstream slice gets type safety without extra work. |
| RLS verification | Hand-run SQL script, not an automated test framework | No test framework exists yet in this project; introducing one is out of scope for a foundation change under a tight deadline. |
| SRS scheduling schema | None — strictly decks + cards | S-05 is blocked on picking a third-party SRS service; guessing a shape now would likely be wrong and reworked later. |

## Scope

**In scope:** `decks` and `cards` tables, RLS policies, content constraints, `card_source` enum, migration applied to the cloud project, RLS verification script, generated TypeScript types wired into the Supabase client.

**Out of scope:** SRS scheduling schema, any deck/card API routes or UI, automated (pgTAP or otherwise) tests, CI automation for migrations, fixing the pre-existing missing `supabase/seed.sql`.

## Architecture / Approach

One migration creates both tables together (cards has a hard FK on decks) with RLS enabled inline. Applying and verifying against the real cloud project is a separate phase so correctness is checked before anything depends on it. Type generation comes last since it needs the live schema to generate against.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & RLS migration | `decks`/`cards` tables, constraints, RLS policies in one migration file | Getting the RLS join condition or cascade behavior wrong — caught by Phase 2's verification, not by this phase alone |
| 2. Apply & verify isolation | Migration live on the cloud project + a manual script proving cross-user isolation | No automated test framework — verification quality depends on the script actually being run, not just written |
| 3. Generate types & wire client | `src/db/database.types.ts` + typed `createClient` | Types can drift from schema if a future migration lands without regenerating this file |

**Prerequisites:** None — this is the first roadmap item; only needs Supabase CLI auth (`supabase login`) for the cloud push in Phase 2.
**Estimated effort:** ~1 session across 3 phases — schema-only, no API/UI surface.

## Open Risks & Assumptions

- Assumes the developer has (or can get) `supabase login` access to the linked cloud project (ref `taibluvzxcqalrxrcrcs`) to run `supabase db push`.
- Manual RLS verification depends on discipline to actually run the script on every future policy change, not just at this change's implementation time.

## Success Criteria (Summary)

- The migration applies cleanly both locally (`supabase db reset`) and against the cloud project (`supabase db push`).
- The RLS verification script shows zero cross-user access in every case tested.
- `npm run lint` and `npm run build` pass with the Supabase client typed against the new schema.
