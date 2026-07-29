-- Deck/card schema foundation: tables, constraints, updated_at triggers, and RLS policies.

create type card_source as enum ('ai', 'manual');

-- decks

create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and length(name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index decks_user_id_lower_name_idx on decks (user_id, lower(name));

alter table decks enable row level security;

-- cards

create table cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  front text not null check (length(trim(front)) > 0 and length(front) <= 2000),
  back text not null check (length(trim(back)) > 0 and length(back) <= 2000),
  source card_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_deck_id_idx on cards (deck_id);

alter table cards enable row level security;

-- updated_at trigger

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_decks_updated_at
before update on decks
for each row
execute function set_updated_at();

create trigger set_cards_updated_at
before update on cards
for each row
execute function set_updated_at();

-- decks RLS policies

create policy decks_select_own on decks
for select
to authenticated
using (auth.uid() = user_id);

create policy decks_insert_own on decks
for insert
to authenticated
with check (auth.uid() = user_id);

create policy decks_update_own on decks
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy decks_delete_own on decks
for delete
to authenticated
using (auth.uid() = user_id);

-- cards RLS policies (ownership derived via decks.user_id, no denormalized user_id column)

create policy cards_select_own on cards
for select
to authenticated
using (
  exists (
    select 1 from decks
    where decks.id = cards.deck_id
      and decks.user_id = auth.uid()
  )
);

create policy cards_insert_own on cards
for insert
to authenticated
with check (
  exists (
    select 1 from decks
    where decks.id = cards.deck_id
      and decks.user_id = auth.uid()
  )
);

create policy cards_update_own on cards
for update
to authenticated
using (
  exists (
    select 1 from decks
    where decks.id = cards.deck_id
      and decks.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from decks
    where decks.id = cards.deck_id
      and decks.user_id = auth.uid()
  )
);

create policy cards_delete_own on cards
for delete
to authenticated
using (
  exists (
    select 1 from decks
    where decks.id = cards.deck_id
      and decks.user_id = auth.uid()
  )
);
