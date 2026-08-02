# UI Polish — Cross-Cutting Visual Consistency Pass Implementation Plan

## Overview

10xFiszki's screens share a "cosmic" glass visual language (dark gradient background, glass panels, gradient-text headings, purple primary actions), but it's expressed through duplicated literal Tailwind classes rather than shared components, so it's drifted: buttons mostly bypass the shadcn `Button`'s variant system, five different files hand-roll a near-identical confirm dialog, loading/empty/error states each look slightly different, the top navigation is a flat row of same-colored links, and two screens (homepage, dashboard) don't match the rest of the app at all. This plan fixes the drift by building the handful of missing shared primitives the app actually needs, then sweeping every screen to use them.

## Current State Analysis

- Every page renders through `src/layouts/Layout.astro`, which always includes `src/components/Topbar.astro` — navigation already exists everywhere; it just looks flat and hard to parse (`Topbar.astro:1-40`, same-colored `text-purple-300` links, no icons, no active-page state).
- `src/components/ui/button.tsx` defines proper shadcn CVA variants (`default/destructive/outline/secondary/ghost/link`), but almost every call site overrides them with a full custom `className` instead of using `variant`/`size` props. `ReviewSessionPanel.tsx:411-424` is the one place variants are actually used (for the 4 FSRS rating buttons) — but the CVA `default` variant currently resolves to a near-black shadcn token (`global.css:14`, `--primary: oklch(0.205 0 0)`), not the purple-600 used as "primary" everywhere else via literal classes, so those rating buttons likely render off-brand today.
- `global.css:41-73` defines a full `.dark {}` variable block; nothing in the codebase ever applies a `.dark` class, so it's dead code.
- `src/components/ui/` contains only `button.tsx` — no Dialog/Input/Textarea shadcn primitives exist. Five places hand-roll a near-identical confirm dialog with duplicated classes and open/close JS: `src/pages/decks/index.astro:67-133` (vanilla Astro `<script>` + `<dialog>`), `CardListPanel.tsx:338-381`, `ReviewSessionPanel.tsx:253-302`, `CancelDeletionDialog.tsx:36-66`, `DeleteAccountDialog.tsx:42-82`.
- Loading/empty/error presentation is duplicated with minor drift: plain "Loading..." text (`CardListPanel.tsx:194`, `ReviewSessionPanel.tsx:305`) vs. an actual spinner (`GenerateFlashcardsPanel.tsx:213-217`, `SubmitButton.tsx:20-22`); the same `text-center text-blue-100/60` empty-state paragraph copy-pasted in 4 files; the same `<CircleAlert> + text-red-300` inline-error pattern repeated ad hoc in ~8 places, distinct from the boxed `ServerError` banner component that already exists for page/server-level errors.
- `src/pages/index.astro` still renders the stock Astro-starter `<Welcome />` component — visually unrelated to the rest of the app.
- `src/pages/dashboard.astro:10` uses `text-3xl` for its heading while every other centered-card screen (account, auth, pending-deletion) uses `text-2xl` — the one real inconsistency in an otherwise-shared "centered card" layout archetype.
- `src/pages/auth/confirm-email.astro:8,14,26` uses raw emoji (✅/📧) where every other screen uses `lucide-react` icons.
- `src/pages/decks/index.astro` is the least componentized screen — its list actions are plain `<a>`/`<button>` elements with no `Button` component usage at all.
- The prior `ux-improvements` change explicitly flagged and deferred this exact Button-vs-inline-Tailwind inconsistency rather than fixing it (`context/changes/ux-improvements/plan.md:58`) — this plan is what resolves it.
- The PRD has no dark-mode, branding, or accessibility requirements, and explicitly excludes mobile/responsive work (desktop browsers only for the MVP).

## Desired End State

Every screen shares one consistent visual language driven by a small set of primitives instead of duplicated literal classes: a `Button` component whose variants match the colors already in use, one reusable `ConfirmDialog`, shared loading/empty/inline-error components, and a legible top navigation with icons and an active-page indicator. The homepage and dashboard match the rest of the app's look. Verified by: `npm run lint` and `npm run build` passing after each phase, plus a manual click-through of all 12 screens (see Phase 6 §3 for the enumerated list) confirming consistent chrome, buttons, dialogs, and states.

