import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { AstroCookies } from "astro";
import { createClient } from "@/lib/supabase";
import type { Database } from "@/db/database.types";

function requireLocalSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_URL is not set. Run `supabase start` and populate .env.test.local (see .env.test.local).",
    );
  }
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(
      `Refusing to run test fixtures against a non-local Supabase instance (SUPABASE_URL="${url}"). ` +
        "Tests must only ever target the local Supabase CLI instance.",
    );
  }
  return url;
}

function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. See .env.test.local / the CI wiring in .github/workflows/ci.yml.",
    );
  }
  return key;
}

function getAdminClient(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(requireLocalSupabaseUrl(), requireServiceRoleKey());
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

let userSeq = 0;

/** Creates a real, confirmed user in the local Supabase instance via the admin API. */
export async function createTestUser(): Promise<TestUser> {
  userSeq += 1;
  const email = `test-user-${Date.now()}-${userSeq}@example.test`;
  const password = "test-password-123!";

  const { data, error } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`Failed to create test user: ${error.message}`);
  }

  return { id: data.user.id, email, password };
}

/** Cascade-deletes this user's decks/cards (FK `on delete cascade`) and the auth user itself. */
export async function deleteTestUser(userId: string): Promise<void> {
  const { error } = await getAdminClient().auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Failed to delete test user ${userId}: ${error.message}`);
  }
}

export interface AuthenticatedRequestInit {
  locals: { user: User };
  cookieHeader: string;
}

/**
 * Signs in through the app's own `createClient()` wrapper against an in-memory
 * cookie-jar double, capturing whatever chunked cookies `@supabase/ssr` writes,
 * so they can be replayed verbatim as the `Cookie` header on a real test request.
 * `locals.user` and the replayed cookie's session both reference the same user —
 * required so RLS (which follows the cookie) and the route's own `locals.user`
 * gate agree, per plan.md's "Test auth contract" section.
 */
export async function getAuthenticatedRequestInit(user: TestUser): Promise<AuthenticatedRequestInit> {
  const cookieJar = new Map<string, string>();
  const cookieJarDouble = {
    set(name: string, value: string) {
      cookieJar.set(name, value);
    },
  } as unknown as AstroCookies;

  const client = createClient(new Headers(), cookieJarDouble);
  if (!client) {
    throw new Error("createClient() returned null - SUPABASE_URL/SUPABASE_KEY are missing in the test environment.");
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) {
    throw new Error(`Failed to sign in test user ${user.email}: ${error.message}`);
  }

  const cookieHeader = Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  return { locals: { user: data.user }, cookieHeader };
}
