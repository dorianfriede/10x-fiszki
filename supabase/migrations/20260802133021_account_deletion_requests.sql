-- Account deletion retention: one row per user marks a pending deletion request.

create table account_deletion_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table account_deletion_requests enable row level security;

create policy account_deletion_requests_select_own on account_deletion_requests
for select
to authenticated
using (auth.uid() = user_id);

create policy account_deletion_requests_insert_own on account_deletion_requests
for insert
to authenticated
with check (auth.uid() = user_id);

create policy account_deletion_requests_delete_own on account_deletion_requests
for delete
to authenticated
using (auth.uid() = user_id);
