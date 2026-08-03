import type { AstroCookies } from "astro";
import { describe, expect, it } from "vitest";
import { createClient } from "@/lib/supabase";
import { createTestUser, deleteTestUser, getAuthenticatedRequestInit } from "../helpers/test-auth";

// No-op cookie jar: these clients only ever read the session from the replayed
// `Cookie` header, they never need to persist a new one.
const noopCookies = { set: () => undefined } as unknown as AstroCookies;

describe("Phase 1 auth contract: replayed cookie scopes RLS", () => {
  it("a seeded user's replayed cookie session cannot see a second user's deck", async () => {
    let userA: Awaited<ReturnType<typeof createTestUser>> | undefined;
    let userB: Awaited<ReturnType<typeof createTestUser>> | undefined;

    try {
      userA = await createTestUser();
      userB = await createTestUser();

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
      // Each cleanup is isolated: if creating userB threw, userA (already
      // created) must still be cleaned up, and vice versa.
      if (userA) await deleteTestUser(userA.id);
      if (userB) await deleteTestUser(userB.id);
    }
  });
});