### Key Discoveries:

- `Layout.astro` already provides a shared nav on every page (`src/layouts/Layout.astro:1-42`) — the actual gap is Topbar's visual clarity, not missing navigation.
- `ReviewSessionPanel.tsx:411-424` already exercises the Button variant system — fixing the CVA color tokens (Phase 1) corrects its rendering without touching that file.
- Two distinct, already-consistent page archetypes exist today: "List/Detail" (`max-w-2xl`, left-aligned, `text-3xl` heading — decks list/detail/generate/cards-new/review) and "Centered-Card" (`max-w-sm`, centered, `text-2xl` heading — auth/account/pending-deletion). The plan should formalize and complete these two patterns, not invent a third.
- `src/pages/decks/index.astro` is the only confirm-dialog implementation that isn't a React component — it can share the new dialog's *visual* style but not its code without changing the deck-deletion mechanism from a form POST to a fetch call, which is a functional change, not polish.

## What We're NOT Doing

- No dark/light theme toggle — the dead `.dark` CSS is removed instead of wired up.
- No mobile/responsive redesign — desktop-only per the PRD's explicit non-goal.
- No shared `Input`/`Textarea` primitive extraction — the duplicated `<textarea>` markup across 3 files is already visually identical (no inconsistency to fix), and it's lower leverage than the Button/Dialog work given the timeline.
- No change to `decks/index.astro`'s deck-deletion mechanism — it stays a native form POST + vanilla-JS confirm; only its visual styling is aligned with the new `ConfirmDialog`.
- No automated visual-regression tooling and no new CI step — verification is manual per screen, matching this project's current no-test-framework baseline.
- No accessibility audit beyond the focus-ring consistency that falls out of the Button/token work.
- No expanded, multi-section marketing homepage — a single hero + value prop + CTA, matching what exists everywhere else.

## Implementation Approach

Shared primitives first, then a screen-by-screen sweep, in priority order so the highest-leverage fixes land even if time runs short before the 2026-08-10 deadline. Phase 1 (design tokens + Button variants) is the foundation every later phase depends on. Phase 2 (Topbar) is next because it's rendered on literally every page — the single highest-leverage fix available. Phases 3–4 extract and migrate onto the remaining shared primitives (dialogs, buttons, states). Phases 5–6 sweep the two screens that still don't match the rest of the app, then do a final consistency pass — Phase 6 is the one to cut first if time runs out.

## Critical Implementation Details

- **Theming approach**: hardcode the Button CVA variants' colors as literal Tailwind classes matching the cosmic palette (purple-600 primary, red-600 destructive, white/10 glass neutral) rather than routing them through shadcn's oklch CSS variable tokens. The app has one visual theme, not a themeable token system, and the translucent glass look (`bg-white/10`) doesn't map cleanly onto a solid oklch color token.
- **Astro/React boundary**: `Topbar.astro` and `decks/index.astro` are plain Astro templates, not React islands. Lucide icons render there without a `client:*` directive (Astro server-renders non-interactive framework markup with no JS shipped), and their buttons/dialogs are visually matched to the new components' classNames rather than importing the components directly — converting either file into a React island would change how the page behaves, not just how it looks.

## Phase 1: Design Tokens & Button CVA Variants

### Overview

Establishes the single color/variant foundation every later phase's Button and Topbar work depends on, and removes dead dark-mode CSS.

### Changes Required:

#### 1. Global design tokens

**File**: `src/styles/global.css`

**Intent**: Remove the entirely dead `.dark {}` block (nothing ever applies a `.dark` class) and its now-unneeded `@custom-variant dark` hook. Update the tokens actually consumed today (`--background`, `--foreground` via `body`, and `--border`/`--ring` via the global `* { @apply border-border outline-ring/50; }` base rule) so they match the cosmic dark theme instead of shadcn's unrelated light-mode default — this also fixes a latent bug where `body`'s background currently resolves to white. Drop the remaining semantic tokens (`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--card`, `--popover`, `--input`, `--chart-*`, `--sidebar-*`) since after Phase 1's Button rewrite none of them are referenced anywhere in the codebase.

**Contract**: `:root` retains only `--radius`, `--background`, `--foreground`, `--border`, `--ring`; the `@theme inline` mapping block shrinks to match; the `.dark {}` block and `@custom-variant dark` line are deleted.

