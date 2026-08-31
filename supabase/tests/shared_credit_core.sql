begin;

select plan(23);

select has_table('public', 'client_profiles', 'client profiles table exists');
select has_table('public', 'shop_public_codes', 'shop public code table exists');
select has_table('public', 'repayment_allocation_events', 'allocation event table exists');
select has_trigger(
  'public',
  'repayment_allocation_events',
  'trg_allocations_append_only',
  'allocation events are append-only'
);
select has_view('public', 'client_trust_scores', 'trust score projection exists');
select has_column('public', 'ledger_entries', 'recorded_by_role', 'ledger records actor role');
select has_function(
  'public',
  'record_operation',
  array[
    'uuid', 'text', 'text', 'text', 'bigint', 'date', 'timestamp with time zone',
    'text', 'text', 'uuid', 'boolean'
  ],
  'shared operation command exists'
);
select has_function(
  'public',
  'connect_to_shop',
  array['text'],
  'shop QR connection command exists'
);

insert into auth.users (
  id, aud, role, email, is_sso_user, is_anonymous, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000101', 'authenticated', 'authenticated', 'shop@example.test', false, false, now(), now()),
  ('00000000-0000-0000-0000-000000000102', 'authenticated', 'authenticated', 'client@example.test', false, false, now(), now()),
  ('00000000-0000-0000-0000-000000000103', 'authenticated', 'authenticated', 'outsider@example.test', false, false, now(), now());

insert into public.shops (id, auth_user_id, name, phone_e164)
values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  'Boutique Test',
  '+221789999901'
);

insert into public.client_identities (
  id, phone_e164, auth_user_id, verified_at
) values (
  '00000000-0000-0000-0000-000000000301',
  '+221789999902',
  '00000000-0000-0000-0000-000000000102',
  now()
);

insert into public.client_profiles (auth_user_id, display_name)
values ('00000000-0000-0000-0000-000000000102', 'Cliente Test');

insert into public.shop_clients (
  id, shop_id, name, phone_raw, phone_e164, client_identity_id, claimed_at
) values (
  '00000000-0000-0000-0000-000000000401',
  '00000000-0000-0000-0000-000000000201',
  'Cliente Test',
  '+221789999902',
  '+221789999902',
  '00000000-0000-0000-0000-000000000301',
  now()
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.record_operation(
    '00000000-0000-0000-0000-000000000401',
    'debt',
    'Sac de riz',
    null,
    20000,
    current_date + 30,
    now(),
    'app',
    null,
    '00000000-0000-0000-0000-000000000501',
    false
  ) $$,
  'shop owner can record a debt immediately'
);

reset role;
select is(
  (select recorded_by_role from public.ledger_entries
   where idempotency_key = '00000000-0000-0000-0000-000000000501'),
  'shop',
  'shop operation records its actor role'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.record_operation(
    '00000000-0000-0000-0000-000000000401',
    'repayment',
    'Paiement en especes',
    null,
    5000,
    null,
    now(),
    'app',
    null,
    '00000000-0000-0000-0000-000000000502',
    false
  ) $$,
  'verified client can record a repayment immediately'
);

reset role;
select is(
  (select recorded_by_role from public.ledger_entries
   where idempotency_key = '00000000-0000-0000-0000-000000000502'),
  'client',
  'client operation records its actor role'
);
select is(
  (select sum(amount_xof)::bigint from public.repayment_allocation_events
   where event_type = 'allocated'
     and shop_client_id = '00000000-0000-0000-0000-000000000401'),
  5000::bigint,
  'repayment is allocated FIFO to the oldest debt'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (public.record_operation(
    '00000000-0000-0000-0000-000000000401',
    'repayment',
    'Paiement en especes',
    null,
    5000,
    null,
    now(),
    'app',
    null,
    '00000000-0000-0000-0000-000000000502',
    false
  )->>'idempotent_replay')::boolean,
  true,
  'same idempotency key replays the first result'
);

select is(
  public.record_operation(
    '00000000-0000-0000-0000-000000000401',
    'debt',
    'Sac de riz',
    null,
    20000,
    current_date + 30,
    now(),
    'app',
    null,
    '00000000-0000-0000-0000-000000000503',
    false
  )->>'reason',
  'probable_duplicate',
  'probable duplicate is returned without mutating the journal'
);

reset role;
select is(
  (select count(*)::integer from public.ledger_entries
   where shop_client_id = '00000000-0000-0000-0000-000000000401'),
  2,
  'duplicate warning leaves the ledger unchanged'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000103","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select public.record_operation(
    '00000000-0000-0000-0000-000000000401',
    'debt',
    'Intrusion',
    null,
    1,
    null,
    now(),
    'app',
    null,
    '00000000-0000-0000-0000-000000000504',
    false
  ) $$,
  'P0001',
  'relationship access denied',
  'unrelated authenticated user cannot write the relationship'
);

select is(
  (select count(*)::integer from public.ledger_entries),
  0,
  'RLS hides another relationship from an outsider'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.rotate_shop_public_code(
    repeat('a', 64),
    'SHOPTEST'
  ) $$,
  'shop owner can rotate the permanent QR code'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000102","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  public.connect_to_shop(repeat('a', 64))->>'shop_client_id',
  '00000000-0000-0000-0000-000000000401',
  'verified client resolves the QR to the existing relationship'
);

select ok(
  not has_column_privilege(
    'authenticated',
    'public.shop_public_codes',
    'code_hash',
    'SELECT'
  ),
  'QR hashes are not exposed to authenticated API clients'
);

select is(
  (select count(*)::integer from public.client_trust_scores),
  1,
  'client can read the trust projection for their relationship'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.client_trust_scores),
  0,
  'shop owner cannot read the client-only trust score'
);

select * from finish();
rollback;
