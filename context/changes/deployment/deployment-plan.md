# Cloudflare Workers Integration & Deployment Plan — 10xFiszki

## Context

`context/foundation/infrastructure.md` already recommends Cloudflare Workers (not Pages) as the deployment target, and the codebase is further along than a typical "add Cloudflare" migration:

- `@astrojs/cloudflare` (v13.5.0) is already installed and configured as the adapter in `astro.config.mjs`.
- `wrangler.jsonc` already exists with the correct Workers-style config (`main: "@astrojs/cloudflare/entrypoints/server"`, `nodejs_compat`, assets binding, observability).
- Supabase env vars (`SUPABASE_URL`, `SUPABASE_KEY`) are already wired through Astro's typed `astro:env/server` module — no `process.env` usage anywhere in `src/`, so no remediation needed there.
- `.gitignore` already excludes `.dev.vars` and `.wrangler/`.

What's genuinely missing:
1. **No deploy automation** — CI (`.github/workflows/ci.yml`) only lints and builds; there's no deploy job, and no `deploy` npm script.
2. **No secrets configured on the live Worker** — `wrangler secret put` has (presumably) never been run against production.
3. **No verified first deploy** — nothing confirms the app actually runs on the Workers edge runtime today.

This plan wires up the missing piece: a scoped API token → GitHub secrets → first manual deploy → CI auto-deploy-on-merge → verification, plus documented edge-case/support steps for the risks already flagged in `infrastructure.md`'s risk register (CPU-time limits, `astro:env` pitfalls, stale Pages-era guidance, per-environment secret drift).