#### 2. Button component variants

**File**: `src/components/ui/button.tsx`

**Intent**: Redefine the 5 CVA variants (`default`, `destructive`, `secondary`, `outline`, `ghost`) to match the concrete colors already used everywhere via literal classes, so call sites can rely on `variant`/`size` props instead of overriding `className` wholesale. This also corrects `ReviewSessionPanel.tsx`'s FSRS rating buttons (lines 411-424), which already pass variant props but currently render with the wrong color.

**Contract**: Same 5 variant names and 4 sizes (`default`/`sm`/`lg`/`icon`) — only their Tailwind classes change, so no call-site signatures change in this phase. `disabled:opacity-50` and `focus-visible:ring-ring/50` stay part of the shared base classes, so every call site migrated in later phases gets consistent disabled/focus styling for free.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- ReviewSessionPanel's 4 rating buttons render with the intended purple/red/glass/outline look
- No visual change on any screen that doesn't yet consume the new variants (this phase only touches tokens, not call sites)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Topbar Navigation Redesign

### Overview

`Topbar.astro` renders on every page via `Layout.astro`, so it's the single highest-leverage fix in this pass — replaces the flat row of same-colored text links with icons, an active-page indicator, and a proper Button-styled Sign out action.

### Changes Required:

#### 1. Top navigation bar

**File**: `src/components/Topbar.astro`

