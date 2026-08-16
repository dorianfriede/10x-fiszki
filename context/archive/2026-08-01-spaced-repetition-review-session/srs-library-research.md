---
change_id: spaced-repetition-review-session
title: SRS library research and decision
created: 2026-08-01
---

## Question

Which third-party SRS service/library to use for scheduling (PRD Open Question #1, roadmap S-05 Unknown), compatible with the stack: Astro v6 SSR on Cloudflare Workers/Pages, TypeScript, Supabase Postgres.

## Options considered

### A. Self-hosted scheduling libraries (npm, run inside our own Astro API routes)

| Library | Algorithm | Cloudflare Workers fit | Notes |
|---|---|---|---|
| `ts-fsrs` (`open-spaced-repetition/ts-fsrs`) | FSRS v6 (used by Anki) | Core scheduler (`fsrs()`, `.repeat()`, `.next()`) is pure TS/JS — deps are just `dayjs` + `seedrandom`. Separate optimizer/binding package needs native binaries or WASM and does **not** run in edge runtimes (no WASI support in Workers) — not needed for v1 scheduling, only for later personalized-parameter tuning. | 708★, MIT, actively maintained, TypeDoc'd. Strongest algorithm of the options found. |
| `supermemo` (npm) | SM-2 (classic) | Zero dependencies, trivially edge-safe | 331★, MIT, tiny (~12KB). Older/simpler algorithm than FSRS. |
| `@open-spaced-repetition/sm-2` / `@dtjv/sm-2` | SM-2 | Pure TS, no native deps | Newer/smaller alternatives to `supermemo`, low adoption. |

### B. Hosted third-party SRS API

| Service | Notes |
|---|---|
| SuperMemo API (`api.supermemo.com`) | SM-20 algorithm as a REST API — the literal "third-party SRS service." Launched March 2026, currently early access: 100 reviews/day free-tier cap, pricing not yet finalized, transactions not yet enabled. Risky against the 2026-08-10 hard deadline. |

No other general-purpose hosted SRS APIs were found — remaining results were app-specific products (StudyFetch, inspir.uk) bundling their own SM-2 internally, not integrable services.

## Decision

Use **`ts-fsrs`** (FSRS v6), self-hosted inside our own Astro API routes — not an external hosted SRS API.

- **Algorithm:** FSRS v6, via `fsrs()` / `.repeat()` (preview all 4 ratings) / `.next()` (apply chosen rating). Card scheduling state is computed server-side and persisted in our own `cards` rows (Supabase) — no review data leaves our infrastructure.
- **Why self-hosted over a hosted third-party API:** SuperMemo API is the only real hosted alternative, and it's early access with an unproven SLA and unfinalized pricing — too risky against the deadline. `ts-fsrs` gives an equivalent (arguably better-regarded) algorithm with zero external dependency, zero added latency, and no data-isolation concerns for the NFR.
- **Cloudflare Workers compatibility:** the core scheduler (`fsrs`, `createEmptyCard`, `Rating`, `.repeat()`, `.next()`) is pure TypeScript and runs fine on Workers/edge. The weights-optimizer/binding is edge-incompatible but out of scope for this slice — default `generatorParameters()` are sufficient for v1.
- **Rating scale:** FSRS's native 4-button scale — Again / Hard / Good / Easy (`Rating` enum) — maps directly onto FR-014's review UI.

## Status

This resolves the SRS-service Unknown blocking S-05 in `context/foundation/roadmap.md` and PRD Open Question #1. Roadmap/PRD not yet updated to reflect this — pending.
