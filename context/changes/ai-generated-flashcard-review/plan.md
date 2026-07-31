# AI-Generated Flashcard Review — Implementation Plan

## Overview

This is S-02, the product's north star: a signed-in user pastes study text into a selected deck's "generate" page, the app calls an AI service (OpenRouter) to produce flashcard proposals, and the user accepts or rejects each proposal before anything is written to the `cards` table. Only accepted cards persist, tagged `source: 'ai'`.

## Current State Analysis

- F-01 and S-01 are done: `decks`/`cards` schema with RLS is live, and `/decks` supports create/list/delete via native `<form>` → API-route → redirect, matching the auth feature's pattern exactly.
- The `cards` table already has a `source` enum (`'ai' | 'manual'`) — built in F-01 in anticipation of this exact slice. **No schema migration is needed.**
- No AI provider is wired up anywhere in the codebase: no SDK dependency, no API key in `astro.config.mjs`/`.env`, no Cloudflare Workers AI binding in `wrangler.jsonc`. `tech-stack.md` only flags `has_ai: true` — the vendor was never chosen.
- Every existing feature is a native-form-POST-then-redirect flow (`src/pages/api/decks/index.ts`, `src/pages/api/decks/[id]/delete.ts`). That pattern doesn't fit this slice: generation returns a structured batch of proposals that the user reviews interactively before anything saves, which needs client-side state, not a redirect.
- `src/lib/config-status.ts` + the `Banner.astro` in `Layout.astro` already show a warning banner when Supabase env vars are missing — the same pattern extends cleanly to a missing OpenRouter key.
- Card browsing (S-04) is a separate, not-yet-built, parallel roadmap slice — this plan must not build general card-list/browse/edit UI.

## Desired End State

A signed-in user, from `/decks`, clicks "Generate cards" on one of their decks, lands on `/decks/[id]/generate`, pastes up to ~10,000 characters of text, clicks "Generate". A loading state shows while the AI call runs; a list of proposal cards (front/back) renders below. Each proposal has an Accept and a Reject button that toggle a selected state (highlighted) without any network call or removing the card from view. Once done reviewing, the user clicks "Save N cards" — only the accepted proposals are POSTed and inserted into `cards` with `source: 'ai'`; rejected and undecided proposals are discarded client-side. The page then shows a confirmation: the front/back of the cards just saved, plus the deck's new total card count.

Verification: manually walk the flow end-to-end with real pasted text against a real OpenRouter key, confirm accepted cards land in the `cards` table with `source = 'ai'` (via Supabase Studio or a `select`), and confirm a second user account cannot see or affect the first user's proposals or saved cards (RLS, already proven in F-01, holds for the new insert path too).

### Key Discoveries:

