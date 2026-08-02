---
change_id: testing-critical-path-coverage
title: Testing critical path coverage
status: new
created: 2026-08-02
updated: 2026-08-02
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md` §3. Bootstrap Vitest;
cover risks #1–#3 (review-session FSRS correctness, deck/card CRUD edge
cases, no silent save loss) at unit + integration layer.

Stack (§4): Vitest (`getViteConfig()`, `environment: 'node'` for Astro
components), Astro Container API for API-route tests, native fetch
mock/MSW for external calls. No e2e or AI-native layer in this phase.

Quality gate: unit + integration becomes a required CI gate after this
phase lands (§5).

Next: `/10x-research` to ground risks #1–#3 against current code before
planning.
