import { experimental_AstroContainer } from "astro/container";
import type { AstroCookies } from "astro";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as ReviewRouteImport from "@/pages/api/decks/[id]/review";
import { scheduler, toFsrsCard, fromFsrsCard, type FsrsFields } from "@/lib/fsrs";
import { createClient } from "@/lib/supabase";
import type { Database, Tables, TablesInsert } from "@/db/database.types";
import { createTestUser, deleteTestUser, getAuthenticatedRequestInit, type TestUser } from "../helpers/test-auth";

// Same "brand-new card" oracle as tests/unit/fsrs.test.ts (mirrors the DB
// defaults in supabase/migrations/20260801130000_cards_fsrs_fields.sql) —
// every fixture card starts here and only overrides `due`.
const NEW_CARD_FSRS_DEFAULTS = {
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  last_review: null as string | null,
};

let deckSeq = 0;
function uniqueDeckName(prefix: string): string {
  deckSeq += 1;
  return `${prefix}-${deckSeq}`;
}

let cardSeq = 0;
function uniqueFrontBack(): { front: string; back: string } {
  cardSeq += 1;
  return { front: `review-test front ${cardSeq}`, back: `review-test back ${cardSeq}` };
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
  overrides: Partial<TablesInsert<"cards">> = {},
): Promise<Tables<"cards">> {
  const { front, back } = uniqueFrontBack();
  const { data, error } = await client
    .from("cards")
    .insert({
      deck_id: deckId,
      front,
      back,
      source: "manual",
      ...NEW_CARD_FSRS_DEFAULTS,
      ...overrides,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to insert fixture card: ${error.message}`);
  }
  return data;
}

/** Normalizes DB-round-tripped timestamptz strings to instants so comparisons don't depend on Postgres's exact string formatting. */
function toComparableFsrsFields(fields: FsrsFields) {
  return {
    due: new Date(fields.due).getTime(),
    stability: fields.stability,
    difficulty: fields.difficulty,
    elapsed_days: fields.elapsed_days,
    scheduled_days: fields.scheduled_days,
    learning_steps: fields.learning_steps,
    reps: fields.reps,
    lapses: fields.lapses,
    state: fields.state,
    last_review: fields.last_review ? new Date(fields.last_review).getTime() : null,
  };
}

const FSRS_SELECT =
  "due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review";

// No-op cookie jar, matching tests/integration/auth-contract.test.ts: this
// client only ever reads the session from the replayed `Cookie` header.
const noopCookies = { set: () => undefined } as unknown as AstroCookies;

type ContainerComponent = Parameters<experimental_AstroContainer["renderToResponse"]>[0];
const ReviewRoute = ReviewRouteImport as unknown as ContainerComponent;

describe("review.ts GET/POST integration", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET", () => {
    let deckId: string;
    const pastDues: string[] = [];
    const futureDue = new Date("2099-01-01T00:00:00.000Z").toISOString();

    beforeAll(async () => {
      const deck = await insertDeck(authedClient, user.id, uniqueDeckName("get-review"));
      deckId = deck.id;

      const base = new Date("2020-01-01T00:00:00.000Z").getTime();
      for (let i = 0; i < 31; i += 1) {
        const due = new Date(base + i * 60_000).toISOString();
        pastDues.push(due);
        await insertCard(authedClient, deckId, { due });
      }
      await insertCard(authedClient, deckId, { due: futureDue });
    });

    it("returns only due cards, capped at SESSION_SIZE=30, ordered ascending by due", async () => {
      const response = await container.renderToResponse(ReviewRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckId}/review`, {
          headers: { Cookie: cookieHeader },
        }),
        params: { id: deckId },
        locals: { user, pendingDeletionRequestedAt: null } as unknown as App.Locals,
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { cards: { due: string }[] };

      expect(body.cards).toHaveLength(30);
      // Compare as instants, not raw strings: Postgres/PostgREST round-trips
      // timestamptz as "+00:00"-offset ISO, not the "Z"-suffixed form these
      // fixtures were built with.
      expect(body.cards.map((card) => new Date(card.due).getTime())).toEqual(
        pastDues.slice(0, 30).map((due) => new Date(due).getTime()),
      );
      expect(body.cards.some((card) => new Date(card.due).getTime() === new Date(futureDue).getTime())).toBe(false);
    });
  });

  describe("POST", () => {
    let deckId: string;

    beforeAll(async () => {
      const deck = await insertDeck(authedClient, user.id, uniqueDeckName("post-review"));
      deckId = deck.id;
    });

    it("persists FSRS fields matching an independently computed scheduler.next() call", async () => {
      const card = await insertCard(authedClient, deckId, { due: new Date("2020-06-15T00:00:00.000Z").toISOString() });

      const frozenNow = new Date("2026-06-20T12:00:00.000Z");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(frozenNow);

      const grade = 3;
      const expected = scheduler.next(toFsrsCard(card), frozenNow, grade);

      const response = await container.renderToResponse(ReviewRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckId}/review`, {
          method: "POST",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: card.id, grade }),
        }),
        params: { id: deckId },
        locals: { user, pendingDeletionRequestedAt: null } as unknown as App.Locals,
      });

      expect(response.status).toBe(200);

      const { data: persisted, error } = await authedClient
        .from("cards")
        .select(FSRS_SELECT)
        .eq("id", card.id)
        .single();
      expect(error).toBeNull();
      if (!persisted) throw new Error("expected the persisted card row to exist");

      expect(toComparableFsrsFields(persisted)).toEqual(toComparableFsrsFields(fromFsrsCard(expected.card)));
    });

    it("returns 404 when the card belongs to a different deck than the URL's id", async () => {
      const otherDeck = await insertDeck(authedClient, user.id, uniqueDeckName("post-review-other"));
      const foreignCard = await insertCard(authedClient, otherDeck.id, {
        due: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      });

      const response = await container.renderToResponse(ReviewRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckId}/review`, {
          method: "POST",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: foreignCard.id, grade: 2 }),
        }),
        params: { id: deckId },
        locals: { user, pendingDeletionRequestedAt: null } as unknown as App.Locals,
      });

      expect(response.status).toBe(404);
    });

    it("returns 400 when grade is outside 1-4", async () => {
      const response = await container.renderToResponse(ReviewRoute, {
        routeType: "endpoint",
        request: new Request(`http://localhost/api/decks/${deckId}/review`, {
          method: "POST",
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: "00000000-0000-0000-0000-000000000000", grade: 5 }),
        }),
        params: { id: deckId },
        locals: { user, pendingDeletionRequestedAt: null } as unknown as App.Locals,
      });

      expect(response.status).toBe(400);
    });
  });
});
