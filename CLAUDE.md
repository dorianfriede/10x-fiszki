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

## 10xDevs AI Toolkit - Module 2, Lesson 5

Scale the single-change cycle into parallel work with **worktrees, goal-directed delegation, and multi-session orchestration**:

```
worktree per change -> /goal or claude -p -> PR -> review -> merge
```

The lesson focus is safe throughput: isolated contexts, choosing the right execution mode, and capping parallelism at review capacity.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code isolation** | |
| `git worktree add` | You need a separate working directory for a parallel change. One change per worktree, one fresh agent context per worktree. |
| **Complex changes** | |
| `/10x-implement <change-id> phase <n>` | The change has multiple phases, needs manual gates, or benefits from interactive decision-making during execution. |
| **Simple changes** | |
| `/goal` | You have a clear, bounded task and want goal-directed delegation. The agent works autonomously toward the stated goal with a stop condition. |
| `claude -p` | You want headless execution for a well-defined task. The Ralph Wiggum loop (run, check, retry) is the universal autonomous pattern. |
| **Multi-session orchestration** | |
| Superset / Conductor / Antigravity / VS Code Agent View | You are running multiple agent sessions in parallel and need visibility, coordination, or session management across them. |

### Parallel work rules

- One change per worktree or isolated workspace. One fresh agent context per change.
- Choose interactive `/10x-implement` for complex changes, `/goal` or `claude -p` for simple ones.
- Parallelism is capped by review capacity. More agents without review means more unreviewed code, not higher throughput.
- The quality pain from faster shipping is intentional — it bridges into Module 3 testing gates.

### Lesson boundaries

- Do not reteach interactive `/10x-implement` or `/10x-impl-review`; those are Lessons 2 and 3.
- Do not introduce testing strategy here. The quality pain is the motivation for Module 3.
- Worktrees are a mechanism for isolation, not the topic of a full git tutorial.

### Paths used by this lesson

- `context/changes/<change-id>/` - active change folder
- `context/changes/<change-id>/plan.md` - implementation input for any execution mode

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
