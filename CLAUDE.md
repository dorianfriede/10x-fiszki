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

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
