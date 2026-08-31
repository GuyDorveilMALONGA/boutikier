begin;

select plan(8);

select has_table('public', 'shops', 'shops table exists');
select has_table('public', 'shop_clients', 'shop clients table exists');
select has_table('public', 'ledger_entries', 'ledger table exists');
select has_table('public', 'dispute_events', 'dispute event table exists');
select has_table('public', 'message_outbox', 'message outbox table exists');
select has_trigger('public', 'ledger_entries', 'trg_ledger_append_only', 'ledger is append-only');
select has_trigger('public', 'dispute_events', 'trg_disputes_append_only', 'disputes are append-only');
select has_function('public', 'correct_entry', array['uuid', 'text', 'uuid'], 'correction function exists');

select * from finish();
rollback;
