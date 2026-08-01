---
change_id: spaced-repetition-review-session
title: Spaced-repetition review session
status: impl_reviewed
created: 2026-08-01
updated: 2026-08-02
archived_at: null
---

## Notes

Sourced from roadmap item S-05 (`context/foundation/roadmap.md`).

- Outcome: user can start a review session for a deck and rate their recall on each card; scheduling itself is delegated to a third-party SRS service.
- PRD refs: FR-013, FR-014
- Prerequisites: F-01 (`deck-card-schema-foundation`), S-01 (`deck-management`) — both `impl_reviewed`, schema/RLS and deck CRUD live.
- Parallel with: S-02, S-03, S-04
- ~~**Blocked:** which third-party SRS service to use (PRD Open Question #1).~~ Resolved 2026-08-01: self-hosted `ts-fsrs` library (FSRS v6) — no longer blocked, ready for `/10x-plan`. Research and rationale: `srs-library-research.md` in this same directory.
