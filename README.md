# 10xFiszki

10xFiszki is an AI-powered flashcard application. Paste a block of text, let AI turn
it into ready-to-use flashcards, review and edit them, then learn them using a
spaced-repetition schedule.

## Core user flow

1. **Paste text** — sign in and paste the source material you want to study.
2. **AI generates flashcards** — the app calls an LLM to extract front/back flashcard
   pairs from that text.
3. **Review & edit** — accept, edit, or discard the generated cards, or add cards
   manually, before they're saved to a deck.
4. **Study with spaced repetition** — review saved cards on a schedule driven by the
   [FSRS](https://github.com/open-spaced-repetition/fsrs4anki) algorithm.

## Main capabilities

- **Authentication** — email/password sign-up and sign-in via Supabase Auth; access to
  decks and cards is tied to the signed-in user.
- **Decks & cards management** — create, view, edit, and delete decks and cards.
- **AI flashcard generation** — generate flashcard candidates from pasted text.
- **Spaced repetition** — FSRS-based scheduling for reviewing saved cards.

## Tech Stack

- [Astro](https://astro.build/) v6 - Server-first web framework (SSR)
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and Postgres database
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) - Spaced-repetition scheduling
- [OpenRouter](https://openrouter.ai/) - LLM access for AI flashcard generation
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Set up Supabase and configure environment variables — see
   [Supabase Configuration](#supabase-configuration) below.

3. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

4. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run test` - Run unit/integration tests (Vitest)
- `npm run test:watch` - Run Vitest in watch mode
- `npm run db:types` - Regenerate Supabase TypeScript types

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ ├── lib/ # Business logic (AI generation, FSRS, Supabase client)
│ └── assets/ # Static assets
├── public/ # Public assets
├── supabase/ # Supabase migrations
├── tests/ # Unit, integration, and e2e tests
├── context/ # Project foundation docs (PRD, tech stack, test plan, roadmap)
├── wrangler.jsonc # Cloudflare Workers config
```

## Environment variables

Environment variables are declared via Astro's `astro:env` schema (see
`astro.config.mjs`) and are treated as **server-only secrets** — they are never exposed
to the client. Required variables (see `.env.example` for the file to copy, and
[Supabase Configuration](#supabase-configuration) below for where to get real values):

| Variable              | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `SUPABASE_URL`          | Supabase project URL                       |
| `SUPABASE_KEY`          | Supabase `anon` public key                 |
| `OPENROUTER_API_KEY`    | OpenRouter API key used for AI flashcard generation |

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication and as its
Postgres database (decks, cards).

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder, or
   applies the existing migrations in `supabase/migrations/`):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`, and add
   your own OpenRouter API key:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
OPENROUTER_API_KEY=<your OpenRouter API key>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and
`.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this
during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ------------------------------------------------------------------------|
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Protected page (redirects to `/auth/signin` if unauthenticated)         |

Route protection is handled in `src/middleware.ts`. `PROTECTED_ROUTES` there is the
single source of truth for which paths require authentication.

## Testing

- Unit and integration tests (Vitest) live under `tests/unit` and `tests/integration`:

```bash
npm run test
```

- End-to-end tests (Playwright) live under `tests/e2e`:

```bash
npx playwright test
```

See `context/foundation/test-plan.md` for the risks these tests are meant to cover.

## Product requirements

For the full product requirements — problem statement, personas, functional and
non-functional requirements, and scope — see
[`context/foundation/prd.md`](./context/foundation/prd.md).

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` as secrets in your
Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs lint + build on every push and PR to `master`. Configure
`SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` as repository secrets in
GitHub for the build step.

## License

MIT
