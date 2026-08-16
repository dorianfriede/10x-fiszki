# UI Polish — Plan Brief

> Full plan: `context/changes/ui-polish/plan.md`

## What & Why

10xFiszki's screens share a "cosmic" glass visual language, but it's expressed through duplicated literal Tailwind classes instead of shared components — buttons mostly bypass the shadcn `Button`'s variant system, five files hand-roll a near-identical confirm dialog, loading/empty/error states each look slightly different, the top nav is a flat row of same-colored links, and the homepage/dashboard don't match the rest of the app. This is a purely presentational, cross-cutting pass (roadmap slice S-07) — no new functional capability.

## Starting Point

Every page already shares one `Layout.astro` (with a global `Topbar` nav), one color palette, and one glass-panel visual pattern — the foundation is more consistent than it first appears. The real gaps are: Button variants defined but unused, no shared confirm-dialog component, ad hoc loading/empty/error text, an unstyled top nav, dead dark-mode CSS, and two screens (homepage, dashboard) that don't match the rest.

## Desired End State

Every screen shares one visual language driven by a small set of primitives: a `Button` component whose variants match the colors already in use, one reusable `ConfirmDialog`, shared loading/empty/inline-error components, and a legible top nav with icons and an active-page indicator. Homepage and dashboard match the rest of the app.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Scope | Visual consistency + missing primitives (Button variants, ConfirmDialog) | Fixes the root cause of drift, not just symptoms — prevents the same duplication recurring next feature. |
| Homepage | Restyle as a minimal, real landing page | Closes the most jarring inconsistency (stock Astro starter) with small effort; confirmed not to be a stub. |
| Dashboard | Normalize heading/buttons to the shared centered-card archetype | Nav already exists via Layout/Topbar — the real gap was just heading size and raw buttons. |
| Topbar | Icons + active-page state + Button-based Sign out | Rendered on every page — highest-leverage single fix; directly addresses "hard to see the options." |
| Buttons | Migrate call sites to CVA variant props | One definition of each button look; fixes disabled/focus-state gaps for free via the shared CVA base. |
| Confirm dialogs | Extract one shared `ConfirmDialog` | Eliminates 5x duplicated dialog markup/JS; the one non-React usage (decks list) gets visual parity only. |
| Dark mode | Remove the dead `.dark` CSS block | No PRD requirement, zero user-facing effect, removes dead code and unused tokens. |
| Loading/empty/error states | Extract small shared components | Matches the same "fix the source of drift" approach as Button/Dialog. |
| Priority | Shared primitives first, then screen sweep, cut lowest-leverage first | Guarantees the highest-reuse fixes ship even if the 8-day window runs short. |
| Verification | Manual visual review per screen | Matches this project's no-test-framework baseline; no new tooling cost. |

## Scope

**In scope:** Button CVA variant migration, one shared `ConfirmDialog`, shared loading/empty/inline-error components, Topbar redesign, homepage restyle, dashboard alignment, confirm-email icon fix, decks-list Delete styling, dead dark-mode CSS removal.

**Out of scope:** Dark/light theme toggle, mobile/responsive redesign, shared Input/Textarea primitive, changing the deck-deletion request mechanism, automated visual-regression tooling, accessibility audit beyond focus-ring consistency, multi-section marketing homepage.

## Architecture / Approach

Primitives first, then a sweep: Phase 1 fixes the color/variant foundation (also fixing a pre-existing bug where `ReviewSessionPanel`'s FSRS rating buttons already use variants but render the wrong color). Phase 2 redesigns Topbar since it's on every page. Phases 3–4 extract `ConfirmDialog` and the state components and migrate every call site onto them. Phases 5–6 fix the two off-brand screens and do a final sweep + full manual QA pass.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Design tokens & Button CVA variants | Color/variant foundation; fixes FSRS button color bug | Regression on the one place variants already work (ReviewSessionPanel) |
| 2. Topbar navigation redesign | Icons, active-page state, Button-styled Sign out | Astro/React boundary — no `client:*` island needed for static icons |
| 3. ConfirmDialog + Button migration | One shared dialog; every panel's buttons on variants | GenerateFlashcardsPanel's 3-state Accept/Reject coloring must survive migration |
| 4. Shared loading/empty/error states | Consistent spinner/empty/inline-error everywhere | None significant |
| 5. Homepage + Dashboard alignment | Real landing page; dashboard matches centered-card archetype | Homepage copy is new content, not just styling |
| 6. Final sweep & QA | confirm-email icons, decks-list Delete styling, full click-through | First phase to cut if the deadline runs tight |

**Prerequisites:** None beyond what's already in the codebase (S-01–S-05 all exist).
**Estimated effort:** ~6 phases, each independently shippable; roughly a session or two per phase.

## Open Risks & Assumptions

- The 2026-08-10 deadline gives ~8 days — Phase 6 (and parts of Phase 5's homepage copy) are the first things to trim if time runs short.
- Hardcoding Button CVA colors as literal Tailwind classes (rather than re-theming shadcn's CSS variables) is a deliberate simplification given the app has one visual theme, not a themeable system — flagged in the plan's Critical Implementation Details so it isn't second-guessed mid-implementation.

## Success Criteria (Summary)

- Every screen's buttons, dialogs, loading/empty/error states, and page heading/layout pattern look consistent with the rest of the app.
- The top nav is legible, shows the active page, and no longer reads as "hard to see the options."
- The homepage and dashboard no longer look like a different product than the rest of the app.
