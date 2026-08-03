import { experimental_AstroContainer } from "astro/container";
import type { AstroCookies } from "astro";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as CardsRoute from "@/pages/api/decks/[id]/cards";
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

async function insertCard(
  client: SupabaseClient<Database>,
  deckId: string,
  front: string,
  back: string,
): Promise<Tables<"cards">> {
  const { data, error } = await client
    .from("cards")
    .insert({ deck_id: deckId, front, back, source: "manual" })
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

describe("cards.ts POST batch insert atomicity", () => {
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
    await deleteTestUser(user.id);
  });

  it("rejects the whole batch (400) and persists none of it when one row duplicates an existing card's front+back", async () => {
    const deck = await insertDeck(authedClient, user.id, uniqueDeckName("batch-atomic"));
    const existing = await insertCard(
      authedClient,
      deck.id,
      "batch-atomic existing front",
      "batch-atomic existing back",
    );

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
            { front: "batch-atomic non-conflicting front A", back: "batch-atomic non-conflicting back A" },
            { front: existing.front, back: existing.back },
            { front: "batch-atomic non-conflicting front B", back: "batch-atomic non-conflicting back B" },
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
});
