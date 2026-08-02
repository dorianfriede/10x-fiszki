<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: UI Polish — Cross-Cutting Visual Consistency Pass

- **Plan**: context/changes/ui-polish/plan.md
- **Scope**: Full plan (Phases 1–6, all complete)
- **Date**: 2026-08-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations
- **Triage**: complete — F1 fixed, F2 fixed (Fix A), F3 fixed, F4 fixed, F5 skipped

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — confirm-email.astro now shows a factually wrong message in dev

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/auth/confirm-email.astro
- **Detail**: Phase 6's plan contract for this file was "replace raw emoji (✅/📧) with lucide-react icons... same size/placement as the current emoji" — visual-only. The actual commit (`b85947d`) also deleted the `isAutoConfirmed = import.meta.env.DEV` branch entirely, collapsing two distinct messages into one unconditional "Check your email... click it to activate your account." I confirmed this is now factually wrong in this project's local dev environment: `supabase/config.toml:209` sets `enable_confirmations = false`, meaning local signups are auto-confirmed and **no email is ever sent**. Every developer testing signup locally is now told to check an email that doesn't exist for an account that's already active. This is a functional regression introduced under a "presentation-only" plan, not just an icon swap.
- **Fix**: Restore environment-aware messaging (the original `isAutoConfirmed` branch, or a check derived from something more direct than `import.meta.env.DEV` if available) so the copy matches actual confirmation behavior in both environments.
- **Decision**: FIXED — restored the `isAutoConfirmed` branch (kept the Phase 6 icon/button-variant polish: `CheckCircle2` for auto-confirmed, `Mail` for check-your-email).

### F2 — Unplanned keyboard-shortcut rating feature can rate a card while the reset-confirm dialog is open

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Scope Discipline
- **Location**: src/components/decks/ReviewSessionPanel.tsx:124-139
- **Detail**: Phase 1's plan scope was "corrects [the FSRS rating buttons'] rendering" (a CVA color-token fix) — nothing in the plan mentions new interactivity. The actual Phase 1 commit added a new feature: pressing keys 1-4 rates the current card via a `window`-level `keydown` listener, guarded only by `revealed` and `isRating`. The "Reset session" button at ReviewSessionPanel.tsx:464-474 is rendered whenever `ratedSnapshots.size > 0`, including while `revealed` is still `true` (mid-review, answer already shown) — and clicking it opens the reset-confirm `<ConfirmDialog>` without resetting `revealed` to `false` (verified: `openResetConfirm()` never touches `revealed`). So a user can: reveal an answer → click "Reset session" → the confirm dialog opens on top → press "2" (e.g. out of habit, or trying to interact with the dialog) → `rate()` fires silently underneath the open dialog, advancing/rating the review session while the user still sees a "Reset session?" confirmation. This is a genuine, reproducible state-corruption edge case caused by unplanned scope.
- **Fix A ⭐ Recommended**: Keep the keyboard-shortcut feature (a reasonable UX addition for a spaced-repetition app) but add a guard for the open dialog, e.g. `if (isResetDialogOpen) return;` alongside the existing `isRating` check in `handleKeyDown`.
  - Strength: Preserves already-working, deliberately-designed functionality (the commit message says "per explicit design spec," and `RATING_BUTTONS` was structured with a `key` field specifically for this) while closing the concrete bug with a one-line guard.
  - Tradeoff: The feature still isn't reflected anywhere in plan.md as an addendum, so a future reader of the plan will be surprised to find it.
  - Confidence: HIGH — the guard is small, isolated, and matches the existing `isRating` guard pattern already in the same handler.
  - Blind spot: Haven't confirmed with the user whether this was a live scope decision made during Phase 1 implementation (plausible) vs. undiscussed drift.
- **Fix B**: Revert the keyboard-shortcut addition entirely; re-propose it as its own change via `/10x-new` so it gets its own plan and review.
  - Strength: Keeps the ui-polish plan's diff matching its stated "presentation-only" scope exactly.
  - Tradeoff: Discards working functionality that will likely be re-implemented identically later, at extra cost.
  - Confidence: MEDIUM — depends on whether the feature is something the user actually wants kept.
  - Blind spot: Same as above.
- **Decision**: FIXED via Fix A — added `isResetDialogOpen` to the keydown guard and its effect's dependency array.

### F3 — GenerateFlashcardsPanel's generationError banner doesn't use the new InlineError primitive

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/decks/GenerateFlashcardsPanel.tsx:223-234
- **Detail**: `lengthError` and `saveError` in this file use the new `InlineError` component, but `generationError` still hand-rolls a boxed `CircleAlert` + red-border banner with an embedded "Try again" button. This is arguably intentional — `InlineError`'s contract (`message` + `size`) has no slot for an action button, so this banner is structurally closer to the plan's separately-scoped `ServerError` pattern than to the ad hoc inline-error pattern Phase 4 targeted. Flagging for visibility, not as a clear violation.
- **Fix**: If a consistent look is wanted here too, either extend `InlineError` with an optional action slot, or explicitly note in the component that this banner is a deliberate exception (boxed error + retry action, distinct from simple inline messages).
- **Decision**: FIXED — kept `InlineError`'s contract unchanged (no action slot added); replaced the hand-rolled `CircleAlert` + text with `<InlineError message={generationError} />` inside the existing boxed container, so the icon+message markup is now shared while the box/retry-button chrome (a genuinely distinct pattern) stays as-is. Removed the now-unused `CircleAlert` import.

### F4 — Unused `link` Button variant retained outside the plan's 5-variant contract

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/ui/button.tsx
- **Detail**: Phase 1's contract specifies exactly 5 CVA variants (`default`/`destructive`/`secondary`/`outline`/`ghost`). A 6th variant, `link`, also exists (`"text-purple-300 underline-offset-4 hover:underline"`) — leftover from the shadcn boilerplate, not mentioned in the plan, and confirmed unused anywhere in `src/` (`grep -rn 'variant="link"' src/` returns nothing).
- **Fix**: Remove the unused `link` variant, or if it's being kept intentionally for future use, note that in the plan/component.
- **Decision**: FIXED — removed the `link` variant from `buttonVariants`.

### F5 — New shared primitives don't set a `data-slot` attribute like button.tsx

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/confirm-dialog.tsx, src/components/ui/loading-state.tsx, src/components/ui/empty-state.tsx, src/components/ui/inline-error.tsx
- **Detail**: `button.tsx` sets `data-slot="button"` on its root element (a shadcn convention useful as a styling/testing hook). None of the four new primitives from Phases 3–4 set an equivalent `data-slot`.
- **Fix**: Add `data-slot="dialog"/"loading-state"/"empty-state"/"inline-error"` to each, if `data-slot` is meant to be a codebase-wide convention going forward; otherwise no action needed.
- **Decision**: SKIPPED — `data-slot` isn't consumed anywhere functionally, not worth the churn.