**Decisions confirmed with the user**: a Cloudflare account + API token already exist (skip account creation), and scope is **production auto-deploy-on-merge only** — no PR preview deploys in this pass (matches `tech-stack.md`'s `ci_default_flow: auto-deploy-on-merge`).

## Phase -1 — Prerequisites: configure the CLI and Supabase

Confirmed via local checks: `wrangler` (v4.90.0) and `supabase` (v2.98.2) CLIs are already installed as devDependencies (`npx wrangler --version` / `npx supabase --version` both resolve), but neither is authenticated yet — `npx wrangler whoami` currently returns "You are not authenticated," no `.env`/`.dev.vars` file exists locally, and `supabase/config.toml` only holds a local project scaffold (`project_id = "10x-astro-starter"`) with no linked hosted project. This phase must complete before Phase 0's token-scoping check makes sense.

### Wrangler (Cloudflare) CLI

- [x] **Interactive/local auth (for running deploys by hand from this machine)**: `npx wrangler login` — opens a browser OAuth flow and stores a token under the OS credential store. This is separate from the scoped API token used in CI (Phase 3) and is only for local human-run commands (`wrangler deploy`, `wrangler tail`, `wrangler rollback`). Confirmed via `npx wrangler whoami`: logged in with OAuth token, account `dorian.friede@softvig.pl`.
- [ ] **Scoped API token (for CI and for Phase 0's verification)**: Dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then narrow it: restrict to the specific account, and if the token UI allows per-script scoping, restrict to this Worker only (`10x-astro-starter` per `wrangler.jsonc`'s `name`). Do not grant DNS, billing, or unrelated-zone permissions — this is the token Phase 0 verifies and Phase 3 stores as `CLOUDFLARE_API_TOKEN`. **Not yet created** — the existing OAuth login is separate and not CI-usable.
- [ ] Export the token locally to test it before touching CI: `set CLOUDFLARE_API_TOKEN=<token>` (PowerShell: `$env:CLOUDFLARE_API_TOKEN="<token>"`), then `npx wrangler whoami` should resolve the token's account/permissions without needing `wrangler login`. This confirms the CI path will work identically, since GitHub Actions authenticates the same way (env var, not OAuth). Blocked on the scoped token above.
- [x] Note the **Account ID** while in the dashboard (Workers & Pages overview, right sidebar) — needed for `CLOUDFLARE_ACCOUNT_ID` in Phase 3. Confirmed: `8a284e39a1c95d589bffa0bf48197e14`.

### Supabase — hosted project required for production

Local `supabase start` (Docker-based, `http://127.0.0.1:54321`) is dev-only and unreachable from Cloudflare's edge network — production deploy needs a **hosted** Supabase project. Decide now whether local dev and production share one hosted project or use two (recommended: separate, so auth-flow testing locally never touches production user data):

- [ ] Authenticate the Supabase CLI: `npx supabase login` (opens a browser flow, stores a personal access token). **Not yet done on this machine** — `npx supabase projects list` currently fails with "Access token not provided."
- [x] Create the hosted project — either via the [dashboard](https://supabase.com/dashboard) (New Project) or CLI: `npx supabase projects create 10x-fiszki --org-id <org-id>` (get `<org-id>` from `npx supabase orgs list`). Choose a region close to expected users; note this has no bearing on Workers' edge distribution since Supabase itself is single-region. Confirmed: hosted project created via the dashboard.
- [ ] Fetch the production URL and anon key: dashboard → Settings → API (`Project URL` and `anon` `public` key), or `npx supabase projects api-keys --project-ref <project-ref>`.
- [ ] **Do not run `npx supabase link`** unless a future change actually needs schema migrations pushed via CLI — per `README.md`, this project uses only Supabase Auth's built-in `auth.users` table, no custom schema, so linking adds an unused step.
- [ ] Turn off **Authentication → Email → Confirm email** on the hosted project too (not just local), matching the README's local-dev guidance, so the Phase 2/Phase 5 manual sign-up/sign-in smoke tests don't stall waiting on a confirmation email.
- [ ] Populate local files from the hosted (or local, if reusing) values: `cp .env.example .dev.vars` and `cp .env.example .env`, then fill in `SUPABASE_URL`/`SUPABASE_KEY` in both — `.dev.vars` is what `npm run dev`'s `workerd` runtime reads (per `astro.config.mjs`'s `envField` schema), `.env` is a convenience fallback. Both are gitignored already.
- [ ] These same production values (not the local Docker ones) are what gets set via `wrangler secret put` in Phase 2 and stored as the `SUPABASE_URL`/`SUPABASE_KEY` GitHub Actions secrets already referenced by the existing CI build step (Phase 3 note: these secrets already exist per the plan's Phase 3 heading — verify they hold the *hosted* project's values, not local Docker placeholders, before this plan's Phase 4 CI deploy job runs).

## Phase 0 — Verify & scope the existing API token
- [ ] Confirm the existing Cloudflare API token is scoped minimally per `infrastructure.md`'s posture ("scoped, not master keys"): Workers Scripts:Edit permission, limited to this account, no DNS/billing/unrelated-project access. If the existing token is a broad/legacy token, create a new scoped one and retire the old one (dashboard → My Profile → API Tokens). **Still open** — only the local OAuth login exists so far, not a CI-usable scoped token (see Phase -1).
- [x] Locate the Cloudflare **Account ID** (dashboard right sidebar on the Workers overview page, or `npx wrangler whoami` if already logged in locally). Confirmed: `8a284e39a1c95d589bffa0bf48197e14`.
- [x] Run `npx wrangler whoami` locally to confirm the token/account resolves correctly before wiring it into CI. Confirmed: logged in with OAuth token, account `dorian.friede@softvig.pl`.

## Phase 1 — Local dev secrets
- [ ] Create `.dev.vars` locally (gitignored) from `.env.example`: `cp .env.example .dev.vars`, fill in real `SUPABASE_URL`/`SUPABASE_KEY`.
- [ ] Run `npm run dev` and confirm the app boots under the Cloudflare `workerd` runtime (not just `astro dev`'s default Node preview) — exercise sign-in/sign-up/sign-out end to end locally first, since these are the only routes that exist today.
- [ ] **Known edge case**: if `npm run dev` throws `"Fetch API cannot load: /"` during Vite dependency re-optimization, this matches an open, unresolved upstream report ([withastro/astro#16190](https://github.com/withastro/astro/issues/16190), Astro 6 + `@astrojs/cloudflare` + Supabase Auth, closed "not planned"). Workaround: delete `node_modules/.vite` and retry; if it recurs, it's a Vite cache/dep-optimization race specific to the Cloudflare adapter's dev runtime, not a code bug — do not spend time debugging app code first.

## Phase 2 — First manual deploy
- [ ] Set production secrets on the Worker (one-time, human-run — not yet in CI): `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`.
- [ ] Build and deploy manually: `npm run build && npx wrangler deploy`.
- [ ] Verify the deployed `*.workers.dev` URL loads, and manually exercise sign-in/sign-up/sign-out against it.
- [ ] Tail logs during that manual exercise: `npx wrangler tail --format json --status error` — confirm no `astro:env`-binding errors or CPU-limit warnings.
- [ ] Rehearse rollback once now, while low-stakes: `npx wrangler rollback` — confirm it reverts cleanly, so the command is known-good before it's ever needed during an incident.

## Phase 3 — Wire GitHub Actions secrets
- [ ] Add repository secrets (GitHub → Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (in addition to the existing `SUPABASE_URL`/`SUPABASE_KEY` already used by the build step).

## Phase 4 — Add the deploy job to CI
- [ ] Extend `.github/workflows/ci.yml` with a second job (not a separate workflow file) that `needs: ci` and only runs `if: github.event_name == 'push' && github.ref == 'refs/heads/master'` — so PRs never deploy, only merges to `master` do, and only after lint+build pass.
- [ ] Use `cloudflare/wrangler-action@v4` (current major version; matches the `wrangler@^4.90.0` devDependency already pinned in `package.json`) with `apiToken` and `accountId` sourced from the new secrets. Deploy command: build first (`npm run build`), then `wrangler deploy`.
- [ ] Do **not** push `SUPABASE_URL`/`SUPABASE_KEY` as Worker secrets from this job on every run — they're already set once via `wrangler secret put` in Phase 2 and don't need to be re-set per deploy (avoids putting secret values through CI logs/diffs unnecessarily). Confirm this by checking `npx wrangler secret list` shows both after Phase 2, and leave secret rotation as the human-only action `infrastructure.md` already specifies.

## Phase 5 — Post-CI verification
- [ ] Push a trivial no-op commit to `master` (or merge a small real PR) and confirm the new `deploy` job runs, succeeds, and the live URL reflects the change.
- [ ] Re-run the manual auth smoke test (sign-in/up/out) against production once more after the first CI-driven deploy specifically, to confirm parity with the Phase 2 manual deploy — the risk register in `infrastructure.md` flags local/prod parity risk (`workerd`'s fetch/TLS behavior toward Supabase may not reproduce identically between `wrangler dev` and the real edge network).

## Edge cases / support steps to document (not blocking, but keep visible)

- [ ] **`compatibility_date` discipline**: already pinned to `2026-05-08` in `wrangler.jsonc` — do not let this auto-advance; bump deliberately and re-test, per the risk register.
- [ ] **Per-environment secret drift**: if a `staging` environment is ever added to `wrangler.jsonc`, `wrangler secret put` must be re-run separately for it — secrets are not inherited across environments.
- [ ] **Future `OPENROUTER_API_KEY` (FR-007, not yet built)**: no AI/flashcard-generation endpoint exists in the code yet (confirmed via search — only 3 auth routes exist today). When it's built: extend the `env.schema` in `astro.config.mjs` alongside `SUPABASE_URL`/`SUPABASE_KEY`, add the var to `.env.example`/`.dev.vars`, and `wrangler secret put OPENROUTER_API_KEY` in production — never `process.env`. Also budget time to load-test that endpoint specifically against the free tier's CPU-time cap before launch (per the pre-mortem in `infrastructure.md`).
- [ ] **Optional hardening flag**: Cloudflare's official Astro guide lists `global_fetch_strictly_public` alongside `nodejs_compat` in `compatibility_flags` — it restricts outbound `fetch` to public addresses (SSRF hardening). Not currently set in `wrangler.jsonc`; worth adding once the AI endpoint makes outbound calls to OpenRouter, as defense-in-depth. Not required for the current auth-only surface.
- [ ] **Custom domain caveat (future)**: if a custom domain is added later (replacing the `*.workers.dev` subdomain), verify `@supabase/ssr`'s cookie handling isn't implicitly bound to the old domain — Supabase's own custom-domain guidance warns that auth cookies are domain-bound, so the frontend must consistently use whichever domain is canonical.
- [ ] **Daily (not monthly) free-tier reset**: already flagged in the risk register — monitor via `wrangler tail` or the observability MCP if traffic patterns become spiky.

## Verification (end-to-end)

0. `npx wrangler login` (or an exported `CLOUDFLARE_API_TOKEN`) and `npx supabase login` both authenticate successfully; a hosted Supabase project exists with URL/anon key in hand (Phase -1).
1. `npx wrangler whoami` resolves the correct account (Phase 0).
2. Local `npm run dev` + manual auth flow works under `workerd` (Phase 1).
3. Manual `wrangler deploy` succeeds; production URL serves the app; auth flow works live; `wrangler rollback` rehearsed successfully (Phase 2).
4. A push to `master` triggers the GitHub Actions `deploy` job automatically, and it succeeds only after `lint`+`build` pass (Phase 4).
5. Post-CI-deploy auth smoke test passes against the live URL (Phase 5).
