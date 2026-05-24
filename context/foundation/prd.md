---
project: "10xFiszki"
version: 1
status: draft
created: 2026-05-23
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: "2026-08-10"
  after_hours_only: true
---

## Vision & Problem Statement

Manual flashcard creation is time-consuming enough to break the habit of using spaced repetition entirely. A professional learning on the job — picking up domain vocabulary, technical concepts, or procedural knowledge — has the material in front of them but lacks the time to turn it into quality flashcards. The cost is not just inefficiency; it's that the most effective study method (spaced repetition) gets abandoned in favor of less effective alternatives because the entry cost is too high.

The insight: AI can turn any pasted text into a deck of flashcards in seconds, reducing the creation cost from "hours per topic" to "seconds per topic". The user brings the material; the product does the card-making. Manual creation remains available for cases where the AI falls short.

## User & Persona

Primary persona: a professional learning new domain knowledge on the job — technical vocabulary, procedural rules, compliance material, API references, or any structured knowledge they need to retain. They already know spaced repetition works. Their problem is that building a deck from scratch takes longer than they have between tasks. They want to paste a block of text, get usable flashcards, and start reviewing immediately.

## Success Criteria

### Primary
- 75% of AI-generated flashcards are accepted by the user (accepted = user does not reject them during the review step before adding to deck).

### Secondary
- 75% of all flashcards in the system are created via the AI generation path, not the manual creation path. Indicates the AI path is genuinely preferred over manual entry.

### Guardrails
- Card data (accepted cards, review progress, scheduling state) must never be silently lost on save or session end.
- Source text submitted for AI generation must not be retained or exposed beyond what is strictly necessary to fulfill the generation request.
- The app must be fully usable on the current two major versions of mainstream desktop browsers, with no plugin or native installation required.

## User Stories

### US-01: User generates flashcards from pasted text

- **Given** a logged-in user with at least one deck
- **When** they paste study text and trigger card generation
- **Then** they see a list of AI-generated cards to review, one at a time or as a batch, and can accept or reject each before it is saved to the deck

#### Acceptance Criteria
- At least one card is generated for any non-trivial text input (> ~100 characters)
- Rejected cards are discarded and do not appear in the deck
- Accepted cards are immediately visible in the deck's card list
- The generation step shows visible progress while the AI is working

## Functional Requirements

### Authentication
- FR-001: User can register with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "rolling our own auth adds security surface for zero product value — use a third-party auth service." Resolution: kept as-is; decision deferred to tech-stack selection. Auth is table stakes for a multi-user app regardless of implementation choice.
- FR-002: User can sign in with email and password. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-003: User can sign out. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.

### Decks
- FR-004: User can create a named deck. Priority: must-have
  > Socrates: Counter-argument considered: "ship a flat card pool first, add decks in v2." Resolution: kept; even 30–50 cards need organization. Decks are the minimal organization primitive and removing them would require a retroactive migration in v2.
- FR-005: User can view a list of their decks. Priority: must-have
  > Socrates: No separate counter-argument; covered by FR-004 decision.
- FR-006: User can delete a deck. Priority: must-have
  > Socrates: No separate counter-argument; stands as written.

### AI Generation
- FR-007: User can paste text and trigger AI generation of flashcards for a selected deck. Priority: must-have
  > Socrates: Counter-argument considered: "if AI quality is <50% good, the whole value prop collapses." Resolution: kept; the 75% acceptance rate success criterion is the explicit quality gate. If it can't be met, the product fails on its own terms — this FR is still correct.
- FR-008: User can accept or reject each AI-generated card before it is added to the deck. Priority: must-have
  > Socrates: Counter-argument considered: "accept/reject per card is tedious for large text; consider accept-all with optional reject." Resolution: kept; per-card accept/reject is the UX that produces the 75% acceptance rate metric. Accept-all would obscure quality signal.

### Manual Creation
- FR-009: User can manually create a flashcard (front and back) within a deck. Priority: must-have
  > Socrates: Counter-argument considered: "drop manual creation — AI-only forces focus and reduces build scope." Resolution: kept; manual creation is the escape hatch when AI misses something specific. Its absence would frustrate users for an edge case that is cheap to support.

