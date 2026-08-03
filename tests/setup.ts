import "@testing-library/jest-dom/vitest";
import { loadEnv } from "vite";

// astro:env only exposes vars declared in astro.config.mjs's schema (app-facing).
// Test-only secrets like SUPABASE_SERVICE_ROLE_KEY live outside that schema, so
// tests read them from process.env directly; this loads .env.test.local (and
// .env) the same way CI's `$GITHUB_ENV` step does, without overriding any var a
// real shell/CI environment already set.
const testEnv = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
