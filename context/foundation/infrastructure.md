---
project: 10x-fiszki
researched_at: 2026-07-14
recommended_platform: Cloudflare Workers
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro v6 (SSR, output: "server")
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only researched platform that passes all five agent-friendly criteria cleanly while also being the cheapest option at 10xFiszki's expected traffic (10k-100k requests/month sits entirely inside the 100k-requests/day free tier). The interview weighted cost-minimization as the top priority and ruled out no candidates on persistent-connection grounds (the app needs none), so the decision reduces to: which fully-passing platform costs the least and best matches the stack's existing rationale (edge distribution, low cold-start, streaming-friendly SSR) already recorded in `tech-stack.md`. **Correction to the existing hint**: `tech-stack.md` records `deployment_target: cloudflare-pages`, but Cloudflare has consolidated Pages into Workers — the `@astrojs/cloudflare` adapter no longer targets Pages for new projects. The actionable target is **Cloudflare Workers with static assets**, not Pages; this file supersedes that stale hint.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| Render | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| Vercel | Pass | Pass | Pass | Pass | Partial | 4 Pass, 1 Partial |
| Railway | Pass | Pass | Pass | Pass | Pass | 5 Pass (cost-penalized) |
| Netlify | Partial | Pass | Pass | Partial | Pass | 3 Pass, 2 Partial |
| Fly.io | Pass | Partial | Pass | Pass | Partial | 2 Pass, 3 Partial |

**Cloudflare Workers** — `wrangler deploy` / `wrangler rollback` / `wrangler tail` are all GA, non-interactive, and exit-code-stable. Docs are markdown-native (`Accept: text/markdown` on any page, plus per-product `llms.txt`/`llms-full.txt`) — genuinely agent-fetchable, not scraped HTML. Free tier (100k req/day) covers the full expected traffic range at $0/mo. Official `mcp-server-cloudflare` plus a hosted Workers-observability MCP endpoint give structured log/exception queries beyond what `wrangler tail` alone offers.

**Render** — Equally clean on all five criteria: mature CLI (v2.21, JSON output, non-interactive), official MCP server plus agent skills for Claude Code/Cursor/Codex, markdown docs with `llms.txt`. The gap versus Cloudflare is purely cost: the free tier cold-starts (30-60s) after 15 minutes idle, which is a real UX risk for a solo MVP with sporadic traffic; the Starter tier ($7/mo) removes that but stops being free.

**Vercel** — Strong CLI (`vercel deploy`, `vercel rollback`, `vercel logs`), markdown docs with `llms.txt`, free Hobby tier that comfortably covers 10k-100k req/mo. Loses points because Vercel MCP is still beta, and — more materially — the Hobby tier's terms of service restrict it to non-commercial use; 10xFiszki has no payments today (`has_payments: false`) but if that changes, a forced mid-project upgrade to Pro ($20/mo) is a real, foreseeable cost.

**Railway** — Scores as well as Cloudflare/Render on every criterion (official GA MCP server bundled into the CLI, GitHub-hosted docs, clean `railway up`/`logs`/`redeploy` flow) but has no free tier for new accounts; a minimal always-on Node service realistically costs $10-15/mo in compute even at low traffic, since Railway bills compute-time rather than requests. Given the explicit cost-minimization priority, this pushed Railway out of the top 3 despite otherwise matching the leaders.

**Netlify** — Adapter and docs are solid (markdown-native, `llms.txt`, official GA MCP server), but there is no CLI-native rollback command — reverting to a prior deploy is a dashboard "Publish deploy" click (or an API call an agent would have to hand-roll). That's a direct gap against the CLI-first and stable-deploy-API criteria, since "an agent cannot click."

**Fly.io** — Persistent-process support is the best of the six (irrelevant here, since Q1 confirmed no such requirement), but it's the weakest on managed/serverless: a Dockerfile is mandatory, there's no zero-config runtime path, and the MCP server is explicitly experimental. No free tier remains since Fly removed it in 2024; realistic cost is $2-25/mo depending on scale-to-zero configuration — not prohibitive, but strictly worse than Cloudflare/Render/Vercel's genuine $0 floor at this traffic.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on cost (genuinely free at expected traffic, resets daily rather than monthly), on docs (best-in-class agent-readability), and on MCP tooling (official server plus a dedicated observability MCP). It also continues the original stack rationale in `tech-stack.md` — edge distribution and streaming-friendly SSR — rather than reversing it. The corrected target is Workers, not the Pages hint currently recorded.

