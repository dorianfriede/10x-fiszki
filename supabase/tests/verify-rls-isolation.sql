-- Manual RLS isolation verification script.
-- Run via `psql` or the Supabase Studio SQL editor against the LINKED CLOUD project.
-- Not automated in CI -- no test framework exists yet in this project (see plan's
-- "What We're NOT Doing"). Re-run after any future change to the decks/cards RLS
-- policies.
--
-- Creates two temporary synthetic auth.users rows (not real app signups) so that
-- decks.user_id's foreign key to auth.users(id) is satisfiable, then simulates
-- each user's identity via `request.jwt.claims` + `SET ROLE authenticated` --
-- the standard technique for exercising Supabase RLS from raw SQL without going
-- through the app's signup flow. All fixture rows are removed at the end;
-- deleting the auth.users rows cascades away their decks/cards automatically.
--
-- Run the whole script top to bottom. Every statement under "expect 0" must
-- return zero rows / report "UPDATE 0" or "DELETE 0". The final section must
-- show user A's deck/card unchanged and still readable by user A.

-- 1. Create two temporary auth.users fixtures.
insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'rls-test-user-a@example.com', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'rls-test-user-b@example.com', now(), now());

-- 2. As user A: create a deck and a card.
set request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
set role authenticated;

insert into decks (id, user_id, name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'User A Deck');

insert into cards (id, deck_id, front, back, source)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Front A', 'Back A', 'manual');

-- Sanity: user A can see their own new rows. Expect 1 row each.
select count(*) as expect_1_deck from decks where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select count(*) as expect_1_card from cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

reset role;

-- 3. Switch to user B: attempt cross-user reads/writes against user A's rows.
set request.jwt.claims = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';
set role authenticated;

-- Expect 0 rows: user B cannot see user A's deck/card.
select count(*) as expect_0_select_deck from decks where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select count(*) as expect_0_select_card from cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Expect "UPDATE 0": user B cannot update user A's deck/card.
update decks set name = 'Hijacked' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update cards set front = 'Hijacked' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Expect "DELETE 0": user B cannot delete user A's deck/card.
delete from cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
delete from decks where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

reset role;

-- 4. Back as user A: confirm their own rows are untouched and still accessible.
set request.jwt.claims = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';
set role authenticated;

select name from decks where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; -- expect 'User A Deck', unchanged
select front from cards where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; -- expect 'Front A', unchanged

reset role;

-- 5. Cleanup fixtures (runs as the connection's own role, e.g. postgres/superuser --
-- cascade removes the decks/cards created above along with the fixture users).
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);
