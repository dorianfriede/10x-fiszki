-- Supabase stopped auto-granting Data API access to new public-schema tables for
-- projects created on/after 2026-05-30 (see supabase.com/changelog/45329). RLS
-- policies alone don't grant table access, so authenticated requests against
-- decks/cards/account_deletion_requests were failing with 42501 "permission
-- denied for table" everywhere (CI, local `supabase start`, and production).

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.decks to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select, insert, delete on public.account_deletion_requests to authenticated;

-- Cover future tables created by this role so this doesn't recur silently.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
