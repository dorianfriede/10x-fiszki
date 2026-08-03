import { experimental_AstroContainer } from "astro/container";
import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as DeleteRoute from "@/pages/api/decks/[id]/delete";
import { createClient } from "@/lib/supabase";
import type { Database, Tables } from "@/db/database.types";
import { createTestUser, deleteTestUser, getAuthenticatedRequestInit, type TestUser } from "../helpers/test-auth";

let deckSeq = 0;
function uniqueDeckName(prefix: string): string {
  deckSeq += 1;
  return `${prefix}-${deckSeq}`;
}

async function insertDeck(client: SupabaseClient<Database>, userId: string, name: string): Promise<Tables<"decks">> {
  const { data, error } = await client.from("decks").insert({ user_id: userId, name }).select().single();
  if (error) {
    throw new Error(`Failed to insert fixture deck "${name}": ${error.message}`);
  }
  return data;
}

function decodeLocationError(location: string | null): string | null {
  if (!location) return null;
  const url = new URL(location, "http://localhost");
  return url.searchParams.get("error");
}

// No-op cookie jar, matching tests/integration/auth-contract.test.ts: this
// client only ever reads the session from the replayed `Cookie` header.
const noopCookies = { set: () => undefined } as unknown as AstroCookies;

describe("delete.ts POST integration", () => {
  let userA: TestUser;
  let userB: TestUser;
  let cookieHeaderA: string;
  let authedClientA: SupabaseClient<Database>;
  let container: experimental_AstroContainer;

  beforeAll(async () => {
    userA = await createTestUser();
    userB = await createTestUser();
    const authA = await getAuthenticatedRequestInit(userA);
    cookieHeaderA = authA.cookieHeader;
    const client = createClient(new Headers({ Cookie: cookieHeaderA }), noopCookies);
    if (!client) throw new Error("createClient() returned null for the fixture-seeding client");
    authedClientA = client;
    container = await experimental_AstroContainer.create();
  });

  afterAll(async () => {
    // Each cleanup is isolated: if beforeAll threw before assigning one of
    // these, deleting the other must not be skipped.
    try {
      await deleteTestUser(userA.id);
    } catch {
      /* userA was never created */
    }
    try {
      await deleteTestUser(userB.id);
    } catch {
      /* userB was never created */
    }
  });

  it("deletes an owned deck and redirects to /decks with no error", async () => {
    const deck = await insertDeck(authedClientA, userA.id, uniqueDeckName("owned"));

    const response = await container.renderToResponse(DeleteRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${deck.id}/delete`, {
        method: "POST",
        headers: { Cookie: cookieHeaderA },
      }),
      params: { id: deck.id },
      locals: { user: userA, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(302);
    const location = response.headers.get("location");
    expect(location).toBe("/decks");

    const { data: stillThere } = await authedClientA.from("decks").select("id").eq("id", deck.id).maybeSingle();
    expect(stillThere).toBeNull();
  });

  it("does not report success when deleting a nonexistent deck id", async () => {
    const response = await container.renderToResponse(DeleteRoute, {
      routeType: "endpoint",
      request: new Request("http://localhost/api/decks/00000000-0000-0000-0000-000000000000/delete", {
        method: "POST",
        headers: { Cookie: cookieHeaderA },
      }),
      params: { id: "00000000-0000-0000-0000-000000000000" },
      locals: { user: userA, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(302);
    expect(decodeLocationError(response.headers.get("location"))).toBe("Deck not found");
  });

  it("does not report success when deleting another user's deck", async () => {
    const foreignDeck = await insertDeck(authedClientA, userA.id, uniqueDeckName("foreign"));

    const authB = await getAuthenticatedRequestInit(userB);

    const response = await container.renderToResponse(DeleteRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${foreignDeck.id}/delete`, {
        method: "POST",
        headers: { Cookie: authB.cookieHeader },
      }),
      params: { id: foreignDeck.id },
      locals: { user: userB, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(302);
    expect(decodeLocationError(response.headers.get("location"))).toBe("Deck not found");

    const { data: stillThere } = await authedClientA.from("decks").select("id").eq("id", foreignDeck.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  it("rejects an unauthenticated request", async () => {
    const deck = await insertDeck(authedClientA, userA.id, uniqueDeckName("unauth"));

    const response = await container.renderToResponse(DeleteRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${deck.id}/delete`, {
        method: "POST",
      }),
      params: { id: deck.id },
      locals: { user: null, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(302);
    expect(decodeLocationError(response.headers.get("location"))).toBe("Not authenticated");

    const { data: stillThere } = await authedClientA.from("decks").select("id").eq("id", deck.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });
});
