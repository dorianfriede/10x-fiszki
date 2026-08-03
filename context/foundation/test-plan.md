# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-03

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (30-day window, 36
commits — excludes `supabase/`, docs, fixtures, build output).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                            | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Review session (FSRS) produces incorrect or inconsistent recall ratings / due-dates                                | High   | High       | interview Q3 (low-confidence area); hot-spot file `ReviewSessionPanel.tsx` (8 commits/30d); archived slice `spaced-repetition-review-session` (plan/implementation deviation on scheduler config) |
| 2   | Deck/card CRUD behaves incorrectly under edge-case or concurrent input                                             | High   | High       | interview Q3 (low-confidence area); hot-spot dirs `src/components/decks/` (28 commits/30d), `src/pages/api/` (20), `src/pages/decks/` (14); archived slice `card-browsing-and-editing`            |
| 3   | Accepted cards or SRS state are silently lost on save (partial batch insert, non-atomic multi-row update)          | High   | High       | PRD NFR guardrail ("must never be silently lost on save or session end"); interview Q1 (top stated worry); archived slices `ai-generated-flashcard-review`, `ux-improvements`                     |
| 4   | A user reaches or modifies another user's deck/card/review data via a forged ID or ownership-check gap             | High   | Medium     | PRD NFR / Access Control ("under any circumstances"); archived slices `deck-card-schema-foundation`, `card-browsing-and-editing`, `account-deletion`                                              |
| 5   | AI generation flow hangs or fails without a clear signal to the user (timeout/integration regression)              | High   | Medium     | interview Q2 (confirmed past incident, already fixed once); hot-spot dir `src/components/decks/` (28 commits/30d); archived slice `ai-generated-flashcard-review`                                 |
| 6   | A transient error in an account/session state check fails open, granting access it should deny                     | High   | Medium     | archived slice `account-deletion` (a fail-open bug of exactly this class was found and fixed)                                                                                                     |
| 7   | AI generation or bulk endpoints have no cost/rate controls, allowing repeated expensive calls or mass side-effects | Medium | Medium     | archived slice `ai-generated-flashcard-review` (no retry/rate-limit handling — open gap); archived slice `ux-improvements` (an unbounded-array endpoint found and fixed once)                     |

