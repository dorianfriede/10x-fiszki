# Decks/Cards Schema Foundation Implementation Plan

## Overview

Create the Supabase Postgres schema for `decks` and `cards` — the foundation every other roadmap slice (S-01 through S-05) needs before it can persist real data. This includes row-level security (RLS) policies that guarantee a user can only read/write their own rows, applying the migration to the linked cloud Supabase project, and generating TypeScript types so downstream slices get type-safe database access from the start.

## Current State Analysis

- No `decks`/`cards` tables, migrations, or generated types exist anywhere in the codebase. `supabase/migrations/` doesn't exist yet.
- `supabase/config.toml` has `db.migrations.enabled = true` with default (empty) `schema_paths`, so the standard `supabase/migrations/*.sql` convention applies.
- The project is already linked to a cloud Supabase project (`supabase/.temp/linked-project.json`, ref `taibluvzxcqalrxrcrcs`) — `supabase db push` targets that project directly.
- `src/lib/supabase.ts` creates an untyped `SupabaseClient` via `createServerClient` — no `Database` generic is threaded through yet.
- CI (`.github/workflows/ci.yml`) builds and deploys the app on push to `main` but has no step that applies database migrations — migration application is a manual, out-of-band step today.
- Auth already exists and is out of scope: `auth.users` is Supabase-managed; this plan only adds tables that reference it.

## Desired End State

A `supabase/migrations/*.sql` file exists defining `decks` and `cards` with RLS enabled and enforced, that migration has been applied to the linked cloud project, a manual SQL verification script proves cross-user isolation holds, and `src/lib/supabase.ts`'s client is typed against the new schema via a generated `src/db/database.types.ts`.

