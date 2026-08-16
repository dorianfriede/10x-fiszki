---
change_id: deck-card-schema-foundation
title: Decks/cards schema and row-level isolation
status: archived
created: 2026-07-29
updated: 2026-08-16
archived_at: 2026-08-16T11:17:28Z
---

## Notes

Sourced from roadmap item F-01 (`context/foundation/roadmap.md`).

- Outcome: Supabase Postgres schema for `decks` and `cards` with migrations; row-level security policies guarantee a user can only read/write their own rows.
- PRD refs: NFR (data isolation), Access Control section
- Unlocks: S-01, S-02 (north star), S-03, S-04, S-05 — every downstream slice needs a persisted deck/card to exist first.
- Prerequisites: none — this is the first foundation item.
- Resolved unknown (PRD Open Question #3): deleting a deck cascade-deletes its cards and their SRS scheduling state. The cards table's foreign key should be defined accordingly.
