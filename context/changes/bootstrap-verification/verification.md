---
bootstrapped_at: 2026-05-23T21:24:28Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-fiszki
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-fiszki
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

10xFiszki is a solo-built web app with email+password auth, AI flashcard generation from pasted text, and a third-party SRS review loop — all in 3 weeks of after-hours work. The 10x-astro-starter is the recommended default for (web-app, js) and the fit is strong on three counts: Supabase delivers auth and Postgres out of the box, removing two of the hardest bootstrapping problems from a tight timeline; TypeScript end-to-end passes all four agent-friendly gates, which matters for solo builds where the agent is a first-class contributor; and Cloudflare Pages/Workers edge deployment is the right shape for server-side AI API calls — low cold-start penalty, global distribution, streaming-friendly. The AI generation feature (FR-007) is a server-side HTTP call to an external AI service, which Astro API routes handle natively. GitHub Actions with auto-deploy-on-merge fits a solo after-hours shipping cadence.

## Pre-scaffold verification

| Signal      | Value                                                         | Severity | Notes                                          |
| ----------- | ------------------------------------------------------------- | -------- | ---------------------------------------------- |
| npm package | not run                                                       | —        | cmd_template starts with `git clone`; npm step skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17    | fresh    | from card docs_url; within 3 months            |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo, upstream .git deleted before merge)
**Exit code**: 0
**Files moved**: 20 (13 files + 7 directories)
**Conflicts (.scaffold siblings)**: CLAUDE.md (became CLAUDE.md.scaffold — cwd course instructions preserved)
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 (direct: wrangler, @astrojs/check are the 2 direct MODERATE; 1 HIGH and 7 MODERATE are transitive)

#### CRITICAL findings

None.

#### HIGH findings

**devalue** v5.6.3–5.8.0 — GHSA-77vg-94rm-hx3p — DoS via sparse array deserialization (CVSS 7.5 / AV:N/AC:L/PR:N/UI:N). CWE-770. Transitive (not a direct dependency). Fix available: upgrade devalue to >5.8.0.

#### MODERATE findings

**ws** v8.0.0–8.20.0 — GHSA-58qx-3vcg-4xpx — Uninitialized memory disclosure (CVSS 4.4 / AV:N/AC:H/PR:H/UI:N). CWE-908. Transitive via miniflare and @supabase/realtime-js. Fix available: upgrade ws to >=8.20.1.

**yaml** v2.0.0–2.8.2 — GHSA-48c2-rrv3-qjmp — Stack overflow via deeply nested YAML collections (CVSS 4.3 / AV:N/AC:L/PR:L/UI:N). CWE-674. Transitive via yaml-language-server → volar-service-yaml → @astrojs/language-server. Fix available: upgrade @astrojs/check to 0.9.2 (semver major).

**wrangler** (direct) — transitive via miniflare → ws. Fix available.

**@astrojs/check** (direct) — transitive via @astrojs/language-server → volar-service-yaml → yaml. Fix available: downgrade to 0.9.2 (semver major).

**miniflare**, **@cloudflare/vite-plugin**, **@astrojs/language-server**, **volar-service-yaml**, **yaml-language-server** — all transitive, all cascade from ws or yaml chains above. Fix available via upstream package updates.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review `CLAUDE.md.scaffold` (the starter's agent instructions) and decide which lines to merge into the project `CLAUDE.md`.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The HIGH finding (devalue) and the ws moderate are the only direct-action candidates; the rest are dev-tooling chains that do not ship to production.