**Verification**: `supabase db push` runs cleanly against the linked project; the RLS verification script (Phase 2) shows zero rows returned for all cross-user access attempts; `npx astro check` (the project's real type-checker, run explicitly since `npm run lint` does not perform `tsc`-style type checking) passes with the typed client.

### Key Discoveries:

- `src/lib/supabase.ts:9` — `createServerClient(SUPABASE_URL, SUPABASE_KEY, {...})` is the single client factory every future route will import; typing it once here means every downstream slice gets type safety for free.
- Roadmap F-01 Unknowns (`context/foundation/roadmap.md:70`) already resolved deck deletion as cascade — cards and (future) SRS scheduling state cascade-delete with their parent deck.
- PRD Success Criteria Secondary (`context/foundation/prd.md:34`) requires knowing whether each card came from the AI path or manual entry — this can't be measured retroactively, so the schema must capture it now even though S-02/S-03 (the slices that create cards) aren't built yet.

## What We're NOT Doing

- No SRS scheduling table/columns — S-05 is blocked on picking a third-party SRS service and will design its own schema against that service's API contract.
- No API routes or UI for decks/cards — that's S-01 (deck management) and S-04 (card browsing/editing).
- No automated pgTAP (or other) test suite — RLS is verified via a manual SQL script given no test framework exists yet in this project.
- No CI automation for applying migrations — `supabase db push` is run manually for this change; wiring it into `.github/workflows/ci.yml` is explicitly deferred.
- No fix for the pre-existing missing `supabase/seed.sql` (referenced by `config.toml` but absent) — unrelated to this change's scope.

## Implementation Approach

One migration creates both tables together (cards has a hard FK dependency on decks, so they land as a single atomic schema change). RLS policies are written directly in the same migration. Application to the cloud project and verification is a separate phase so the migration's correctness is checked before it's relied upon. Type generation is the last phase since it depends on the schema actually existing in the target project.

## Critical Implementation Details

**RLS ownership model**: `cards` has no `user_id` column. Every cards policy derives ownership through `EXISTS (SELECT 1 FROM decks WHERE decks.id = cards.deck_id AND decks.user_id = auth.uid())` rather than a denormalized column, per the confirmed design decision — this avoids a sync-drift risk between a duplicated `user_id` and the deck's actual owner.

**RLS verification without real signups**: to test policies as two different users without going through the app's signup flow, simulate `auth.uid()` in `psql`/Studio's SQL editor via `SET request.jwt.claims = '{"sub": "<uuid>", "role": "authenticated"}'; SET ROLE authenticated;` before each query — this is the standard technique for exercising Supabase RLS from raw SQL.

## Phase 1: Schema & RLS migration

### Overview

Create one migration defining the `decks` and `cards` tables, their constraints, and their RLS policies.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_deck_card_schema_foundation.sql` (generate via `supabase migration new deck_card_schema_foundation` to get a correctly-ordered timestamp at implementation time)

**Intent**: Define the full decks/cards schema plus RLS in one atomic migration, since cards has a hard foreign-key dependency on decks and both need RLS enabled before either is usable.

**Contract**:
- `CREATE TYPE card_source AS ENUM ('ai', 'manual');`
- `decks` table: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `name text not null` with a `CHECK (length(trim(name)) > 0 AND length(name) <= 100)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Unique index on `(user_id, lower(name))` to enforce case-insensitive per-user deck-name uniqueness.
- `cards` table: `id uuid primary key default gen_random_uuid()`, `deck_id uuid not null references decks(id) on delete cascade`, `front text not null` and `back text not null`, each with `CHECK (length(trim(...)) > 0 AND length(...) <= 2000)`, `source card_source not null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Index on `deck_id` (supports both the FK and the RLS join).
- A shared `set_updated_at()` trigger function (`plpgsql`, sets `NEW.updated_at = now()`) with a `BEFORE UPDATE` trigger on each table.
- `ALTER TABLE decks ENABLE ROW LEVEL SECURITY;` and same for `cards`.
- `decks` policies: separate `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies, each keyed on `auth.uid() = user_id` (as `USING` for read-side, `WITH CHECK` for write-side).
- `cards` policies: separate `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies, each using the `EXISTS (... decks.user_id = auth.uid())` join described in Critical Implementation Details (as `USING` for read-side, `WITH CHECK` for write-side).

### Success Criteria:

#### Automated Verification:

- Migration file is valid SQL and applies without error locally: `supabase db reset` (runs all migrations against the local Docker stack)
- No lint errors introduced: `npm run lint`

#### Manual Verification:

- Migration file reviewed for correct cascade behavior, constraint logic, and RLS policy conditions (self-review, since this is the schema of record)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Apply & verify isolation

### Overview

Push the migration to the linked cloud Supabase project and prove RLS actually isolates users from each other's data.

### Changes Required:

#### 1. Apply migration to cloud project

**Intent**: Get the schema live on the project this app actually points to (per `linked-project.json`), since a migration that only exists locally doesn't unblock S-01.

**Contract**: Run `supabase db push` (requires the developer to be authenticated via `supabase login`); confirm it reports the new migration applied with no errors.

#### 2. RLS verification script

**File**: `supabase/tests/verify-rls-isolation.sql`

**Intent**: A hand-run (not automated-in-CI) SQL script that creates two decks/cards owned by two different simulated users and asserts every cross-user `SELECT`/`UPDATE`/`DELETE` returns zero affected rows — the concrete proof that the RLS policies from Phase 1 actually work, not just that they parsed.

**Contract**: Uses the `SET request.jwt.claims` / `SET ROLE authenticated` simulation technique (see Critical Implementation Details) to act as two distinct `auth.uid()` values without needing real signups. Structure: create deck+card as user A, switch simulated identity to user B, attempt to read/update/delete user A's rows and assert 0 rows affected each time, then confirm user A can still access their own rows normally.

### Success Criteria:

#### Automated Verification:

- N/A — this phase's verification is inherently manual (no test framework exists yet; see What We're NOT Doing)

#### Manual Verification:

- `supabase db push` completes successfully against the linked cloud project
- Running `verify-rls-isolation.sql` (via `psql` or the Studio SQL editor) against the cloud project shows every cross-user access attempt returns 0 rows, and the owning user's own access succeeds normally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generate types & wire client

### Overview

Generate TypeScript types from the now-live schema and type the shared Supabase client so every future query against `decks`/`cards` is type-checked.

### Changes Required:

#### 1. Generated database types

**File**: `src/db/database.types.ts`

**Intent**: Provide a `Database` type matching the live schema so Supabase clients can be generically typed.

**Contract**: `src/db/` doesn't exist yet — create it first (`mkdir src/db`), since shell output redirection won't create a missing parent directory. Then generate via `supabase gen types typescript --linked > src/db/database.types.ts` — not hand-written; regenerate this file after any future schema migration rather than editing it directly.

#### 2. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Thread the generated `Database` type through the existing client factory so callers get autocomplete and type-checking on `decks`/`cards` queries without any call-site changes.

**Contract**: Import `Database` from `../db/database.types`; change the `createServerClient(...)` call to `createServerClient<Database>(...)`; update the function's return type annotation accordingly (`SupabaseClient<Database> | null`).

#### 3. Type-generation script (optional convenience)

**File**: `package.json`

**Intent**: Make regenerating types after future migrations a one-line command instead of a memorized CLI incantation.

**Contract**: Add a `"db:types": "supabase gen types typescript --linked > src/db/database.types.ts"` script.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (verified `npm run lint` does NOT perform real `tsc`-style type checking — it's ESLint with type-aware lint rules, which won't catch an incorrectly-wired `Database` generic; `@astrojs/check` is already a devDependency, so this needs no new install)
- Build succeeds: `npm run build`

#### Manual Verification:

- Spot-check `src/db/database.types.ts` contains `decks` and `cards` table types with the expected columns (including the `card_source` enum)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None — no application code is introduced in this change; the schema is the only artifact.

### Integration Tests:

- None automated — see Phase 2's RLS verification script, which is the closest equivalent and is run manually.

### Manual Testing Steps:

1. Run `supabase db reset` locally and confirm the migration applies cleanly with no SQL errors.
2. Run `supabase db push` against the linked cloud project and confirm success.
3. Run `verify-rls-isolation.sql` against the cloud project and confirm every cross-user access attempt returns 0 rows.
4. Confirm `npm run lint` and `npm run build` succeed with the typed Supabase client.

## Performance Considerations

Data volume is small (`target_scale.data_volume: small` in `prd.md`) and the RLS join for `cards` is a single indexed `EXISTS` subquery against `decks.id` (primary key) — no performance concern at this scale.

## Migration Notes

This is a net-new schema with no existing data to migrate. Future schema changes (e.g., S-05's SRS scheduling columns) should be added as new migration files, not edits to this one.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01, lines 61-72)
- PRD: `context/foundation/prd.md` (Access Control, NFR, Success Criteria Secondary, Open Question #3)
- Existing client pattern: `src/lib/supabase.ts:5-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS migration

#### Automated

- [x] 1.1 Migration file is valid SQL and applies without error locally: `supabase db reset` (adapted: validated via `supabase db push` against the linked cloud project instead, since Docker is unavailable locally — see 2.1)
- [x] 1.2 No lint errors introduced: `npm run lint` — 4af6956

#### Manual

- [x] 1.3 Migration file reviewed for correct cascade behavior, constraint logic, and RLS policy conditions — 4af6956

### Phase 2: Apply & verify isolation

#### Manual

- [x] 2.1 `supabase db push` completes successfully against the linked cloud project
- [x] 2.2 Running `verify-rls-isolation.sql` shows every cross-user access attempt returns 0 rows, and the owning user's own access succeeds normally

### Phase 3: Generate types & wire client

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Build succeeds: `npm run build`

#### Manual

- [ ] 3.3 Spot-check `src/db/database.types.ts` contains `decks` and `cards` table types with the expected columns
