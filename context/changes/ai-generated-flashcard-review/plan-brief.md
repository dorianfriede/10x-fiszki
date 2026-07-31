# AI-Generated Flashcard Review — Plan Brief

> Full plan: `context/changes/ai-generated-flashcard-review/plan.md`

## What & Why

This is S-02, the product's north star: a user pastes study text, gets AI-generated flashcard proposals for a chosen deck, and accepts or rejects each one before anything is saved. Everything else in the roadmap only matters if this proves the AI-generated cards clear the 75% acceptance bar the product's value proposition rests on.

## Starting Point

F-01 (schema + RLS) and S-01 (deck create/view/delete) are done. The `cards` table already has a `source` enum (`'ai' | 'manual'`) built in advance for this exact slice — no migration needed. No AI provider is wired up anywhere yet: no SDK, no API key, no Cloudflare Workers AI binding. Every existing feature (auth, decks) follows a native-form-POST-then-redirect pattern that doesn't fit this slice's need for interactive, stateful review.

## Desired End State

From `/decks`, a user clicks "Generate cards" on a deck, pastes text on `/decks/[id]/generate`, watches a brief "Generating..." state, then sees a list of proposal cards. Each has Accept/Reject toggle buttons that highlight the selection with no network call. Clicking "Save N cards" persists only the accepted ones as `source: 'ai'` cards and shows a confirmation with what was saved plus the deck's new total card count.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| AI provider | OpenRouter | Model-agnostic, single key, edge-compatible via plain `fetch()`, standard across the course | Plan |
| Review architecture | Client-side React state + batch save | A postback-per-card model would need server-side staging storage for undecided proposals; client state is the natural fit for a JSON-shaped review batch | Plan |
| Trigger UX | Single page, inline results | No extra navigation; matches the app's single-page-per-action convention | Plan |
| Proposal persistence | Ephemeral, client-state only | Directly satisfies the "don't retain source-derived content beyond necessity" guardrail; zero new schema | Plan |
| Error handling | Inline error + retry; filter malformed items silently | One bad JSON item shouldn't waste an otherwise-successful generation | Plan |
| Source-text retention | Never logged or persisted, anywhere, even on error | Unambiguous compliance with the NFR | Plan |
| Progress UX | Disabled button + "Generating..." text | Reuses the existing pending-state visual convention; generation is single-digit seconds | Plan |
| Zero-result handling | Friendly empty state, not an error | Matches the PRD's explicit rule that trivial text should yield zero cards, not a failure | Plan |
| Save timing | One batch save at the end | Matches "review then save"; fewer writes than save-per-accept | Plan |
| Reject interaction | Toggle highlight, no removal, no confirm | User's own specification: Accept/Reject both stay visible and highlight on selection; unsaved ones are discarded at Save time | Plan |
| Text length limit | ~10,000 characters, client + server validated | Generous for real notes/summaries while guarding against runaway AI cost/timeout | Plan |
| Post-save view | Confirmation scoped to this save only | Satisfies US-01's "immediately visible" criterion without building S-04's card-browsing scope | Plan |
| Testing bar | Lint + typecheck + build, manual for behavior | Matches deck-management precedent; no test framework exists yet, that's a later module's topic | Plan |

## Scope

**In scope:** OpenRouter integration, `/decks/[id]/generate` page, paste-text + generate flow, per-proposal accept/reject toggle UI, batch-save endpoint, post-save confirmation limited to this save's cards, nav entry point from `/decks`, missing-config banner for the new env var.

**Out of scope:** general card browsing/editing/deletion (S-04), manual card creation (S-03), any schema migration, automated/mocked AI testing, prompt-quality tuning loop, streaming responses, file import, sharing, mobile UI.

## Architecture / Approach

Two new JSON API routes under `/api/decks/[id]/`: `generate` (calls a thin OpenRouter `fetch()` wrapper, returns parsed proposals) and `cards` (batch-inserts the accepted subset with `source: 'ai'`). Both are called via client-side `fetch()` from a single React component (`GenerateFlashcardsPanel`) that owns all review state — a deliberate, explicitly-flagged departure from the rest of the app's form-POST-redirect convention, justified by the feature's inherently interactive review step. RLS (already live) is the real authorization boundary for the save insert; no application-level ownership re-check is needed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation | OpenRouter client + env config, missing-config banner, route protection confirmation, nav entry point | None of this is independently visible until Phase 2 exists — verified mostly via redirect/banner checks |
| 2. Generation flow | Paste-text UI, generate endpoint, loading/error/empty states | Prompt/parsing quality — malformed AI JSON must degrade gracefully, not crash the flow |
| 3. Review & save flow | Accept/reject toggle UI, batch-save endpoint, post-save confirmation | Getting the "toggle highlight, no removal, no immediate persistence" interaction model right per the user's explicit spec |

**Prerequisites:** F-01 and S-01 (both done — schema/RLS and deck CRUD live). An OpenRouter API key must be obtained before Phase 2 can be manually verified end-to-end (Phase 1 builds cleanly without it, degrading to the missing-config banner).
**Estimated effort:** ~2 sessions across 3 phases — the north star feature, more involved than deck-management's 3 phases due to the new external integration and new client-state UI pattern.

## Open Risks & Assumptions

- AI prompt design is not finalized in this plan (PRD Open Question #2) — the prompt is written once, reasonably, in Phase 1's `openrouter.ts`, and is expected to be iterated after real usage data comes in against the 75% acceptance bar. This is a non-blocking, post-launch concern per the roadmap.
- Assumes OpenRouter's chat completions endpoint (OpenAI-compatible shape) is reachable and stable from Cloudflare Workers via plain `fetch()` — not yet verified against a real deployed Worker, only against local dev; Phase 1/2 manual verification should include one production/preview deploy check.
- The `PROTECTED_ROUTES` prefix-matching in `src/middleware.ts` is assumed to already cover the new nested routes (`/decks/*/generate`, `/api/decks/*/generate`, `/api/decks/*/cards`) via existing `/decks` and `/api/decks` prefixes — Phase 1's manual verification confirms this rather than assuming it silently.

## Success Criteria (Summary)

- A signed-in user can paste text, generate proposals, accept/reject each, and save — with only accepted cards landing in the deck as `source: 'ai'`.
- No pasted source text is ever logged, persisted, or exposed beyond the single generation request.
- A second user can never generate into or save cards against another user's deck (RLS holds against forged requests).
