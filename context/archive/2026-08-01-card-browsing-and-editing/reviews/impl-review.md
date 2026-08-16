<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Card Browsing, Editing, and Deletion Implementation Plan

- **Plan**: context/changes/card-browsing-and-editing/plan.md
- **Scope**: Phase 1-3 of 3 (full plan, all complete)
- **Date**: 2026-08-01
- **Verdict**: NEEDS ATTENTION (all findings triaged — see Decisions)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Already-applied migration edited in place instead of superseded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20260801114731_cards_unique_front_back.sql (whole file)
- **Detail**: The plan's "What We're NOT Doing" (plan.md:30) states "No schema or migration changes." Commit ebfa196 (Phase 2) edited this already-committed migration in place — `md5(front || E'\x00' || back)` → `(md5(front) || md5(back))` — rather than adding a corrective migration. The underlying fix is justified: Postgres text cannot hold an embedded NUL byte, so the original expression would raise an invalid-UTF8 error once evaluated against real data, which is why Phase 2's duplicate-conflict manual check (2.5) couldn't have passed without it. But Supabase tracks applied migrations by filename/version, not content hash — any environment where the original file version already ran keeps the old broken index forever, silently diverging from a fresh environment that picks up the edited file. Confirmed via `.github/workflows/ci.yml` that no CI/deploy step currently applies migrations (the `wrangler deploy` step doesn't touch the DB), so today's actual risk is contained to whatever's been run locally.
- **Fix A ⭐ Recommended**: Leave the file edited as-is; no corrective migration needed right now.
  - Strength: Verified no CI/CD path applies migrations yet, and this is a single-developer local project — no live systems currently depend on the old broken version.
  - Tradeoff: If this migration was ever manually applied to another Supabase project (e.g. a personal staging instance not tracked in git), that environment would silently keep the broken index.
  - Confidence: HIGH — CI workflow confirmed to have no migration-apply step.
  - Blind spot: Haven't checked whether the user applied this migration to any Supabase project outside this repo's own history.
- **Fix B**: Revert the in-place edit and add a new corrective migration (e.g. a new timestamped file that drops and recreates the index with the corrected expression).
  - Strength: Establishes correct practice going forward and is safe regardless of what's been applied where.
  - Tradeoff: Extra migration file and revert-then-fix churn for a bug that, per Fix A's confidence, has no live consequence today.
  - Confidence: MEDIUM — depends on unverifiable info about what's been applied outside this repo.
  - Blind spot: Haven't inspected local Supabase's `schema_migrations` table for what's actually marked applied.
- **Decision**: Fixed via Fix A — left edited-in-place as-is, no further action; accepted risk is contained (no CI/deploy step applies migrations).

### F2 — Save-success race can silently discard a different row's in-progress edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/decks/CardListPanel.tsx:136
- **Detail**: `saveEdit`'s success handler unconditionally calls `setEditingCardId(null)` once its own PATCH resolves. `isSavingEdit` is a single shared flag, not keyed per card, and a different row's Edit button isn't disabled while another row's save is in flight. Sequence: user opens Edit on card A, clicks Save (PATCH in flight), then opens Edit on card B before A's save resolves — when A's save completes, `editingCardId` is reset to `null` regardless of whether it has since moved to B, silently closing B's edit view and discarding B's unsaved front/back text with no warning.
- **Fix**: Guard the reset so it only clears `editingCardId` if it still points at the card that was just saved: `setEditingCardId((current) => (current === cardId ? null : current));`
- **Decision**: Fixed — applied the guarded reset at CardListPanel.tsx:136.

### F3 — Pagination `page` parameter has no upper bound

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/decks/[id]/cards.ts:43
- **Detail**: `pageSize` is clamped to 1-100 but `page` has no upper bound — a client can request an arbitrarily large page, producing a large `.range()` offset. Low real-world impact (decks are capped around 500 cards per the NFR, and Postgres/PostgREST just returns zero rows for an out-of-range offset rather than erroring), but it's an unvalidated input.
- **Fix**: Optionally cap `page` similarly — e.g. reject values beyond `ceil(total/pageSize) + 1`, or a fixed sane ceiling.
- **Decision**: Fixed — added a `page > 1000` upper-bound check in cards.ts:43 (total isn't known pre-query, so used a fixed sane ceiling instead).
