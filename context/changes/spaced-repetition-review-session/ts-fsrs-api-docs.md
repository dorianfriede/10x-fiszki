---
change_id: spaced-repetition-review-session
title: ts-fsrs API reference (fetched via Context7)
created: 2026-08-01
---

## Purpose

API surface needed to implement S-05 (`spaced-repetition-review-session`). Builds on the library decision in `srs-library-research.md` (self-hosted `ts-fsrs`, FSRS v6).

## Core API

```typescript
import { fsrs, createEmptyCard, Rating, generatorParameters } from 'ts-fsrs'

const scheduler = fsrs()          // or fsrs(generatorParameters({...}))
const card = createEmptyCard()    // initial state for a brand-new card row
```

- **`scheduler.repeat(card, now)`** — preview all 4 outcomes without committing. Use to render the review UI's 4 buttons with their resulting due dates before the user picks one.
  - Signature: `repeat(card: CardInput | Card, now: DateInput): IPreview`
  - `IPreview` is indexable by `Rating` (e.g. `preview[Rating.Good].card`) and iterable.
- **`scheduler.next(card, now, grade)`** — apply the user's chosen rating. Returns `{ card, log }`.
  - Signature: `next(card: CardInput | Card, now: DateInput, grade: Grade): RecordLogItem`
  - `grade`: `Rating.Again | Rating.Hard | Rating.Good | Rating.Easy` (values 1–4)
  - Throws `FSRSValidationError` if grade is not 1–4 or card/date is invalid.

## Types to persist per card row

```typescript
interface Card {
  due: Date
  stability: number
  difficulty: number
  elapsed_days: number      // deprecated but still present
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: State               // New | Learning | Review | Relearning
  last_review?: Date
}
```

Optional review-history table, if FR-014/S-05 wants one:

```typescript
interface ReviewLog {
  rating: Rating
  state: State
  due: Date
  stability: number
  difficulty: number
  elapsed_days: number
  last_elapsed_days: number
  scheduled_days: number
  learning_steps: number
  review: Date
}

type RecordLogItem = { card: Card; log: ReviewLog }
```

## Config relevant to this slice

```typescript
generatorParameters({
  request_retention: 0.9,   // default — target recall rate; lower = shorter intervals
  maximum_interval: 36500,  // default (100 years) — cap on scheduled interval
  enable_fuzz: false,       // default — deterministic intervals (no randomization)
  enable_short_term: true,  // default — same-day learning-step optimization
})
```

All defaults are sane for v1 — per `srs-library-research.md`'s decision, no tuning needed; use `fsrs()` with no overrides (or `generatorParameters()` defaults explicitly).

## Implementation shape for the API route

1. Load the card's persisted FSRS fields from Supabase.
2. Reconstruct as `CardInput`/`Card`.
3. Call `scheduler.next(card, new Date(), rating)`.
4. Write `result.card` fields back to the row (and optionally insert `result.log` into a review-history table).

Pure TypeScript, no native/WASM dependency — runs fine on the Cloudflare Workers/Pages adapter already in use, confirming the compatibility claim in `srs-library-research.md`.

## Source

Fetched via Context7 MCP from `/open-spaced-repetition/ts-fsrs` (GitHub: `open-spaced-repetition/ts-fsrs`, README + `_autodocs/`).
