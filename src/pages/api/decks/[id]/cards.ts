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

  const pageParam = context.url.searchParams.get("page");
  const pageSizeParam = context.url.searchParams.get("pageSize");
  const page = pageParam ? Number(pageParam) : 1;
  const pageSize = pageSizeParam ? Number(pageSizeParam) : 25;

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    return new Response(JSON.stringify({ error: "Invalid page or pageSize" }), {
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

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const {
    data: cards,
    count,
    error,
  } = await supabase
    .from("cards")
    .select("id, front, back, source, created_at", { count: "exact" })
    .eq("deck_id", id)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ cards, page, pageSize, total: count ?? 0 }), {
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
  const cards = body && typeof body === "object" ? (body as Record<string, unknown>).cards : undefined;

  if (!Array.isArray(cards) || cards.length === 0 || !cards.every(isValidCardInput)) {
    return new Response(
      JSON.stringify({
        error: "Provide at least one card with non-empty front and back text, each up to 2000 characters",
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

  const rows = cards.map((card) => ({ deck_id: id, front: card.front, back: card.back, source: "ai" as const }));

  const { data: saved, error } = await supabase.from("cards").insert(rows).select("front, back");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { count, error: countError } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", id);

  if (countError) {
    return new Response(JSON.stringify({ error: countError.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ saved, totalCardCount: count ?? 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