Abuse/security lens applied: this product has auth and accepts user input
across every deck/card/review endpoint, so authorization/IDOR (#4) and
resource abuse (#7) are included as genuine surfaces. Untrusted-input/
injection and secret/PII leakage were checked; secret/PII leakage is
already governed by an explicit enforced rule (never log source text or
API key) and is folded into #5's response guidance rather than a
standalone row, since no live gap was found there.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                     | Must challenge                                                                         | Context `/10x-research` must ground                                                                                   | Likely cheapest layer                                             | Anti-pattern to avoid                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| #1   | A review submission produces the FSRS-correct next state (rating → due date / stability / difficulty transition) for known input states                         | "The FSRS library call succeeded" ≠ "the scheduling output is correct for this rating" | FSRS config/options actually in use, request→persistence path, timezone/`due`-snapshot handling                       | unit (FSRS transition logic) + integration (API route round-trip) | assertion copied from the current implementation's output instead of an independent FSRS reference case |
| #2   | Concurrent/rapid edits to different cards never cross-contaminate state; edits to a nonexistent/foreign card ID return not-found, not a crash or silent success | "It works when I click slowly" ≠ "it works when two saves race"                        | client-side in-flight-state keys, server route's per-row update logic, ownership/404-collapsing behavior              | integration (API route + component interaction)                   | happy-path-only edit/save test with no concurrent or foreign-ID case                                    |
| #3   | A batch save either fully succeeds or fails with all accepted cards recoverable — nothing silently disappears                                                   | "The success toast appeared" ≠ "all N cards actually persisted"                        | batch insert transaction boundary, restore-path multi-row update behavior, what the UI reports vs. what was persisted | integration (API route + DB assertion)                            | asserting only the HTTP status code without verifying row-level persistence                             |
| #4   | A forged/foreign resource ID on any deck/card/review endpoint returns not-found or unauthorized, never another user's data                                      | "User is logged in" ≠ "user owns this specific resource"                               | RLS policy shape per table, zero-rows-matched handling, which endpoints have zero app-level ownership checks          | integration (API route, two-user fixture)                         | testing only the authenticated-owner path and skipping the cross-user attempt                           |
| #5   | An upstream AI-call failure or timeout surfaces a clear, bounded error to the user and never hangs indefinitely or leaks source text/key                        | "It worked in the demo" ≠ "it handles a slow/failed upstream deterministically"        | timeout/abort config, error-path logging (must never include source text or API key), retry/no-retry contract         | integration (mocked upstream at the network edge)                 | over-mocking so deep the timeout/error path itself is never exercised                                   |
| #6   | When an account/session status check errors or is ambiguous, access is denied, not granted                                                                      | "The DB call will basically always succeed" ≠ "what happens on a transient error"      | middleware's status-check code path, what "unknown state" currently resolves to                                       | integration (middleware test with simulated DB error)             | testing only the success path of the status check                                                       |
| #7   | Repeated/rapid AI-generation or bulk requests are bounded (size caps, no unbounded loops) rather than silently degrading cost or availability                   | "No one will call this in a loop" ≠ "nothing stops them"                               | which endpoints already cap input size vs. which don't, current bulk-array limits                                     | integration (API route with oversized/repeated input)             | testing only a single well-formed request                                                               |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                             | Goal (one line)                                                                                                                         | Risks covered     | Test types         | Status      | Change folder                                     |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------ | ----------- | ------------------------------------------------- |
| 1   | Critical-path coverage & floor         | Bootstrap Vitest; defend the highest impact×likelihood scenarios (session scheduling, CRUD edge cases, save-loss) at the cheapest layer | #1, #2, #3        | unit + integration | complete    | `context/changes/testing-critical-path-coverage/` |
| 2   | Authorization & integration boundaries | Cover cross-user access, AI-call failure handling, and cost/rate bounds; one thin e2e smoke of the north-star flow                      | #4, #5, #7        | integration + e2e  | not started | —                                                 |
| 3   | Quality-gates wiring                   | Wire lint/typecheck/unit+integration into CI as required gates; add a fail-open regression test                                         | #6, cross-cutting | gates              | not started | —                                                 |

**Status vocabulary** (fixed): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

| Layer                | Tool                                 | Version                                                                                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit + integration   | Vitest                               | latest (via `astro/config`'s `getViteConfig()`)                                                                       | Astro v6 requires `environment: 'node'` for tests that render Astro components (breaking change from v5); confirmed via Context7, checked 2026-08-02                                                                                                                                                                                                                                         |
| API route testing    | Astro experimental Container API     | bundled with Astro 6.3.1                                                                                              | `container.renderToResponse(Endpoint, { routeType: "endpoint", request })` exercises `src/pages/api/**` handlers directly without a running server — the natural fit for risks #2–#7, all of which live in API route logic; confirmed via Context7, checked 2026-08-02                                                                                                                       |
| API mocking          | native `fetch` mock / MSW            | n/a — see Phase 1                                                                                                     | mock only the OpenRouter network edge for risk #5/#7; never mock internal modules                                                                                                                                                                                                                                                                                                            |
| e2e                  | Playwright                           | v1.61.0 (current, confirmed via Context7)                                                                             | one critical-flow smoke only (paste → generate → accept → save) per Phase 2; checked 2026-08-02                                                                                                                                                                                                                                                                                              |
| component testing    | React Testing Library + jsdom        | `@testing-library/react` ^16.3.2, `@testing-library/dom` ^10.4.1, `@testing-library/jest-dom` ^7.0.0, `jsdom` ^30.0.1 | Added mid-rollout — not anticipated at the 2026-08-02 `--refresh`; needed for the one client-side race in risk #2 (`CardListPanel`). Scoped per-file via a `// @vitest-environment jsdom` docblock rather than the global Vitest config, since every other test in this suite needs `environment: "node"` (Astro v6's Container API requirement); confirmed via Context7, checked 2026-08-03 |
| accessibility        | none yet — not in scope this rollout | n/a                                                                                                                   | not raised by any top-7 risk; UI polish is explicit negative space (§7)                                                                                                                                                                                                                                                                                                                      |
| (optional) AI-native | not included this rollout            | n/a                                                                                                                   | classic deterministic tests cover every identified risk more cheaply; card-quality (75% acceptance) is a post-launch product metric, not a CI gate — re-evaluate via `--refresh` if that changes                                                                                                                                                                                             |

**Stack grounding tools (current session):**

- Docs: Context7 — queried Astro (Vitest/Container API setup) and Playwright (currency check); checked: 2026-08-02
- Search: Exa.ai — available, not queried (Context7 answers were sufficient and higher-authority for this stack question); checked: 2026-08-02
- Runtime/browser: none available this session — not used
- Provider/platform: none available this session (no GitHub/Supabase/Cloudflare MCP) — not used

## 5. Quality Gates

| Gate                 | Where                | Required?                                             | Catches                                                                                                                   |
| -------------------- | -------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| lint + typecheck     | local + CI           | required (already wired — `.github/workflows/ci.yml`) | syntactic / type drift                                                                                                    |
| unit + integration   | local + CI           | required after §3 Phase 1                             | logic regressions (currently: no test step exists in CI at all)                                                           |
| e2e on critical flow | CI on PR             | required after §3 Phase 2                             | broken north-star user path                                                                                               |
| post-edit hook       | local (agent loop)   | recommended after §3 Phase 3                          | regressions at edit time — configuration is a later lesson (Module 3 Lesson 3), not this rollout                          |
| pre-prod smoke       | between merge + prod | optional                                              | environment-specific failures (relevant given CI never ran before the `deployment` change — branch-name mismatch history) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

Pattern: FSRS transition logic (`tests/unit/fsrs.test.ts`).

- Freeze time with `vi.useFakeTimers()` + `vi.setSystemTime(now)` before
  calling `scheduler.next(card, now, grade)` — FSRS transitions are
  time-dependent, so an unfrozen `now` makes the test flaky and the
  oracle ambiguous. Restore real timers in `afterEach`
  (`vi.useRealTimers()`) so fake time doesn't leak into later tests in
  the same file.
- Build the starting `Card` from the DB's actual "brand-new row" shape
  (`toFsrsCard()` over the same defaults the `cards` table's migration
  gives a new row), not from `ts-fsrs`'s own `createEmptyCard()` — the
  oracle is "what a brand-new card looks like in this app's schema,"
  not "whatever the library's fixture happens to return."
- To prove a deliberate scheduler-config override (e.g. this app's
  `enable_short_term: false` in `src/lib/fsrs.ts`) is a real effect and
  not a fixture coincidence, instantiate a second scheduler with the
  library's own default inside the _same_ test and assert it reproduces
  the documented default behavior (confirmed via Context7 reference
  test) while the app's scheduler diverges. A single scheduler's output
  alone can't distinguish "the override worked" from "the override
  doesn't matter for this input."

### 6.2 Adding an integration test for an API route

Pattern: Astro Container API + real local Supabase + cookie-replay auth
(`tests/integration/review.test.ts`, `deck-delete.test.ts`,
`cards-crud.test.ts`, `cards-batch-insert.test.ts`).

- Get a real authenticated user via `tests/helpers/test-auth.ts`:
  `createTestUser()` (admin API against the local instance), then
  `getAuthenticatedRequestInit(user)`, which signs in through the app's
  own `createClient()` wrapper against an in-memory cookie-jar double
  and returns the real chunked `@supabase/ssr` cookies it wrote. Replay
  that cookie header verbatim as the `Cookie` header on the test
  `Request`.
- Pass `locals: { user }` _and_ the replayed `Cookie` header on every
  request — the route's own `context.locals.user` gate reads `locals`,
  but RLS enforcement follows the cookie's session, not the injected
  `locals.user`. Setting one without the other produces a false-positive
  ownership test (see plan.md's "Test auth contract" section for why).
  `tests/integration/auth-contract.test.ts` is the throwaway proof that
  this actually holds: a second seeded user's replayed cookie cannot see
  the first user's deck.
- Call the handler directly:
  `container.renderToResponse(RouteModule, { routeType: "endpoint",
request, params, locals })` — no running server, no HTTP client,
  exercises the real route module.
- Seed fixture rows through a Supabase client built from the same
  replayed cookie (`createClient(new Headers({ Cookie: cookieHeader }),
noopCookies)`), not through the API under test — fixture setup must
  not depend on the code being tested.
- Clean up with `deleteTestUser(userId)` in `afterAll` — it
  cascade-deletes that user's decks/cards via the service-role admin
  client, not a global table truncate, so parallel test files don't
  collide.
- `vitest.config.ts` wraps `getViteConfig()` with `environment: "node"`
  and `pool: "vmThreads"` — required for anything touching Astro's
  rendering pipeline (Astro v6 breaking change from v5).

### 6.3 Adding a component test

Pattern: React Testing Library + jsdom, fetch mocked
(`tests/components/card-list-panel.test.tsx`).

- Add a `// @vitest-environment jsdom` docblock as the _first_ line of
  the test file — this scopes jsdom to that file only. Do not flip
  `vitest.config.ts`'s global `environment` to `jsdom`; every other test
  in this suite (FSRS unit tests, Container API integration tests) needs
  `"node"`, which Astro v6 requires for anything touching its rendering
  pipeline.
- Mock `fetch` with `vi.stubGlobal("fetch", vi.fn(...))`, not MSW — MSW
  is reserved for the external AI-call edge (§4); a native mock is
  cheaper and sufficient for same-origin API routes. Call
  `vi.unstubAllGlobals()` in `afterEach`.
- To test a race, don't resolve every mocked response immediately: build
  a `deferred<T>()` helper (a `Promise` plus its exposed `resolve`) for
  the one call whose timing matters, let the UI proceed past that
  in-flight request, trigger the second interaction, then resolve the
  first promise and assert the second interaction's UI state was never
  clobbered.
- `test.globals: true` in `vitest.config.ts` auto-registers React
  Testing Library's `afterEach` cleanup — no manual import needed.

### 6.4 Adding an e2e test

- TBD — see §3 Phase 2 (north-star flow smoke).

### 6.5 Adding a cross-user authorization test

- TBD — see §3 Phase 2 (two-user fixture pattern for risk #4).

### 6.6 Per-rollout-phase notes

**Phase 1 (bootstrap):** Tools added — Vitest (`getViteConfig()`
wrapper, `environment: "node"`, `pool: "vmThreads"`),
`@testing-library/react` + `@testing-library/dom` +
`@testing-library/jest-dom` + `jsdom` (component layer, added
mid-rollout — see §4), local Supabase CLI wired into CI
(`supabase/setup-cli@v1` + `supabase start` + `supabase status -o env`
piped into `$GITHUB_ENV`, ahead of `npm test`). The auth-contract
throwaway test (`tests/integration/auth-contract.test.ts`) proved the
replayed-cookie session actually scopes RLS before any risk-specific
test depended on it.

**Phase 2 (FSRS unit):** Confirmed `enable_short_term: false`
(`src/lib/fsrs.ts`) as a deliberate, final override, not a stale value —
this app has no same-session card-reserve mechanism, so minute-scale
learning steps would strand a missed new card until the user's next
unrelated visit. Re-evaluate only via `/10x-frame` + `/10x-plan` if that
constraint changes, never as a byproduct of test authoring.

**Phase 3 (FSRS integration):** No bugs found — `review.ts`'s GET/POST
round trip already persisted FSRS-correct state against a real deck.

**Phase 4 (CRUD edge cases, server):** Bugs fixed —
`src/pages/api/decks/[id]/delete.ts` reported success on a
nonexistent/foreign deck id (no row-count check) and lacked its own
`context.locals.user` gate that every sibling route already had; both
fixed. `src/pages/api/decks/[id]/review.ts`'s `.update()` checked
existence with `.eq("id", cardId).eq("deck_id", id)` but updated with
`.eq("id", cardId)` alone — a check-then-act filter mismatch, closed by
adding the matching `.eq("deck_id", id)` to the update.

**Phase 5 (client-side race, `CardListPanel`):** Bug fixed —
`confirmDelete`'s page-back decision computed `remainingOnPage` from a
`cards` state closure captured before the awaited delete fetch resolved.
Fixed by comparing `cards.length` against a tracked
`cardsLengthAtLastCheck` state value during render and calling `setPage`
directly in the render body when it drops to 0 — React's "adjust state
during render" pattern — rather than the `setCards` functional-updater
approach originally planned, to avoid the `react-hooks/set-state-in-effect`
lint rule. Reads `cards`/`total`/`page` as they exist in the current
commit, so the page-back decision can't act on a stale pre-fetch snapshot.

**Phase 6 (save-loss):** No bugs found — the AI-batch insert
(`cards.ts`) is genuinely atomic (a single PostgREST `.insert(rows)`
statement rejects entirely on a constraint violation), and
`review-reset.ts`'s `{ restored, total }` partial-failure contract
already reports correctly under a forced mid-sequence failure. Real
infra can't easily be forced to fail mid-loop, so this is the one case
in this rollout tested with a hermetic stubbed Supabase client
(`tests/unit/review-reset.test.ts`, module-mocked via `vi.mock("@/lib/supabase")`)
rather than integration, per the Risk Response Guidance for risk #3 in
§2.

## 7. What We Deliberately Don't Test

- **UI polish / visual details** — explicit negative space (Phase 2
  interview Q5): high churn, low blast radius, breaks constantly under
  snapshot testing and catches little. Re-evaluate if a "polish" change
  reintroduces a functional regression again (it already has once, per
  the `ui-polish` change's impl-review). (Source: Phase 2 interview Q5.)
- **Deployment/ops runbook steps** (manual secret rotation, `pg_cron`
  scheduling) — these are one-off infra procedures, not application
  behavior; not addressed by this rollout. (Source: Phase 2 interview,
  considered and not selected as the primary Q5 answer, but consistent
  with it.)
- **AI-generated card quality / 75% acceptance rate** — a post-launch
  product metric requiring real user judgment, not a deterministic test
  target. Re-evaluate if an AI-native evaluation layer is added via
  `--refresh`.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-02
- Stack versions last verified: 2026-08-02
- AI-native tool references last verified: n/a — no AI-native tools in this rollout

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
