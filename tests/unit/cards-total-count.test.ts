import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/decks/[id]/cards";

// Stubs the two `.from("cards")` chains cards.ts POST builds: the batch
// insert (succeeds), then the trailing total-card-count query, which this
// fixture forces to error. Real infra can't easily be forced to fail
// mid-sequence, so this is the hermetic stub case — same approach as
// tests/unit/review-reset.test.ts.
function buildStubSupabaseClient(): SupabaseClient<Database> {
  const from = vi.fn(() => ({
    insert: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [{ front: "Q", back: "A" }], error: null })),
    })),
    select: vi.fn((_columns: string, selectOpts?: { count?: string; head?: boolean }) => {
      if (selectOpts?.count) {
        return {
          eq: vi.fn(() => Promise.resolve({ data: null, count: null, error: { message: "simulated count failure" } })),
        };
      }
      throw new Error("unexpected select() call in stub");
    }),
  }));
  return { from } as unknown as SupabaseClient<Database>;
}

function buildContext(deckId: string, cards: { front: string; back: string }[]): APIContext {
  return {
    locals: { user: { id: "test-user" }, pendingDeletionRequestedAt: null },
    params: { id: deckId },
    request: new Request(`http://localhost/api/decks/${deckId}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

describe("cards.ts POST total-card-count error propagation (hermetic)", () => {
  it("does not return 200 when the total-card-count query errors, even though the cards were saved", async () => {
    vi.mocked(createClient).mockReturnValue(buildStubSupabaseClient());

    const response = await POST(buildContext("deck-1", [{ front: "Q", back: "A" }]));
    const body = (await response.json()) as { error?: string; totalCardCount?: number };

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});
