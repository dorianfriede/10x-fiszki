# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

See `@README.md` (Available Scripts). No test framework is configured yet.

## Architecture

**10xFiszki** is an AI-powered flashcard generator. Users paste text and AI generates flashcards from it.

- **Astro v6** runs in SSR mode (`output: "server"`) — all routes are server-rendered by default
- React components require a `client:load` directive to hydrate in the browser
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

Always create the client with the request context — never import a singleton:

```ts
import { createClient } from "@/lib/supabase";
const supabase = createClient(Astro.request.headers, Astro.cookies);
```

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
