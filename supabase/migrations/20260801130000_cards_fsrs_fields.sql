-- Add FSRS scheduling fields to cards so every card (existing or new) has valid
-- FSRS state without touching the existing insert code paths, add an index
-- supporting the review query's access pattern, and drop the now-redundant
-- single-column deck_id index it supersedes.

alter table cards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column elapsed_days integer not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0 check (state between 0 and 3),
  add column last_review timestamptz;

create index cards_deck_id_due_idx on cards (deck_id, due);

-- cards_deck_id_idx (deck_id) is now a strict prefix subset of the composite
-- index above and gives no read benefit while still costing a write on every
-- insert/update -- drop it.
drop index cards_deck_id_idx;
