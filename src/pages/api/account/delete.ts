import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/account?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const { error } = await supabase.from("account_deletion_requests").insert({ user_id: user.id });

  if (error) {
    return context.redirect(`/account?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/account/pending-deletion");
};
