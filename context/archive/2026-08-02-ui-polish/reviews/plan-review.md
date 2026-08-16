<!-- PLAN-REVIEW-REPORT -->
# Plan Review: UI Polish — Cross-Cutting Visual Consistency Pass

- **Plan**: context/changes/ui-polish/plan.md
- **Mode**: Deep
- **Date**: 2026-08-02
- **Verdict**: REVISE
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

16/16 file paths verified to exist. Line-number citations spot-checked against actual source (ReviewSessionPanel.tsx:411-424 FSRS variants, CardListPanel.tsx:338-381/256-330, GenerateFlashcardsPanel.tsx:213-217 spinner, DeleteAccountDialog.tsx:76 destructive variant, dashboard.astro:20-27, confirm-email.astro:8/14/26 emoji) — all accurate. Blast-radius sweeps: (1) semantic CSS tokens slated for removal (`--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--card`, `--popover`, `--input`, `--chart-*`, `--sidebar-*`) confirmed referenced only in `button.tsx`/`global.css` — safe to drop; (2) `dark:` variant utilities confirmed used only in `button.tsx` (being rewritten in Phase 1 anyway) — safe to remove `@custom-variant dark`; (3) `Welcome.astro` confirmed imported only by `index.astro` — safe to delete in Phase 5; (4) all 7 files using the `<Button>` component match the plan's call-site inventory exactly, no missed callers. Brief↔plan: consistent.

## Findings

### F1 — "8 screens" undercounts the actual 12-page app

- **Severity**: WARNING
- **Impact**: MEDIUM — real ambiguity; the fix requires care across several plan sections, not just a typo swap
- **Dimension**: Plan Completeness
- **Location**: Desired End State; Phase 6 Overview & Manual Verification (6.5); Testing Strategy → Manual Testing Steps
- **Detail**: The plan repeatedly targets "a manual click-through of all 8 screens" (Desired End State) and Phase 6's archetype audit says "Confirm every one of the 8 pages consistently belongs to one of the two established archetypes." The codebase actually has 12 page files: `index`, `auth/signin`, `auth/signup`, `auth/confirm-email`, `dashboard`, `decks/index`, `decks/[id]/index`, `decks/[id]/generate`, `decks/[id]/cards/new`, `decks/[id]/review`, `account/index`, `account/pending-deletion`. The plan's own Testing Strategy → Manual Testing Steps only explicitly walks Homepage, Dashboard, Decks list, deck detail, Generate, Add card, Review (7 screens) — `auth/signup`, `account/index`, `account/pending-deletion` are never named in a manual-testing step, and `auth/signin` is only implied ("Sign in and click through..."). Nothing in the roadmap or PRD defines "8" as a deliberate curated subset — S-07's roadmap entry just says "all existing screens." Since Phase 6's intent is explicitly completeness ("no remaining archetype stragglers"), an implementer following the letter of "8 screens" risks signing off Phase 6 without ever opening signup, account settings, or the pending-deletion screen.
- **Fix ⭐**: Replace "8 screens"/"8 pages" (Desired End State, Phase 6 Overview, success criterion 6.5) with the explicit enumerated list of all 12 pages, grouped by the plan's own two archetypes (List/Detail: decks list, deck detail, generate, cards/new, review; Centered-Card: homepage, signin, signup, confirm-email, dashboard, account, pending-deletion), and add the 4 missing pages to Testing Strategy's Manual Testing Steps.
  - Strength: Closes the exact gap the plan's own Phase 6 language claims to close ("no remaining archetype stragglers") — makes the QA gate match its stated intent.
  - Tradeoff: A few extra minutes of manual click-through in Phase 6, the phase already flagged as first-to-cut if time runs short.
  - Confidence: HIGH — page count is a directly-countable fact, not a judgment call.
  - Blind spot: None significant.
- **Decision**: FIXED — replaced "8 screens" with the enumerated 12-page list (Desired End State, Phase 6 §3, success criterion 6.5, Progress 6.5) and added signup/account/pending-deletion/signin to Testing Strategy's Manual Testing Steps.

### F2 — "Finish for now" is a link, not a button; migration contract doesn't say so

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 — ReviewSessionPanel dialog + button migration
- **Detail**: Phase 3's contract for ReviewSessionPanel says `"Finish for now" → secondary` alongside real `<Button>` elements (`Show answer`, `Continue reviewing`, `Reset session`). But `ReviewSessionPanel.tsx:359-364` renders "Finish for now" as a plain `<a href="/decks" className="rounded-lg bg-white/10 px-4 py-2 ...">`, not a `<Button>` — it's a navigation link styled to look like a button, not an actual button. The plan's Critical Implementation Details section calls out the Astro/React boundary nuance for other files but says nothing about this link-vs-button nuance, so an implementer told to "migrate to variant props" could naively swap it for `<Button onClick={() => window.location.href = "/decks"}>`, losing native link semantics (middle-click/open-in-new-tab, right-click "copy link", crawlability, no-JS fallback).
- **Fix**: Note in Phase 3 §3's contract that "Finish for now" should use `<Button asChild variant="secondary"><a href="/decks">...</a></Button>` (the same Radix `Slot` pattern `button.tsx` already supports via its `asChild` prop) rather than converting the anchor into a button element.
- **Decision**: FIXED — added the `asChild` note to Phase 3 §3's contract.