#### 2. Render

The strongest fallback: identical criteria scores to Cloudflare, a plain Node.js runtime (no `workerd` compatibility-shim risk), and an official MCP server with agent-specific skills. Costs $7/mo for the no-cold-start Starter tier, or is free with a cold-start UX tradeoff.

#### 3. Vercel

Comparable CLI/docs/rollback story to the leaders, free Hobby tier that covers current traffic. Held back by beta MCP status and the Hobby ToS's non-commercial restriction, which is a latent risk if 10xFiszki ever adds payments.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Runtime is `workerd`, not Node** — even with `nodejs_compat` enabled, this is a compatibility shim, not real Node.js. Some npm packages that rely on native `fs`, certain crypto primitives, or other Node-only behavior can fail in subtle ways that only surface in production, not local dev, since `wrangler dev` also runs `workerd`.
2. **CPU-time billing, not wall-clock** — the free tier's 10ms CPU/invocation cap is about *CPU* time, not request duration. An AI flashcard-generation endpoint that does non-trivial parsing/JSON work server-side (not just proxying to OpenRouter) could exceed the free CPU budget before the request-count free tier is exhausted, forcing an unplanned upgrade to the $5/mo Bundled plan.
3. **Migration debt already exists** — Astro's own docs and the `@astrojs/cloudflare` adapter recently dropped Pages support. Most indexed tutorials, Stack Overflow answers, and AI-generated boilerplate still reference "Cloudflare Pages + Astro," which is now stale — expect contradictory guidance mid-build.
4. **Non-standard environment variable access** — Workers don't use `process.env`; secrets/vars are accessed through the `env` binding (`context.locals.runtime.env` in Astro middleware, or `astro:env`). Supabase client init code copy-pasted from generic tutorials assuming `process.env` will silently fail or throw at request time, not build time.
5. **Local/prod parity risk** — because `wrangler dev` simulates the edge runtime, some bugs unique to `workerd`'s fetch/TLS behavior toward external APIs (Supabase, OpenRouter) may not reproduce identically to the real Workers edge network, especially around outbound connection reuse/timeouts under load.

### Pre-Mortem — How This Could Fail

Six months in, 10xFiszki is unusable for a chunk of users and the solo developer is debugging blind. The root cause: the AI flashcard-generation endpoint occasionally times out under real traffic because a Supabase query plus an OpenRouter round-trip pushed past CPU-time limits on the paid tier, and the errors only appeared in `wrangler tail` as opaque "exceeded resource limits" messages with no stack trace pointing at the actual slow call. Because early local testing used `wrangler dev` with fast mocked responses, this never surfaced pre-launch. Meanwhile, half the AI-generated code scaffolded during development referenced deprecated Cloudflare Pages patterns (Functions directory, Pages-specific env access) copied from stale tutorials, requiring a mid-project rewrite of the deployment config. The team assumed "serverless everywhere" meant no operational surface to think about, and skipped load-testing the one part of the app that's actually CPU/latency-sensitive — the AI endpoint — until users started reporting silent failures.

### Unknown Unknowns

- Cloudflare's `nodejs_compat` flag is versioned by `compatibility_date` — pinning it too early can silently disable Node polyfills that Supabase's JS client depends on; pinning too late inherits breaking changes from newer compat-flag defaults. This isn't obvious until a dependency breaks.
- Streaming SSR responses (a stated fit reason for Cloudflare in `tech-stack.md`) require deliberate use of Astro's streaming APIs — if not opted into explicitly, Workers will buffer full responses anyway, quietly negating the "streaming-friendly" advantage the stack was chosen for.
- Outbound fetches to OpenRouter don't count fetch-wait time toward the CPU-time budget, but total wall-clock request duration is still capped (Workers requests generally time out around 30s), which can matter for longer LLM completions.
- `wrangler secret put` secrets are per-environment and must be re-set separately for `staging`/`production` if multiple environments exist in `wrangler.jsonc` — easy to forget, resulting in a working local Worker and a broken deployed one due to "missing" secrets.
- Cloudflare's free tier request count resets **daily** (100k/day), not monthly — a traffic spike on one day doesn't roll over unused headroom from quiet days, unlike most competitors' monthly quotas.

