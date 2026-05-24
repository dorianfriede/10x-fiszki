---
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
---

## Why this stack

10xFiszki is a solo-built web app with email+password auth, AI flashcard generation from pasted text, and a third-party SRS review loop — all in 3 weeks of after-hours work. The 10x-astro-starter is the recommended default for (web-app, js) and the fit is strong on three counts: Supabase delivers auth and Postgres out of the box, removing two of the hardest bootstrapping problems from a tight timeline; TypeScript end-to-end passes all four agent-friendly gates, which matters for solo builds where the agent is a first-class contributor; and Cloudflare Pages/Workers edge deployment is the right shape for server-side AI API calls — low cold-start penalty, global distribution, streaming-friendly. The AI generation feature (FR-007) is a server-side HTTP call to an external AI service, which Astro API routes handle natively. GitHub Actions with auto-deploy-on-merge fits a solo after-hours shipping cadence.
