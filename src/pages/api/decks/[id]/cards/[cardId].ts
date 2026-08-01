import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

interface CardInput {
  front: string;
  back: string;
}

function isValidCardInput(item: unknown): item is CardInput {
  if (!item || typeof item !== "object") return false;
  const { front, back } = item as Record<string, unknown>;
  return (
    typeof front === "string" &&
    front.trim().length > 0 &&
    front.length <= 2000 &&
    typeof back === "string" &&
    back.trim().length > 0 &&
    back.length <= 2000
  );
}

export const PATCH: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, cardId } = context.params;
  if (!id || !cardId) {
    return new Response(JSON.stringify({ error: "Missing deck id or card id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body: unknown = await context.request.json().catch(() => null);

  if (!isValidCardInput(body)) {
    return new Response(
      JSON.stringify({
        error: "Provide non-empty front and back text, each up to 2000 characters",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Supabase is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: card, error } = await supabase
    .from("cards")
    .update({ front: body.front, back: body.back })
    .eq("id", cardId)
    .eq("deck_id", id)
    .select("id, front, back, source, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return new Response(
        JSON.stringify({ error: "A card with this exact front and back already exists in this deck" }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (error.code === "PGRST116") {
      return new Response(JSON.stringify({ error: "Card not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ card }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
