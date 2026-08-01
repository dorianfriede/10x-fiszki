---
change_id: card-browsing-and-editing
title: Card browsing, editing, and deletion
status: implementing
created: 2026-08-01
updated: 2026-08-01
archived_at: null
---

## Notes

Sourced from roadmap item S-04 (`context/foundation/roadmap.md`).

- Outcome: user can browse all cards in a deck, edit a card's front/back, and delete a card.
- PRD refs: FR-010, FR-011, FR-012
- Prerequisites: F-01 (`deck-card-schema-foundation`), S-01 (`deck-management`) — both `impl_reviewed`, schema/RLS and deck CRUD live.
- Parallel with: S-02, S-03, S-05
- Risk: only needs the schema and a deck to exist, not a specific card-creation path — proceeds independently of S-02/S-03.
