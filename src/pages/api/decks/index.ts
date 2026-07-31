import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

const MAX_NAME_LENGTH = 100;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const rawName = form.get("name");
  const trimmedName = typeof rawName === "string" ? rawName.trim() : "";

  if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
    return context.redirect(
      `/decks?error=${encodeURIComponent(`Deck name must be between 1 and ${MAX_NAME_LENGTH} characters`)}`,
    );
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/decks?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const duplicateMessage = `You already have a deck named "${trimmedName}".`;
  const likePattern = trimmedName.replace(/[%_\\]/g, "\\$&");

  const { data: existing } = await supabase.from("decks").select("id").ilike("name", likePattern).maybeSingle();

  if (existing) {
    return context.redirect(`/decks?error=${encodeURIComponent(duplicateMessage)}`);
  }

  const { error } = await supabase.from("decks").insert({ user_id: user.id, name: trimmedName });

  if (error) {
    const message = error.code === "23505" ? duplicateMessage : error.message;
    return context.redirect(`/decks?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/decks");
};
