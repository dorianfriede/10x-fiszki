import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase";
import { POST } from "@/pages/api/decks/[id]/review";

const FIXTURE_ROW = {
  id: "card-1",
  due: "2020-01-01T00:00:00.000Z",
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

// Stubs the two `.from("cards")` chains review.ts POST builds: the row fetch
// + FSRS update (both succeed), then the trailing remaining-due count query,
// which this fixture forces to error. Real infra can't easily be forced to
// fail mid-sequence, so this is the hermetic stub case — same approach as
// tests/unit/review-reset.test.ts.
function buildStubSupabaseClient(): SupabaseClient<Database> {
  const from = vi.fn(() => ({
    select: vi.fn((_columns: string, selectOpts?: { count?: string; head?: boolean }) => {
      if (selectOpts?.count) {
        return {
          eq: vi.fn(() => ({
            lte: vi.fn(() =>
              Promise.resolve({ data: null, count: null, error: { message: "simulated count failure" } }),
            ),
          })),
        };
      }
      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: FIXTURE_ROW, error: null })),
          })),
        })),
      };
    }),
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: { due: FIXTURE_ROW.due }, error: null })),
          })),
        })),
      })),
    })),
  }));
  return { from } as unknown as SupabaseClient<Database>;
}

function buildContext(deckId: string, cardId: string, grade: number): APIContext {
  return {
    locals: { user: { id: "test-user" }, pendingDeletionRequestedAt: null },
    params: { id: deckId },
    request: new Request(`http://localhost/api/decks/${deckId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId, grade }),
    }),
    cookies: {},
  } as unknown as APIContext;
}

describe("review.ts POST remaining-due count error propagation (hermetic)", () => {
  it("does not return 200 when the remaining-due count query errors, even though the rating was saved", async () => {
    vi.mocked(createClient).mockReturnValue(buildStubSupabaseClient());

    const response = await POST(buildContext("deck-1", "card-1", 3));
    const body = (await response.json()) as { error?: string; remainingDue?: number };

    expect(response.status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});