### Card Management
- FR-010: User can browse all cards in a deck. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-011: User can edit a card (front and back) after it has been added to a deck. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.
- FR-012: User can delete a card from a deck. Priority: must-have
  > Socrates: No counter-argument raised; stands as written.

### Review
- FR-013: User can start a spaced repetition review session for a deck. Priority: must-have
  > Socrates: No counter-argument raised; the SRS review loop is the entire point of the product. Stands as written.
- FR-014: User can rate their recall on each card during a review session (scheduling delegated to a third-party SRS service). Priority: must-have
  > Socrates: Counter-argument noted but not actioned: "different SRS services use different rating scales — validate the third-party API shape before committing." Resolution: kept as-is; API contract is a downstream implementation concern, not a change to this FR. Recorded in Open Questions.

## Non-Functional Requirements

- No user's cards, decks, or review history are accessible to any other user under any circumstances.
- The app remains usable with up to 500 cards across all decks without perceptible slowdown in card browsing and review session loading.
- Card data (accepted cards, deck structure, review scheduling state) must never be silently lost on save or session end.
- Source text submitted for AI generation must not be retained or exposed to third parties beyond what is strictly necessary to fulfill the generation request.
- The app is fully functional on the current two major versions of mainstream desktop browsers with no plugin or native installation required.
- Any operation that takes longer than two seconds provides continuous visible progress to the user.

## Business Logic

Given a block of text, the app decides which concepts are worth memorizing and how to phrase them as question-answer pairs.

The user supplies the raw input: any text they can paste — a paragraph, a chapter summary, a set of notes. The output is a set of flashcard proposals, each structured as a front (question or prompt) and a back (answer or explanation). The user encounters this output as a review step: they see each proposal and accept or reject it before it enters their deck. The app does not ask the user to specify what to extract or how to phrase it — those judgments are the app's job.

The rule is classification and extraction: identify what is conceptually distinct and worth isolating for repeated recall, then phrase it in a form that exercises retrieval. Text that has no extractable concepts (empty, trivial, or purely procedural without facts) should produce zero or near-zero proposals, not filler cards.

## Access Control

Multi-user web app. Users register and sign in with email + password. No OAuth. Flat role model — every logged-in user has identical capabilities. An authenticated user can only access their own flashcards; no cross-user data access. An unauthenticated user hitting a gated route is redirected to the login page.

## Non-Goals

- **No custom SRS algorithm.** Scheduling is fully delegated to a third-party SRS service. No SM-2, FSRS, or equivalent algorithm is implemented in this codebase. Rationale: building and tuning a spaced repetition algorithm is a separate domain problem; third-party services are battle-tested.
- **No file import.** Text input is paste-only for v1. No PDF, DOCX, image, or URL parsing. Rationale: scope containment; paste covers the primary workflow.
- **No sharing or collaborative features.** Each user's cards and decks are private. No public decks, shared collections, or team workspaces. Rationale: single-user MVP; multi-user coordination is a separate product surface.
- **No mobile app or mobile-optimized experience.** Desktop browsers only for the MVP. Rationale: explicitly out of scope; mobile adds UI complexity with no near-term payoff.
- **No integrations with external learning platforms.** No connectors to LMS, Notion, or other education tools. Rationale: integration development adds scope and maintenance burden before product–market fit is established.

## Open Questions

1. **Which third-party SRS service?** The rating scale (1–4, again/hard/good/easy, etc.) is API-contract-specific. The review UI (FR-014) cannot be finalized until the SRS service is selected. Owner: user. Block: yes for FR-014 implementation.
2. **AI generation prompt design.** What instructions produce 75%+ acceptance rate? The domain rule is clear, but the prompt engineering is unknown. Owner: user. Block: no (FR-007 is still correct; prompt design is an implementation concern).
3. **Deck deletion behavior.** When a user deletes a deck, what happens to its cards and their SRS scheduling state? Cascade delete, or archive? Owner: user. By: start of implementation.
