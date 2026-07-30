# CLAUDE.md

## Commands

See `@README.md` (Available Scripts). No test framework is configured yet.

## Architecture

**10xFiszki** is an AI-powered flashcard generator. Users paste text and AI generates flashcards from it.

- **Astro v6** runs in SSR mode (`output: "server"`) — all routes are server-rendered by default
- TypeScript path alias: `@/*` → `./src/*`

### Request flow

```
Browser → Astro middleware (populates Astro.locals.user) → Page or API route
```

Middleware at `src/middleware.ts` runs on every request, checks the Supabase session cookie, and populates `context.locals.user`. `PROTECTED_ROUTES` in that file is the single source of truth for route protection.

### Auth form pattern

Forms POST to API routes (not `fetch`) to avoid CORS and keep credentials server-side. API routes redirect on both success and error — errors are passed as encoded query params (`?error=...`), which the Astro page reads and forwards as props to the React form component.

```
SignInForm.tsx (React) → POST /api/auth/signin (Astro endpoint) → redirect → signin.astro reads ?error → passes to <SignInForm error={...} />
```

### Supabase client

Always create the client with the request context — never import a singleton. See `@src/lib/supabase.ts`.

`SUPABASE_URL` and `SUPABASE_KEY` are declared `context: "server"` in `astro.config.mjs` — they are not available in client-side code.

### Component conventions

- React components live in `src/components/`; form components are client-only (`client:load`)
- Use `cn()` from `@/lib/utils` for conditional Tailwind class merging
- Button variants are defined with CVA in `src/components/ui/button.tsx` — extend there, don't add inline variant logic elsewhere
- `FormField` wraps inputs with icon, error, and hint layout — use it instead of raw `<input>`

## CI

See `@.github/workflows/ci.yml`. Pre-commit hook runs `lint-staged`: ESLint on `.ts/.tsx/.astro`, Prettier on `.json/.css/.md`.

## Lessons learned

Check: `context/foundation/lessons.md` and if the file do not exist skip it.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
