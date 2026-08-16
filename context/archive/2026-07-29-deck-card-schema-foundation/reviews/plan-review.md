<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Decks/Cards Schema Foundation

- **Plan**: context/changes/deck-card-schema-foundation/plan.md
- **Mode**: Deep
- **Date**: 2026-07-29
- **Verdict**: REVISE (both findings fixed during triage)
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding

6/6 paths checked (src/lib/supabase.ts, supabase/config.toml, supabase/.temp/linked-project.json, package.json, context/foundation/roadmap.md, context/foundation/prd.md — plus confirmed src/db/ correctly absent, created by Phase 3), 4/4 symbols verified, brief↔plan consistent.

Additional check performed and cleared (no finding): the pre-existing missing `supabase/seed.sql` (flagged in plan's "What We're NOT Doing") does not break Phase 1's `supabase db reset` verification — researched Supabase CLI behavior: a missing configured seed path is a non-fatal `WARN`, not an error, across the 1.x–2.x CLI line, and `db push` doesn't consult seed config at all.

## Findings

### F1 — Phase 3's "type checking passes" verification doesn't actually type-check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Desired End State (Verification line) + Phase 3 Success Criteria + Progress 3.1
- **Detail**: The plan's stated verification for Phase 3 was "npm run lint (which runs tsc via astro check) passes with the typed client". Verified empirically: injected a real type error (`const x: number = "a string"`) into a .ts file and ran both `npm run lint` and `npm run build` — neither caught it. `npm run lint` is ESLint with typescript-eslint's type-aware *lint rules* (per README: "Run ESLint with type-checked rules"), not a `tsc` diagnostics pass; `npm run build` transpiles via esbuild, which strips types without checking them. A broken `Database` generic wiring in Phase 3 would pass both checks undetected.
- **Fix A ⭐ Recommended (Applied)**: Use `npx astro check` (already a devDependency via `@astrojs/check`) as Phase 3's verification step, scoped to this plan only.
  - Strength: Narrow, contained fix; unblocks this plan's own verification integrity immediately.
  - Tradeoff: Repo-wide gap remains — other future PRs "passing lint" still have no real type-check guarantee.
  - Confidence: HIGH — astro check is the documented dependency already installed for exactly this purpose.
  - Blind spot: Doesn't decide whether CI should eventually run `astro check` repo-wide.
- **Fix B**: Update package.json's `lint` script to `astro check && eslint .` repo-wide.
  - Strength: Fixes root cause once, benefits every future change.
  - Tradeoff: Slower CI, broader blast radius, out of scope for a schema-only change.
  - Confidence: MEDIUM — untested whether astro check surfaces a backlog of pre-existing errors elsewhere in the repo.
  - Blind spot: Haven't run astro check against the full current codebase.
- **Decision**: FIXED (via Fix A) — plan.md updated: Desired End State Verification line, Phase 3 Automated Verification, and Progress 3.1 all now reference `npx astro check` instead of `npm run lint`.

### F2 — Type-gen command writes to a directory that doesn't exist yet

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, item 1 (Generated database types)
- **Detail**: `src/db/` doesn't exist in the repo. The contract was `supabase gen types typescript --linked > src/db/database.types.ts` — shell output redirection doesn't create missing parent directories, so this fails with "No such file or directory" on first run.
- **Fix**: Add "create `src/db/` first" to the Phase 3 contract before the redirection command.
- **Decision**: FIXED — plan.md Phase 3 item 1 contract now starts with `mkdir src/db` before the `supabase gen types` redirection.

## Triage Summary

Fixed: F1 (Fix A), F2 (2)
Skipped: none
Accepted: none
Dismissed: none

► Verdict after fixes: SOUND