**User decision**: Proceed with Cloudflare Workers — risks noted and recorded in the risk register below.

## Operational Story

- **Preview deploys**: `wrangler versions upload` creates a preview version with its own URL without shifting production traffic; promote with `wrangler versions deploy`. No fork-PR restriction — any branch can be previewed as long as the deploying identity holds the account's API token.
- **Secrets**: Non-sensitive config lives in `wrangler.jsonc` `vars` (committed to the repo); sensitive values (Supabase service key, OpenRouter API key) are set via `wrangler secret put <NAME>` per environment and read through the `env` binding at request time. Only the account holder (or anyone with the scoped API token) can read/rotate secrets — rotation is a re-run of `wrangler secret put` with the new value, no redeploy required for the secret change itself to take effect on next invocation.
- **Rollback**: `wrangler rollback [<version-id>]` reverts to a prior deployed version in seconds; defaults to the immediately prior version if no ID is given. Caveat: this rolls back code, not data — any Supabase schema migration tied to the rolled-back version does not auto-revert and must be handled separately.
- **Approval**: Routine deploys (`wrangler deploy`) and rollbacks may run unattended by an agent using a scoped API token limited to this Worker. Human-only: rotating the primary Cloudflare API token itself, changing billing tier, and any Supabase database-level destructive operation (schema drop, service-role key rotation).
- **Logs**: `wrangler tail --format json --status error` streams live runtime errors read-only; the official Workers-observability MCP server (`observability.mcp.cloudflare.com`) exposes structured log/exception queries as typed tools for an agent, avoiding CLI-output parsing for repeated diagnostic queries.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| AI-generation endpoint exceeds CPU-time budget under real load, causing opaque "resource limit" errors | Pre-Mortem | M | H | Load-test the flashcard-generation route specifically before launch; monitor CPU-ms via the observability MCP; budget for the $5/mo Bundled plan upgrade path in advance rather than reactively |
| Stale Cloudflare Pages-era tutorials/boilerplate produce dead-end code during implementation | Devil's advocate / Research finding | H | M | Confirm any AI-generated Cloudflare deployment code targets Workers + `wrangler.jsonc`, not a `functions/` directory or Pages-specific bindings, before merging |
| `process.env`-style code copy-pasted into Workers silently fails at request time | Devil's advocate | M | M | Standardize on `astro:env` or the `context.locals.runtime.env` binding from the first commit; add a lint note or code-review checklist item |
| `nodejs_compat` / `compatibility_date` mismatch breaks a Supabase-client dependency after a routine update | Unknown unknowns | L | M | Pin `compatibility_date` explicitly in `wrangler.jsonc`; bump deliberately and test, not implicitly on every deploy |
| Streaming SSR silently degrades to buffered responses because Astro's streaming APIs aren't explicitly used | Unknown unknowns | M | L | Verify streaming behavior in a production-like `wrangler dev` test before relying on it as a UX differentiator |
| Missing per-environment secret causes a working local build but broken production deploy | Unknown unknowns | M | M | Document required secrets in a checklist; verify with `wrangler secret list --env production` before each first deploy to a new environment |
| Daily (not monthly) free-tier reset means a single traffic spike can exhaust the day's free quota | Unknown unknowns | L | L | Monitor request volume via observability MCP; the $5/mo Bundled tier is a low-cost safety net if free-tier limits are hit |

## Getting Started

1. Confirm the adapter is installed and targets Workers (not Pages): `npx astro add cloudflare` — this writes `@astrojs/cloudflare` to `package.json` and scaffolds `wrangler.jsonc`.
2. In `wrangler.jsonc`, set `compatibility_flags: ["nodejs_compat"]` and pin an explicit `compatibility_date` (do not leave it to auto-update silently).
3. Move Supabase URL/key and OpenRouter API key access to `astro:env` or the `env` binding pattern — do not use `process.env` in any server-side route or middleware.
4. Set secrets per environment: `wrangler secret put SUPABASE_KEY` and `wrangler secret put OPENROUTER_API_KEY` (repeat for any `staging` environment defined in `wrangler.jsonc`).
5. Build and deploy: `npm run build && npx wrangler deploy`. Verify with `npx wrangler tail --format json` while exercising the flashcard-generation flow to confirm no CPU-time or env-binding errors before wiring this into the existing GitHub Actions auto-deploy-on-merge flow.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
