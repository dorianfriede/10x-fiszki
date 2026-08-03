import { experimental_AstroContainer } from "astro/container";
import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as CardRoute from "@/pages/api/decks/[id]/cards/[cardId]";
import * as CardsRoute from "@/pages/api/decks/[id]/cards";
import * as ReviewRoute from "@/pages/api/decks/[id]/review";
import { createClient } from "@/lib/supabase";
import type { Database, Tables } from "@/db/database.types";
import { createTestUser, deleteTestUser, getAuthenticatedRequestInit, type TestUser } from "../helpers/test-auth";

let deckSeq = 0;
function uniqueDeckName(prefix: string): string {
  deckSeq += 1;
  return `${prefix}-${deckSeq}`;
}

let cardSeq = 0;
function uniqueFrontBack(): { front: string; back: string } {
  cardSeq += 1;
  return { front: `crud-test front ${cardSeq}`, back: `crud-test back ${cardSeq}` };
}

async function insertDeck(client: SupabaseClient<Database>, userId: string, name: string): Promise<Tables<"decks">> {
  const { data, error } = await client.from("decks").insert({ user_id: userId, name }).select().single();
  if (error) {
    throw new Error(`Failed to insert fixture deck "${name}": ${error.message}`);
  }
  return data;
}

async function insertCard(
  client: SupabaseClient<Database>,
  deckId: string,
  overrides: { front?: string; back?: string } = {},
): Promise<Tables<"cards">> {
  const { front, back } = uniqueFrontBack();
  const { data, error } = await client
    .from("cards")
    .insert({ deck_id: deckId, front: overrides.front ?? front, back: overrides.back ?? back, source: "manual" })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert fixture card: ${error.message}`);
  }
  return data;
}

// No-op cookie jar, matching tests/integration/auth-contract.test.ts: this
// client only ever reads the session from the replayed `Cookie` header.
const noopCookies = { set: () => undefined } as unknown as AstroCookies;

describe("cards CRUD edge cases", () => {
  let user: TestUser;
  let cookieHeader: string;
  let authedClient: SupabaseClient<Database>;
  let container: experimental_AstroContainer;

  beforeAll(async () => {
    user = await createTestUser();
    const auth = await getAuthenticatedRequestInit(user);
    cookieHeader = auth.cookieHeader;
    const client = createClient(new Headers({ Cookie: cookieHeader }), noopCookies);
    if (!client) throw new Error("createClient() returned null for the fixture-seeding client");
    authedClient = client;
    container = await experimental_AstroContainer.create();
  });

  afterAll(async () => {
    // If beforeAll threw before assigning `user`, don't let a TypeError on
    // `user.id` mask the original failure.
    try {
      await deleteTestUser(user.id);
    } catch {
      /* user was never created */
    }
  });

  describe("cards/[cardId].ts PATCH/DELETE on a card outside the URL's deck", () => {
    it("PATCH returns 404 when the card belongs to a different deck than the URL's id", async () => {
      const deckA = await insertDeck(authedClient, user.id, uniqueDeckName("patch-a"));
      const deckB = await insertDeck(authedClient, user.id, uniqueDeckName("patch-b"));
      const cardInB = await insertCard(authedClient, deckB.id);

      const response = await container.renderToResponse(CardRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckA.id}/cards/${cardInB.id}`, {
          method: "PATCH",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ front: "irrelevant", back: "irrelevant" }),
        }),
        params: { id: deckA.id, cardId: cardInB.id },
        locals: { user, pendingDeletionRequestedAt: null },
      });

      expect(response.status).toBe(404);
    });

    it("DELETE returns 404 when the card belongs to a different deck than the URL's id", async () => {
      const deckA = await insertDeck(authedClient, user.id, uniqueDeckName("delete-a"));
      const deckB = await insertDeck(authedClient, user.id, uniqueDeckName("delete-b"));
      const cardInB = await insertCard(authedClient, deckB.id);

      const response = await container.renderToResponse(CardRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckA.id}/cards/${cardInB.id}`, {
          method: "DELETE",
          headers: { Cookie: cookieHeader },
        }),
        params: { id: deckA.id, cardId: cardInB.id },
        locals: { user, pendingDeletionRequestedAt: null },
      });

      expect(response.status).toBe(404);

      const { data: stillThere } = await authedClient.from("cards").select("id").eq("id", cardInB.id).maybeSingle();
      expect(stillThere).not.toBeNull();
    });
  });

  it("PATCH returns 409 when it would produce a duplicate front+back in the same deck", async () => {
    const deck = await insertDeck(authedClient, user.id, uniqueDeckName("duplicate"));
    const existing = await insertCard(authedClient, deck.id);
    const toEdit = await insertCard(authedClient, deck.id);

    const response = await container.renderToResponse(CardRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${deck.id}/cards/${toEdit.id}`, {
        method: "PATCH",
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ front: existing.front, back: existing.back }),
      }),
      params: { id: deck.id, cardId: toEdit.id },
      locals: { user, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(409);
  });

  it("POST to the AI-batch endpoint rejects the whole batch (400) before any insert when one proposal is oversized", async () => {
    const deck = await insertDeck(authedClient, user.id, uniqueDeckName("batch-oversized"));
    const oversizedFront = "x".repeat(2001);

    const { count: countBefore } = await authedClient
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", deck.id);

    const response = await container.renderToResponse(CardsRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${deck.id}/cards`, {
        method: "POST",
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: [
            { front: "valid front", back: "valid back" },
            { front: oversizedFront, back: "valid back" },
          ],
        }),
      }),
      params: { id: deck.id },
      locals: { user, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(400);

    const { count: countAfter } = await authedClient
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("deck_id", deck.id);

    expect(countAfter).toBe(countBefore ?? 0);
  });

  it("POST /review returns 404 rating a card that exists but under a different deck than the URL's id (existence-check behavior unchanged by the update-filter fix)", async () => {
    const deckA = await insertDeck(authedClient, user.id, uniqueDeckName("review-a"));
    const deckB = await insertDeck(authedClient, user.id, uniqueDeckName("review-b"));
    const cardInB = await insertCard(authedClient, deckB.id);

    const response = await container.renderToResponse(ReviewRoute, {
      routeType: "endpoint",
      request: new Request(`http://localhost/api/decks/${deckA.id}/review`, {
        method: "POST",
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: cardInB.id, grade: 2 }),
      }),
      params: { id: deckA.id },
      locals: { user, pendingDeletionRequestedAt: null },
    });

    expect(response.status).toBe(404);
  });
});
