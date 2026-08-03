import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect(`/decks?error=${encodeURIComponent("Not authenticated")}`);
  }

  const { id } = context.params;
  if (!id) {
    return context.redirect(`/decks?error=${encodeURIComponent("Missing deck id")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/decks?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { data, error } = await supabase.from("decks").delete().eq("id", id).select("id").maybeSingle();

  if (error) {
    return context.redirect(`/decks?error=${encodeURIComponent(error.message)}`);
  }

  if (!data) {
    return context.redirect(`/decks?error=${encodeURIComponent("Deck not found")}`);
  }

  return context.redirect("/decks");
};
