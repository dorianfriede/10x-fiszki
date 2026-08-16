<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Decks/Cards Schema Foundation

- **Plan**: context/changes/deck-card-schema-foundation/plan.md
- **Scope**: Phase 1 of 3, Phase 2 of 3, Phase 3 of 3 (full plan — all phases complete per Progress)
- **Date**: 2026-07-31
- **Verdict**: REJECTED
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

## Findings

### F1 — `npm run lint` fails on the generated types file; will break CI on push

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/db/database.types.ts (120 ESLint errors across the file)
- **Detail**: The plan's Testing Strategy explicitly states "Confirm `npm run lint` and `npm run build` succeed with the typed Supabase client." I ran both. `npm run build` and `npx astro check` pass cleanly (0 errors). `npm run lint` fails — and this is not the Windows CRLF line-ending noise that also affects the whole repo (verified separately by extracting the actual committed blob via `git show 2f5fcf6:src/db/database.types.ts`, which is LF-only, and running Prettier/ESLint against that exact committed content). The generated file trips three real `typescript-eslint` rules from this project's `strictTypeChecked`/`stylisticTypeChecked` config, independent of line endings:
  - `@typescript-eslint/consistent-type-definitions` (line 9 — Supabase generates `type Json = ...`, project rule requires `interface`)
  - `@typescript-eslint/consistent-indexed-object-style` (lines 16, 19, 33, 36, 105, 108, 114 — Supabase generates index signatures, project rule requires `Record<...>`)
  - `@typescript-eslint/no-redundant-type-constituents` (line 222 — `'never' is overridden by other types in this union type`)
  - Plus ~110 Prettier formatting errors (missing semicolons, wrapping) since Supabase's generator doesn't run this project's Prettier config before emitting the file.
  - `.github/workflows/ci.yml:20` runs `npm run lint` before `npm run build` on every push — these 4 commits are local and 4 commits ahead of `origin/main` (unpushed), so this hasn't broken a CI run yet, but it will the moment they're pushed.
  - This is a generated file — the plan itself says "regenerate this file after any future schema migration rather than editing it directly" — so hand-formatting it is not a durable fix; it needs to be excluded from lint, matching how the project already excludes `.gitignore`d paths in `eslint.config.js`.
- **Fix**: Add an ignore entry for the generated file in `eslint.config.js`, e.g. `{ ignores: ["src/db/database.types.ts"] }` alongside the existing `includeIgnoreFile(gitignorePath)` entry in the exported config array (eslint.config.js:71-79), so future `db:types` regenerations never re-trigger this.
- **Decision**: FIXED — added `{ ignores: ["src/db/database.types.ts"] }` to `eslint.config.js`. Re-ran `npm run lint`: `database.types.ts` no longer appears in the output (dropped from 120 to 0 errors on that file). Remaining ~1025 repo-wide errors are the pre-existing Windows CRLF checkout artifact (verified via `git show` that committed blobs are LF-only), unrelated to this change and out of scope.

## Notes

- Both plan-drift and safety/quality sub-agent passes returned clean results: RLS policies for `decks` and `cards` correctly pair `USING` (read-side) and `WITH CHECK` (write-side) per command, `cards` ownership is correctly derived via the `EXISTS (... decks.user_id = auth.uid())` join with no denormalized `user_id`, cascade deletes match the resolved roadmap decision, indexes support both the FK and the RLS join path, and `src/lib/supabase.ts`'s `Database` generic is wired correctly and is source-compatible with all existing callers (`src/middleware.ts`, `src/pages/api/auth/{signin,signout,signup}.ts`).
- One benign, unrequested addition: every RLS policy in the migration is scoped `to authenticated` (not explicitly called for in the plan's contract text, which only specified the `auth.uid() = user_id` condition). This is a standard, low-risk Supabase convention that tightens rather than loosens access — not flagged as a finding.
- `package.json`'s only change is the planned `db:types` script — no unplanned dependency or script changes.
- No `context/foundation/lessons.md` exists yet, so no recurring-rule priors were available to check against.
