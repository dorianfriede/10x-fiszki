-- Daily job that permanently purges accounts whose deletion was requested 30+ days ago.
-- FK cascades from auth.users -> decks -> cards mean this single delete removes everything the user owns.

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'purge-expired-account-deletions',
  '0 3 * * *',
  $$
  delete from auth.users
  using account_deletion_requests
  where auth.users.id = account_deletion_requests.user_id
    and account_deletion_requests.requested_at < now() - interval '30 days';
  $$
);
