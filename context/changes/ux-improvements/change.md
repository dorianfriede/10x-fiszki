---
change_id: ux-improvements
title: Bulk candidate review actions + review session reset
status: implementing
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Sourced from roadmap item S-06 (`context/foundation/roadmap.md`).

- Outcome: user can select multiple AI-generated candidate cards during the S-02 review step and accept/reject them as a batch, and can reset an in-progress spaced-repetition review session (S-05) back to its starting state instead of abandoning it.
- PRD refs: — not in PRD v1; gap identified by the user during S-01–S-05 implementation.
- Prerequisites: F-01 (`deck-card-schema-foundation`) — done.
- Parallel with: S-05
- Extends: `ai-generated-flashcard-review` (S-02, `GenerateFlashcardsPanel.tsx`) and `spaced-repetition-review-session` (S-05, `ReviewSessionPanel.tsx`), both `impl_reviewed`.
