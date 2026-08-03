import type { AstroCookies } from "astro";
import { describe, expect, it } from "vitest";
import { createClient } from "@/lib/supabase";
import { createTestUser, deleteTestUser, getAuthenticatedRequestInit } from "../helpers/test-auth";

// No-op cookie jar: these clients only ever read the session from the replayed
// `Cookie` header, they never need to persist a new one.
const noopCookies = { set: () => undefined } as unknown as AstroCookies;

describe("Phase 1 auth contract: replayed cookie scopes RLS", () => {
  it("a seeded user's replayed cookie session cannot see a second user's deck", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();

    try {
      const authA = await getAuthenticatedRequestInit(userA);
      const clientA = createClient(new Headers({ Cookie: authA.cookieHeader }), noopCookies);
      if (!clientA) throw new Error("createClient() returned null for user A");

      const { data: deckA, error: insertError } = await clientA
        .from("decks")
        .insert({ user_id: userA.id, name: "User A private deck" })
        .select()
        .single();
      expect(insertError).toBeNull();
      expect(deckA).not.toBeNull();

      const authB = await getAuthenticatedRequestInit(userB);
      const clientB = createClient(new Headers({ Cookie: authB.cookieHeader }), noopCookies);
      if (!clientB) throw new Error("createClient() returned null for user B");

      const { data: seenByB, error: selectError } = await clientB
        .from("decks")
        .select("id")
        .eq("id", deckA?.id ?? "")
        .maybeSingle();

      expect(selectError).toBeNull();
      expect(seenByB).toBeNull();
    } finally {
      await deleteTestUser(userA.id);
      await deleteTestUser(userB.id);
    }
  });
});
