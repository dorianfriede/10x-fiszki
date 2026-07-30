import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  if (!id) {
    return context.redirect(`/decks?error=${encodeURIComponent("Missing deck id")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/decks?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const { error } = await supabase.from("decks").delete().eq("id", id);

  if (error) {
    return context.redirect(`/decks?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/decks");
};
