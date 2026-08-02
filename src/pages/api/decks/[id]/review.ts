import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { scheduler, toFsrsCard, fromFsrsCard } from "@/lib/fsrs";

// Shrunk from the plan's original 50 to 30 for shorter, easier review sessions —
// still comfortably under the NFR's 500-cards-per-account ceiling.
const SESSION_SIZE = 30;

interface RatePayload {
  cardId: string;
  grade: number;
}

function isValidGrade(item: unknown): item is RatePayload {
  if (!item || typeof item !== "object") return false;
  const { cardId, grade } = item as Record<string, unknown>;
  return (
    typeof cardId === "string" &&
    cardId.length > 0 &&
    typeof grade === "number" &&
    Number.isInteger(grade) &&
    grade >= 1 &&
    grade <= 4
  );
}

export const GET: APIRoute = async (context) => {
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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: cards, error } = await supabase
    .from("cards")
    .select(
      "id, front, back, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review",
    )
    .eq("deck_id", id)
    .lte("due", new Date().toISOString())
    .order("due", { ascending: true })
    .limit(SESSION_SIZE);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ cards }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

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

  if (!isValidGrade(body)) {
    return new Response(JSON.stringify({ error: "Provide a cardId and a grade between 1 and 4" }), {
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

  const { data: row, error: fetchError } = await supabase
    .from("cards")
    .select("*")
    .eq("id", body.cardId)
    .eq("deck_id", id)
    .maybeSingle();

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!row) {
    return new Response(JSON.stringify({ error: "Card not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const { card: nextCard } = scheduler.next(toFsrsCard(row), now, body.grade);

  const { data: updated, error: updateError } = await supabase
    .from("cards")
    .update(fromFsrsCard(nextCard))
    .eq("id", body.cardId)
    .select("due")
    .single();

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", id)
    .lte("due", new Date().toISOString());

  return new Response(JSON.stringify({ due: updated.due, remainingDue: count ?? 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
