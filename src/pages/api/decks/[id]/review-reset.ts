import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

interface ResetCardInput {
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

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isValidResetCard(item: unknown): item is ResetCardInput {
  if (!item || typeof item !== "object") return false;
  const {
    id,
    due,
    stability,
    difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    learning_steps: learningSteps,
    reps,
    lapses,
    state,
    last_review: lastReview,
  } = item as Record<string, unknown>;

  return (
    typeof id === "string" &&
    id.length > 0 &&
    isValidDateString(due) &&
    isNonNegativeFiniteNumber(stability) &&
    isNonNegativeFiniteNumber(difficulty) &&
    isNonNegativeFiniteNumber(elapsedDays) &&
    isNonNegativeFiniteNumber(scheduledDays) &&
    isNonNegativeFiniteNumber(learningSteps) &&
    isNonNegativeFiniteNumber(reps) &&
    isNonNegativeFiniteNumber(lapses) &&
    Number.isInteger(state) &&
    (state as number) >= 0 &&
    (state as number) <= 3 &&
    (lastReview === null || isValidDateString(lastReview))
  );
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = context.params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Missing deck id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body: unknown = await context.request.json().catch(() => null);
  const cards = body && typeof body === "object" ? (body as Record<string, unknown>).cards : undefined;

  if (!Array.isArray(cards) || cards.length === 0 || !cards.every(isValidResetCard)) {
    return new Response(JSON.stringify({ error: "Provide at least one card with valid FSRS field values" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await Promise.allSettled(
    cards.map((card) =>
      supabase
        .from("cards")
        .update({
          due: card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          learning_steps: card.learning_steps,
          reps: card.reps,
          lapses: card.lapses,
          state: card.state,
          last_review: card.last_review,
        })
        .eq("id", card.id)
        .eq("deck_id", id),
    ),
  );

  const restored = results.filter((result) => result.status === "fulfilled" && !result.value.error).length;

  return new Response(JSON.stringify({ restored, total: cards.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