- `cards.source` enum already exists (`supabase/migrations/20260729164431_deck_card_schema_foundation.sql:3`) — this slice only inserts against it, no migration.
- `cards` RLS policies derive ownership via `decks.user_id` (no denormalized `cards.user_id`) — the insert policy (`cards_insert_own`) already enforces that a card can only be inserted into a deck the authenticated user owns. The batch-save endpoint doesn't need to re-check deck ownership in application code; a forged `deck_id` for another user's deck is rejected by Postgres, not by our code.
- `src/lib/config-status.ts` + `Layout.astro`'s banner loop is the established pattern for surfacing a missing external-service env var — reuse it verbatim for the OpenRouter key.
- `SubmitButton`'s pending state relies on `useFormStatus`, which only tracks a real `<form>`'s submission — it doesn't apply here since generation is a `fetch()` call from React state, not a form navigation. This phase needs its own local `isGenerating`/`isSaving` boolean state instead.
- `astro.config.mjs`'s `env.schema` pattern (`envField.string({ context: "server", access: "secret", optional: true })`) is how `SUPABASE_URL`/`SUPABASE_KEY` are declared — the OpenRouter key follows the same shape, `optional: true` so CI/build doesn't fail without it configured yet (matching Supabase's own precedent).

## What We're NOT Doing

- No custom SRS algorithm, file import, sharing, mobile UI, or LMS integrations (PRD Non-Goals, unchanged).
- No general card browsing, editing, or deletion UI (that's S-04's scope). The post-save confirmation shows only the cards from *this* save, not the deck's full card history.
- No manual flashcard creation UI (S-03's scope).
- No persistence of undecided/generated-but-not-saved proposals anywhere (no staging table, no session storage) — proposals live only in React state until "Save" is clicked.
- No automated test harness or AI-response mocking — matches the deck-management precedent; no test framework is configured yet, and testing strategy is a later course module's topic.
- No prompt-quality tuning loop or acceptance-rate telemetry in this plan — the 75% bar is a product metric measured after real usage, not a build-time gate. The prompt is designed once, reasonably, and iterated post-launch (PRD Open Question #2, explicitly non-blocking).
- No streaming/token-by-token rendering of the AI response — a single request/response round trip is sufficient given generation is expected to take single-digit seconds.

## Implementation Approach

Two new API routes are added under `/api/decks/[id]/`: `generate` (calls OpenRouter, returns JSON proposals) and `cards` (batch-inserts accepted proposals). Both are JSON-in/JSON-out `fetch()` endpoints called from a client-side React component — a deliberate departure from the rest of the app's native-form-POST-redirect convention, because this feature's UX (review a batch, toggle each item, then save) is inherently a client-state interaction that a full-page redirect can't support without inventing server-side staging storage. The deck-management convention (form → API route → redirect) is preserved everywhere it still fits (nav, route protection); only the generate/review/save interaction breaks from it, and that's called out explicitly here so a future reviewer doesn't mistake it for an inconsistency.

The OpenRouter integration is a thin `src/lib/openrouter.ts` wrapper around a plain `fetch()` call to `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible shape) — no SDK dependency needed, keeping the Cloudflare Workers runtime footprint minimal. The prompt instructs the model to return a JSON array of `{front, back}` objects; the response is parsed and validated per-item, with malformed items filtered out silently (only erroring if the valid-item count is zero, which also covers the "trivial text → no cards" business rule from the PRD).

## Phase 1: Foundation — AI client, config, route protection, nav entry point

### Overview

Wires up the OpenRouter client wrapper and its env var, extends route protection and the missing-config banner, and adds the "Generate cards" entry point from the deck list. No generation happens yet — this phase makes the plumbing exist and lets Phase 2 focus purely on the generation flow itself.

### Changes Required:

#### 1. OpenRouter env var

**File**: `astro.config.mjs`

**Intent**: Declare the OpenRouter API key as a server-only secret, following the exact shape already used for `SUPABASE_URL`/`SUPABASE_KEY`.

**Contract**: Add `OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` to `env.schema`.

#### 2. Missing-config banner

**File**: `src/lib/config-status.ts`

**Intent**: Extend the existing `configStatuses` array with an OpenRouter entry so `Layout.astro`'s existing banner loop picks it up automatically — no changes needed to `Layout.astro` itself.

**Contract**: New entry `{ name: "OpenRouter", configured: Boolean(OPENROUTER_API_KEY), message: "...", }` following the Supabase entry's shape (Polish message text, matching the existing entry's language).

#### 3. OpenRouter client wrapper

**File**: `src/lib/openrouter.ts` (new)

**Intent**: A single function that takes source text and a target proposal shape, calls OpenRouter's chat completions endpoint, and returns parsed `{front, back}` proposals — with malformed items filtered and a thrown error only when zero valid items and the call itself didn't fail cleanly (i.e., distinguish "AI call failed" from "AI call succeeded with legitimately zero extractable concepts").

**Contract**: Exported function, e.g. `generateFlashcards(sourceText: string): Promise<{ proposals: { front: string; back: string }[] }>`. Internally: POST to `https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer ${OPENROUTER_API_KEY}`, a system prompt instructing extraction of distinct, memorizable concepts as front/back pairs and to return strictly a JSON array (empty array for trivial/non-extractable text), and `response_format: { type: "json_object" }` (or `json_schema` if the chosen model supports it) to bias the model toward valid JSON. Parse `choices[0].message.content`, `JSON.parse` it, validate each item has non-empty `front`/`back` strings, filter out anything that doesn't. Never log `sourceText` — not in success, not in error paths.

#### 4. Route protection & nav entry point

**File**: `src/middleware.ts`

**Intent**: Guard the new page and API routes the same way `/decks` and `/api/decks` already are.

**Contract**: Add `/decks/*/generate`-matching coverage — since `PROTECTED_ROUTES` uses `startsWith`, `/decks` already covers `/decks/[id]/generate` and `/api/decks` already covers `/api/decks/[id]/generate` and `/api/decks/[id]/cards`. No changes needed here beyond confirming this during manual verification (this is a discovery, not a code change — see Success Criteria).

**File**: `src/pages/decks/index.astro`

**Intent**: Add a "Generate cards" link per deck row, next to the existing Delete button, pointing at `/decks/[id]/generate`.

**Contract**: One `<a href={`/decks/${deck.id}/generate`}>` per list item, styled consistently with the existing row (same visual weight as the Delete link).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- With `OPENROUTER_API_KEY` unset, `/decks` shows the new missing-config banner alongside (or instead of) the Supabase one, matching existing banner styling.
- `/decks/<real-id>/generate` and a direct POST to `/api/decks/<real-id>/generate` both redirect to `/auth/signin` when signed out.
- The "Generate cards" link appears on every deck row in `/decks` and navigates to the correct deck's generate page.

---

## Phase 2: Generation flow

### Overview

Builds the paste-text UI and the `generate` API route so a user can submit text and see AI-generated proposals render on the page, with loading, error, and empty-result states.

### Changes Required:

#### 1. Generate API route

**File**: `src/pages/api/decks/[id]/generate.ts` (new)

**Intent**: Accept pasted text for a specific deck, call the OpenRouter wrapper, and return the proposals as JSON — a genuine JSON API endpoint, not a redirecting form handler (see Implementation Approach for why this route deliberately breaks from the rest of the app's convention).

**Contract**: `POST`, JSON body `{ text: string }`. Validates `context.locals.user` is set (middleware already guarantees this) and that `text` is a non-empty string ≤ 10,000 characters (matching the client-side limit — both layers validate, same pattern as deck-name duplicate checking in F-01/S-01 having both a client check and a DB backstop). Calls `generateFlashcards(text)`. Responds `200 { proposals }` on success (including the "zero extractable concepts" case — this is `proposals: []`, not an error). Responds with a `4xx`/`5xx` JSON error body `{ error: string }` only on an actual AI-call failure (timeout, non-2xx from OpenRouter, unparseable response with zero salvageable items). Never includes `text` in any response or thrown error.

#### 2. Generate page

**File**: `src/pages/decks/[id]/generate.astro` (new)

**Intent**: Server-render the page shell (deck name, protected route already covers it) and mount the client-side review component.

**Contract**: Fetches the deck's name server-side (for the page heading) via the same per-request Supabase client pattern as `/decks/index.astro`; 404s or redirects if the deck doesn't belong to the user (RLS `select` returns nothing). Renders `<GenerateFlashcardsPanel deckId={deck.id} client:load />`.

#### 3. Generate + review client component (generation half)

**File**: `src/components/decks/GenerateFlashcardsPanel.tsx` (new)

**Intent**: A textarea for pasting text, a "Generate" button, and (once this phase is done) a rendered list of proposals below it. This component owns all client-side state for the feature — text input, generation-in-progress, the proposal list, and (built out fully in Phase 3) each proposal's accept/reject selection and the save flow.

**Contract**: `useState` for `text`, `isGenerating`, `proposals: {front, back}[] | null`, `generationError: string | null`. On submit: client-side length validation (≤ 10,000 chars, mirroring `MAX_NAME_LENGTH`'s pattern in `CreateDeckForm`), then `fetch(`/api/decks/${deckId}/generate`, { method: "POST", body: JSON.stringify({ text }) })`. On success with `proposals.length === 0`, render the friendly "no flashcards could be generated — try adding more detail" empty state (distinct from `generationError`). On success with items, render one card per proposal (front/back visible) — full Accept/Reject interactivity is Phase 3's job; this phase can render them as plain, non-interactive cards to keep the phase's scope verifiable in isolation. On failure, render `generationError` inline with a "Try again" button that re-triggers the same submit. While `isGenerating`, disable the Generate button and show "Generating..." text (mirroring `SubmitButton`'s pending-state visual, but implemented via local state since this isn't a real form submission).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Pasting real study text (a few paragraphs) and clicking Generate shows a "Generating..." state, then renders a non-empty list of front/back proposals.
- Pasting trivial/empty-ish text (e.g. a single word) yields the friendly zero-results state, not an error.
- Temporarily using an invalid `OPENROUTER_API_KEY` produces the inline error state with a working "Try again" button, and the browser network tab shows the pasted text never appears in the error response body.
- Pasting text over 10,000 characters is blocked client-side with a clear message before any network call fires.

---

## Phase 3: Review & save flow

### Overview

Completes the feature: each rendered proposal gets working Accept/Reject toggle buttons, and a "Save" action persists the accepted subset via a new batch endpoint, followed by a confirmation view.

### Changes Required:

#### 1. Save API route

**File**: `src/pages/api/decks/[id]/cards.ts` (new)

**Intent**: Insert a batch of accepted proposals into `cards` for the given deck, tagged `source: 'ai'`.

**Contract**: `POST`, JSON body `{ cards: { front: string; back: string }[] }`. Validates each item's `front`/`back` are non-empty (mirroring the DB's own `check` constraints — a defensive client-side-shaped validation, not a re-implementation of ownership/RLS). Inserts all items in one `supabase.from("cards").insert(rows)` call with `deck_id: id, source: "ai"` on each row; RLS's `cards_insert_own` policy is the actual authorization boundary (see Key Discoveries) — a forged `id` for another user's deck fails at the database, and the route surfaces that as a `4xx` JSON error. Responds `200 { saved: { front, back }[], totalCardCount: number }` — `totalCardCount` is a follow-up `select count` on the deck's cards, used for the confirmation view.

#### 2. Review UI — accept/reject toggle

**File**: `src/components/decks/GenerateFlashcardsPanel.tsx`

**Intent**: Add per-proposal accept/reject state and a "Save" action that submits only the accepted ones.

**Contract**: Extend proposal state to `{ front: string; back: string; decision: "accepted" | "rejected" | null }[]`. Each rendered card gets two buttons; clicking "Accept" sets that item's `decision` to `"accepted"` (and visually highlights the Accept button, un-highlighting Reject if previously set), clicking "Reject" is the mirror. No network call on either click, no removal from the list, no confirmation dialog (matches the answered "immediate, no-confirm toggle" decision). A "Save N cards" button (N = current count with `decision === "accepted"`) is enabled once at least one proposal is accepted; clicking it POSTs only the accepted items' `{front, back}` to the save route.

#### 3. Post-save confirmation

**File**: `src/components/decks/GenerateFlashcardsPanel.tsx`

**Intent**: After a successful save, replace the review list with a confirmation view scoped to this save only (see the answered "lightweight confirmation, not full card browsing" decision) — explicitly not a general card-browsing UI, which is S-04's scope.

**Contract**: New state `saveResult: { saved: {front, back}[]; totalCardCount: number } | null`. On save success, render a heading like "Saved N cards to this deck" (N = `saved.length`), list each saved card's front/back read-only, and show `totalCardCount`. Rejected and never-decided proposals are simply not shown here — they were discarded, not saved. No edit/delete affordance on this list.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Generate a batch of proposals, accept some and reject others (toggling back and forth at least once), verify only the currently-accepted set is reflected before saving — no network calls fire until "Save" is clicked.
- Click "Save N cards" and confirm the confirmation view lists exactly the accepted cards, with a correct total deck card count.
- Query the `cards` table directly (Supabase Studio or SQL) and confirm the saved rows have `source = 'ai'` and the correct `deck_id`, and that rejected/undecided proposals were never inserted.
- As a second user account, attempt (via direct API call with a forged `deck_id` belonging to the first user) to POST to `/api/decks/[first-user-deck-id]/cards` — confirm it fails and no row is inserted (RLS holds).
- Refresh the generate page mid-review (before saving) and confirm all undecided/accepted-but-unsaved state is gone — nothing was silently persisted.

---

## Testing Strategy

### Unit Tests:

None — no test framework is configured in this codebase yet (per `CLAUDE.md`); introducing one is out of scope for this plan (see What We're NOT Doing).

### Integration Tests:

None automated, for the same reason. The manual verification steps in each phase serve as the integration-level check for this slice.

### Manual Testing Steps:

1. Full happy path: create/select a deck → generate from real text → accept most, reject a few → save → confirm the saved list and total count.
2. Zero-result path: paste trivial text (e.g. "ok"), confirm the friendly empty state, not an error.
3. Failure path: break the OpenRouter key temporarily, confirm the inline error + retry, confirm no source text leaks into the error response.
4. Cross-user isolation: attempt to generate into / save cards against another user's deck ID directly via API calls; confirm both are rejected.
5. Long-input guard: paste > 10,000 characters, confirm client-side block before any network call.

## Performance Considerations

Generation is a single request/response round trip to OpenRouter — no streaming. Given the NFR that any operation over 2 seconds needs visible progress, the "Generating..." disabled-button state covers this; no additional performance work is needed for the expected data volumes (a single deck's proposal batch, not the 500-card NFR ceiling which concerns browsing/review at scale, not generation).

## Migration Notes

No schema migration — `cards.source = 'ai'` already exists from F-01. No existing data to migrate.

## References

- Related roadmap item: `context/foundation/roadmap.md` (S-02)
- Related PRD sections: US-01, FR-007, FR-008, NFR (source-text retention, >2s progress)
- Precedent implementation: `context/changes/deck-management/plan.md`, `src/pages/api/decks/index.ts:1`, `src/pages/api/decks/[id]/delete.ts:1`
- Schema: `supabase/migrations/20260729164431_deck_card_schema_foundation.sql:3` (`cards.source` enum)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Foundation — AI client, config, route protection, nav entry point

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — cd28636
- [x] 1.2 Linting passes: `npm run lint` — cd28636
- [x] 1.3 Build succeeds: `npm run build` — cd28636

#### Manual

- [x] 1.4 Missing-config banner shows when `OPENROUTER_API_KEY` is unset — cd28636
- [x] 1.5 `/decks/<id>/generate` and `/api/decks/<id>/generate` redirect to signin when signed out — cd28636
- [x] 1.6 "Generate cards" link appears on every deck row and navigates correctly — cd28636

### Phase 2: Generation flow

#### Automated

- [x] 2.1 Type checking passes: `npx astro check`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Build succeeds: `npm run build`

#### Manual

- [x] 2.4 Pasting real text shows generating state then a non-empty proposal list
- [x] 2.5 Trivial text yields the friendly zero-results state, not an error
- [x] 2.6 Invalid API key produces inline error + working retry, with no source text leaked in the response
- [x] 2.7 Text over 10,000 characters is blocked client-side before any network call

### Phase 3: Review & save flow

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 Accept/reject toggling works with no network calls until Save
- [ ] 3.5 Save persists exactly the accepted set and shows a correct confirmation view
- [ ] 3.6 Saved rows have `source = 'ai'` and correct `deck_id`; rejected/undecided rows are never inserted
- [ ] 3.7 Cross-user forged-deck-id save attempt is rejected by RLS
- [ ] 3.8 Refreshing mid-review loses all undecided/unsaved state (nothing silently persisted)
