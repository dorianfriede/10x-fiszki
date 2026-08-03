import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/decks/[id]/review-reset";

interface ResetCardPayload {
  id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

function buildResetCard(id: string): ResetCardPayload {
  return {
    id,
    due: "2026-01-01T00:00:00.000Z",
    stability: 1,
    difficulty: 1,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 1,
    last_review: null,
  };
}

// Stubs the `.from("cards").update(...).eq("id", ...).eq("deck_id", ...)` chain
// `review-reset.ts` builds per card, resolving one specific card id's update
// with a Supabase-shaped `{ error }` while every other update succeeds — real
// infra can't easily be forced to fail mid-sequence, so this is the hermetic
// stub case test-plan.md's Risk Response Guidance names for risk #3.
function buildStubSupabaseClient(failingCardId: string): SupabaseClient<Database> {
  const from = vi.fn(() => ({
    update: vi.fn(() => ({
      eq: vi.fn((_col1: string, cardId: string) => ({
        eq: vi.fn(() =>
          cardId === failingCardId
            ? Promise.resolve({ data: null, error: { message: "simulated update failure" } })
            : Promise.resolve({ data: null, error: null }),
        ),
      })),
    })),
  }));
  return { from } as unknown as SupabaseClient<Database>;
}

function buildContext(deckId: string, cards: ResetCardPayload[]): APIContext {
  return {
    locals: { user: { id: "test-user" }, pendingDeletionRequestedAt: null },
    params: { id: deckId },
    request: new Request(`http://localhost/api/decks/${deckId}/review-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

describe("review-reset.ts partial-failure contract (hermetic)", () => {
  it("reports restored === total - 1 and never claims full success when exactly one update fails", async () => {
    const cardIds = ["card-1", "card-2", "card-3"];
    const failingCardId = "card-2";
    vi.mocked(createClient).mockReturnValue(buildStubSupabaseClient(failingCardId));

    const response = await POST(buildContext("deck-1", cardIds.map(buildResetCard)));
    const body = (await response.json()) as { restored: number; total: number };

    expect(response.status).toBe(200);
    expect(body.total).toBe(cardIds.length);
    expect(body.restored).toBe(cardIds.length - 1);
    expect(body.restored).not.toBe(body.total);
  });

  it("reports restored === total when every update succeeds", async () => {
    const cardIds = ["card-1", "card-2", "card-3"];
    vi.mocked(createClient).mockReturnValue(buildStubSupabaseClient("no-such-card"));

    const response = await POST(buildContext("deck-1", cardIds.map(buildResetCard)));
    const body = (await response.json()) as { restored: number; total: number };

    expect(response.status).toBe(200);
    expect(body.restored).toBe(cardIds.length);
    expect(body.total).toBe(cardIds.length);
  });
});
