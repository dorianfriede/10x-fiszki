---
change_id: account-deletion
title: Account deletion with 30-day retention
status: implemented
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Sourced from roadmap item S-08 (`context/foundation/roadmap.md`).

- Outcome: user can request account deletion; the account and its data (decks, cards, review history) are retained for 30 days before permanent purge, giving the user a window to reverse the request.
- PRD refs: — not in PRD v1; relates to Access Control / Auth (FR-001–FR-003) but no FR covers deletion or retention specifically.
- Prerequisites: F-01 (`deck-card-schema-foundation`) — `impl_reviewed`, schema/RLS and cascade-delete FKs live.
- Parallel with: S-02, S-03, S-04, S-05, S-06, S-07
- Purge mechanism (roadmap Open Question #4) resolved during planning: `pg_cron` scheduled SQL job, not Supabase's native `shouldSoftDelete` (documented irreversible) or a Custom Access Token Hook. See `plan.md` for the architecture rationale.
