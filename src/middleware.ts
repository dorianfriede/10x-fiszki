import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/decks", "/api/decks", "/account", "/api/account"];

const PENDING_DELETION_EXEMPT_PATHS = ["/account/pending-deletion", "/api/account/cancel", "/api/auth/signout"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.pendingDeletionRequestedAt = null;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (context.locals.user && supabase) {
    const { data: pendingDeletion, error: pendingDeletionError } = await supabase
      .from("account_deletion_requests")
      .select("requested_at")
      .eq("user_id", context.locals.user.id)
      .maybeSingle();

    if (pendingDeletion) {
      context.locals.pendingDeletionRequestedAt = pendingDeletion.requested_at;
    }

    if ((pendingDeletion || pendingDeletionError) && !PENDING_DELETION_EXEMPT_PATHS.includes(context.url.pathname)) {
      return context.redirect("/account/pending-deletion");
    }
  }

  return next();
});
