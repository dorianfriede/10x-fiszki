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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