**Intent**: Add a lucide icon per nav item (matching the icon convention already used throughout the app's React panels), visually distinguish the current page from the other links, and restyle the plain "Sign out" `<button>` to match Phase 1's Button look.

**Contract**: Needs the current request path (`Astro.url.pathname`) to compute which nav link is active. Icons are lucide-react components imported and rendered directly in the `.astro` file with no `client:*` directive (see Critical Implementation Details). The Sign out `<button>` stays plain HTML (Topbar.astro isn't a React island) with hand-matched `ghost`/`secondary`-equivalent classes rather than importing the Button component.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Icons render correctly for Dashboard/Decks/Sign out (and Sign in/Sign up when signed out)
- The current page is visually distinguishable from the other nav links on at least 3 different pages
- Nav reads clearly at a glance — the original "hard to see the options" complaint is resolved

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Shared ConfirmDialog Primitive + Button Call-Site Migration

### Overview

Extracts the one missing shared primitive this app needs (a confirm dialog) and migrates every Button call site in the React component tree onto Phase 1's variants.

### Changes Required:

#### 1. Shared confirm dialog primitive

**File**: `src/components/ui/confirm-dialog.tsx` (new)

**Intent**: One reusable confirmation dialog matching the visual style every hand-rolled `<dialog>` already shares, controlled by an `open` boolean so it fits both interaction patterns already in use — imperative ref-based show/close (CardListPanel, ReviewSessionPanel) and effect-driven show-on-server-error (CancelDeletionDialog, DeleteAccountDialog).

**Contract**: Props: `open`, `title?`, `description` (`ReactNode`), `confirmLabel`, `cancelLabel`, `danger?` (drives the confirm button's variant), `isPending?`, `error?`, `onConfirm`, `onCancel`. Internally owns the `<dialog>` ref and a `useEffect` that calls `showModal()`/`close()` based on `open`, so callers just flip a boolean instead of touching the dialog element.

#### 2. CardListPanel dialog + button migration

**File**: `src/components/decks/CardListPanel.tsx`

**Intent**: Replace the hand-rolled delete-confirm `<dialog>` (lines 338-381) with `<ConfirmDialog danger>`; migrate the Save/Cancel/Edit/Delete/Prev/Next buttons (lines 256-330) to variant props.

**Contract**: `Save` → `default`, `Cancel`/`Edit`/`Prev`/`Next` → `secondary`, list-row `Delete` → `ghost` with the existing `text-red-300` kept as a small additive className (a one-off text-color exception, not a new variant).

#### 3. ReviewSessionPanel dialog + button migration

**File**: `src/components/decks/ReviewSessionPanel.tsx`

**Intent**: Replace the hand-rolled reset-confirm `<dialog>` (lines 253-302) with `<ConfirmDialog danger>`; migrate the remaining raw-styled buttons (`Show answer`, `Continue reviewing`, `Reset session`, `Finish for now` — lines 334-445) to variant props. The 4 FSRS rating buttons (lines 411-424) already use variants and need no code change.

**Contract**: `Show answer`/`Continue reviewing` → `default`, `Finish for now` → `secondary`, `Reset session` → `ghost` with the same red-text override as CardListPanel's Delete. `Finish for now` is currently a navigational `<a href="/decks">`, not a `<button>` — keep it a link by using `<Button asChild variant="secondary"><a href="/decks">...</a></Button>` (the same Radix `Slot` pattern `button.tsx` already supports via its `asChild` prop) rather than converting it into a button element, which would lose native link behavior (middle-click, right-click copy-link, no-JS fallback).

#### 4. Account dialogs + button migration

**Files**: `src/components/account/CancelDeletionDialog.tsx`, `src/components/account/DeleteAccountDialog.tsx`

**Intent**: Replace both hand-rolled `<dialog>`s with `<ConfirmDialog>` (`DeleteAccountDialog` uses `danger`); migrate their remaining raw-styled buttons. `DeleteAccountDialog`'s "Delete my account" button already uses `variant="destructive"` (line 76) and needs no change beyond inheriting Phase 1's corrected red.

**Contract**: Each dialog keeps its existing form-post-on-confirm behavior (`/api/account/cancel`, `/api/account/delete`) — only the dialog chrome and buttons change, not the request flow.

#### 5. Remaining raw-styled buttons

**Files**: `src/components/decks/CreateCardPanel.tsx`, `src/components/decks/GenerateFlashcardsPanel.tsx`, `src/components/auth/SubmitButton.tsx`

**Intent**: Migrate each raw-className Button usage to variant props (`default` for primary actions like Add card/Generate/Save, `secondary` for Accept all/Reject all/Try again).

**Contract**: The per-proposal Accept/Reject buttons in `GenerateFlashcardsPanel.tsx` (lines 279-309) have a 3-state selected/unselected look (emerald when accepted, red when rejected, neutral otherwise) that doesn't map onto the 5 standard variants — keep their existing `cn()`-based conditional className approach layered on a `secondary` base rather than forcing a new CVA variant for a one-off toggle state.

#### 6. Visual-only alignment for the native Astro dialog

**File**: `src/pages/decks/index.astro`

**Intent**: Align the vanilla-JS delete-confirmation dialog's classes and buttons to match `ConfirmDialog`'s rendered look, without changing its underlying form-POST + `<dialog>` mechanism.

**Contract**: Visual parity only — same dialog chrome, same button styling as `ConfirmDialog danger` renders, no change to the POST-based deletion request.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- All 5 confirm dialogs (cards, review-reset, cancel-deletion, delete-account, deck-delete) open, confirm, and cancel correctly and look visually identical to each other
- Every migrated button shows correct hover/disabled/focus states
- GenerateFlashcardsPanel's Accept/Reject selected-state coloring still works after migration

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Shared Loading/Empty/Inline-Error State Components

### Overview

Extracts the three small presentational patterns currently copy-pasted with minor drift across the deck/card/review panels, and migrates every occurrence onto them.

### Changes Required:

#### 1. Shared state components

**Files**: `src/components/ui/loading-state.tsx`, `src/components/ui/empty-state.tsx`, `src/components/ui/inline-error.tsx` (all new)

**Intent**: `LoadingState` reuses the spinner pattern already established in `GenerateFlashcardsPanel.tsx` (lines 213-217) instead of the plain "Loading..." text used elsewhere. `EmptyState` centers muted text for the several "you don't have any X yet" messages. `InlineError` is the small `<CircleAlert> + text-red-300` pattern repeated ad hoc — distinct from the existing boxed `ServerError` banner, which stays as-is for page/server-level errors and isn't touched by this phase.

**Contract**: `LoadingState` takes a `label`; `EmptyState` takes `children`; `InlineError` takes a `message` and a `size` (`"sm"`/`"xs"`, matching the two sizes already in use for field-level vs. save/load errors).

#### 2. Migrate call sites

**Files**: `src/components/decks/CardListPanel.tsx`, `src/components/decks/ReviewSessionPanel.tsx`, `src/components/decks/CreateCardPanel.tsx`, `src/components/decks/GenerateFlashcardsPanel.tsx`, `src/pages/decks/index.astro`

**Intent**: Replace each plain "Loading cards.../Loading review session..." text, each "doesn't have any cards/decks yet" paragraph, and each ad hoc `<CircleAlert>` error paragraph with the new shared components.

**Contract**: `decks/index.astro`'s occurrences are Astro-native — matched visually the same way as Phase 3's ConfirmDialog boundary, not through direct component reuse.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Every touched panel shows a spinner (not bare text) while loading
- Every empty-state and inline-error message looks identical across panels

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Homepage Restyle + Dashboard Alignment

### Overview

Replaces the stock Astro-starter homepage with a real, if simple, cosmic-themed landing page, and fixes dashboard's heading-size mismatch with the rest of the centered-card archetype.

### Changes Required:

#### 1. Homepage

**Files**: `src/pages/index.astro`, `src/components/Welcome.astro` (removed)

**Intent**: Replace the `<Welcome />` starter component with a minimal landing page — headline, one-paragraph value prop (paste text, get AI-generated flashcards in seconds), and Sign in/Sign up CTAs — styled to the centered-card archetype used by the auth pages. This is a real page, not a stub or a redirect.

**Contract**: Still rendered inside `<Layout>` (Topbar/Banner keep working); `Welcome.astro` is deleted since nothing else imports it.

#### 2. Dashboard heading + buttons

**File**: `src/pages/dashboard.astro`

**Intent**: Change the `<h1>` from `text-3xl` (line 10) to `text-2xl`, matching every other centered-card screen; migrate the "Sign out" button (lines 20-27) to the Phase 1 Button component with a `secondary`/`outline` variant.

**Contract**: No structural change — same centered-card container, just heading size and button styling brought in line with account/auth pages.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Homepage no longer resembles the stock Astro starter template; CTAs navigate to `/auth/signin` and `/auth/signup` correctly
- Dashboard's heading and Sign out button now match account/auth pages' look

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Final Consistency Sweep & Cross-Screen QA

### Overview

The lowest-leverage, most cosmetic stragglers — first to cut if the 2026-08-10 deadline runs tight — plus a full manual pass over all 12 screens once every other phase has landed.

### Changes Required:

#### 1. Confirm-email icon

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Replace the raw emoji (✅/📧, lines 8/14/26) with lucide-react icons matching the app's icon convention (e.g. a check-circle icon for the auto-confirmed state, a mail icon for the check-your-email state), rendered the same statically-imported way as Phase 2's Topbar icons.

**Contract**: Same size/placement as the current emoji (`text-5xl` container, centered).

#### 2. Decks list Delete action

**File**: `src/pages/decks/index.astro`

**Intent**: Style the plain-text "Delete" link (line 52) to match the app's button visual language, consistent with how its confirm-dialog buttons were aligned in Phase 3.

**Contract**: Visual-only change — stays a form-submit trigger for the existing delete-confirmation flow.

#### 3. Archetype audit

**Intent**: Confirm every one of the 12 pages consistently belongs to one of the two established archetypes, and fix any straggler found during review. This is a review step, not tied to a specific file.

- List/Detail (`max-w-2xl`, left-aligned, `text-3xl` heading, "← Decks" back-link) — 5 pages: `decks/index`, `decks/[id]/index`, `decks/[id]/generate`, `decks/[id]/cards/new`, `decks/[id]/review`
- Centered-Card (`max-w-sm`, centered, `text-2xl` heading) — 7 pages: `index` (homepage), `auth/signin`, `auth/signup`, `auth/confirm-email`, `dashboard`, `account/index`, `account/pending-deletion`

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `confirm-email.astro` shows icons, not emoji
- Deck-list Delete action visually matches the rest of the app's buttons
- Full click-through of all 12 screens shows no remaining archetype stragglers and no regressions introduced by Phases 1-5

**Implementation Note**: After completing this phase and all automated verification passes, this is the final phase — confirm the whole plan's Desired End State is met.

---

## Testing Strategy

### Unit Tests:

Not applicable — no test framework is configured yet (see `CLAUDE.md`), and this is a presentation-only change with no new business logic.

### Integration Tests:

Not applicable, same reason.

### Manual Testing Steps:

1. Run `npm run dev`, sign out, and view the homepage — confirm it no longer looks like a starter template.
2. Click through the signed-out auth screens: sign in, sign up, and confirm-email (both the auto-confirmed and check-your-email variants) — confirm icons render and layout matches the centered-card archetype.
3. Sign in and click through Dashboard → Decks → deck detail → Generate → Add card → Review, confirming Topbar's active-page indicator updates and all buttons/dialogs look consistent.
4. Click through Account settings and, separately, the pending-deletion screen (trigger account deletion, then view `/account/pending-deletion`) — confirm both match the centered-card archetype and their dialogs/buttons look consistent with the rest of the app.
5. Trigger every confirm dialog (delete deck, delete card, reset review session, cancel account deletion, delete account) and verify identical chrome and correct confirm/cancel behavior.
6. Force a loading state (throttle network) and an error state (e.g. stop the dev server mid-request) to confirm the shared LoadingState/InlineError components render.
7. Complete a review session through to "Session complete" and rate at least one FSRS card, confirming the rating buttons render in the corrected purple/red/glass/outline colors.

## Performance Considerations

None — this is a presentation-only pass; no new network calls, and the new components are small and tree-shaken like the rest of `lucide-react` already in use.

## Migration Notes

No data migration. `Welcome.astro` is deleted in Phase 5; confirm no page other than `index.astro` imports it before removing.

## References

- Roadmap: `context/foundation/roadmap.md` (S-07)
- Related prior decision: `context/changes/ux-improvements/plan.md:58` (deferred the same Button/CVA inconsistency this plan resolves)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design Tokens & Button CVA Variants

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 179683b
- [x] 1.2 Build passes: `npm run build` — 179683b

#### Manual

- [x] 1.3 ReviewSessionPanel's 4 rating buttons render with the intended purple/red/glass/outline look — 179683b
- [x] 1.4 No visual change on any screen that doesn't yet consume the new variants — 179683b

### Phase 2: Topbar Navigation Redesign

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — ef1d5dd
- [x] 2.2 Build passes: `npm run build` — ef1d5dd

#### Manual

- [x] 2.3 Icons render correctly for Dashboard/Decks/Sign out (and Sign in/Sign up when signed out) — ef1d5dd
- [x] 2.4 The current page is visually distinguishable from the other nav links on at least 3 different pages — ef1d5dd
- [x] 2.5 Nav reads clearly at a glance — the original "hard to see the options" complaint is resolved — ef1d5dd

### Phase 3: Shared ConfirmDialog Primitive + Button Call-Site Migration

#### Automated

- [x] 3.1 Lint passes: `npm run lint`
- [x] 3.2 Build passes: `npm run build`

#### Manual

- [x] 3.3 All 5 confirm dialogs (cards, review-reset, cancel-deletion, delete-account, deck-delete) open, confirm, and cancel correctly and look visually identical to each other
- [x] 3.4 Every migrated button shows correct hover/disabled/focus states
- [x] 3.5 GenerateFlashcardsPanel's Accept/Reject selected-state coloring still works after migration

### Phase 4: Shared Loading/Empty/Inline-Error State Components

#### Automated

- [ ] 4.1 Lint passes: `npm run lint`
- [ ] 4.2 Build passes: `npm run build`

#### Manual

- [ ] 4.3 Every touched panel shows a spinner (not bare text) while loading
- [ ] 4.4 Every empty-state and inline-error message looks identical across panels

### Phase 5: Homepage Restyle + Dashboard Alignment

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Build passes: `npm run build`

#### Manual

- [ ] 5.3 Homepage no longer resembles the stock Astro starter template; CTAs navigate to `/auth/signin` and `/auth/signup` correctly
- [ ] 5.4 Dashboard's heading and Sign out button now match account/auth pages' look

### Phase 6: Final Consistency Sweep & Cross-Screen QA

#### Automated

- [ ] 6.1 Lint passes: `npm run lint`
- [ ] 6.2 Build passes: `npm run build`

#### Manual

- [ ] 6.3 `confirm-email.astro` shows icons, not emoji
- [ ] 6.4 Deck-list Delete action visually matches the rest of the app's buttons
- [ ] 6.5 Full click-through of all 12 screens shows no remaining archetype stragglers and no regressions introduced by Phases 1-5
