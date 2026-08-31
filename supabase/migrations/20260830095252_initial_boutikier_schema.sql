-- ============================================================================
-- Boutikier - PostgreSQL / Supabase schema V3
-- Fresh installation schema. This is not an in-place V2 data migration.
-- ============================================================================

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============================================================================
-- IDENTITY AND TENANCY
-- ============================================================================

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique
    references auth.users(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  phone_e164 text check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  currency_code text not null default 'XOF'
    check (currency_code = 'XOF'),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (archived_at is null or archived_at >= created_at)
);

create table public.client_identities (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  auth_user_id uuid unique
    references auth.users(id) on delete set null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.shop_clients (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  phone_raw text,
  phone_e164 text check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  avatar_url text,
  client_identity_id uuid
    references public.client_identities(id) on delete restrict,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint shop_clients_id_shop_unique unique (id, shop_id),
  constraint shop_clients_phone_unique unique (shop_id, phone_e164),
  constraint shop_clients_claim_consistent check (
    (client_identity_id is null and claimed_at is null)
    or (client_identity_id is not null and claimed_at is not null)
  ),
  check (archived_at is null or archived_at >= created_at)
);

create unique index shop_clients_identity_per_shop_unique
  on public.shop_clients (shop_id, client_identity_id)
  where client_identity_id is not null;

create index shop_clients_shop_idx on public.shop_clients (shop_id);
create index shop_clients_phone_idx on public.shop_clients (phone_e164)
  where phone_e164 is not null;
create index shop_clients_identity_idx on public.shop_clients (client_identity_id)
  where client_identity_id is not null;

-- A claimed record keeps the verified phone that established the identity link.
create or replace function private.protect_claimed_client_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.client_identity_id is not null then
    if new.client_identity_id is distinct from old.client_identity_id
       or new.phone_e164 is distinct from old.phone_e164
       or new.claimed_at is distinct from old.claimed_at then
      raise exception 'a claimed client identity cannot be changed directly';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_protect_claimed_client_identity
before update on public.shop_clients
for each row execute function private.protect_claimed_client_identity();

-- ============================================================================
-- IMMUTABLE FINANCIAL JOURNAL
-- amount_xof is signed: debt > 0, repayment < 0, correction = -original.
-- ============================================================================

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  sequence_number bigint generated always as identity unique,
  shop_id uuid not null,
  shop_client_id uuid not null,
  entry_type text not null
    check (entry_type in ('debt', 'repayment', 'correction')),
  amount_xof bigint not null check (amount_xof <> 0),
  reverses_entry_id uuid references public.ledger_entries(id) on delete restrict,
  title text not null check (btrim(title) <> '' and char_length(title) <= 200),
  detail text check (detail is null or char_length(detail) <= 2000),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  actor_auth_user_id uuid not null,
  idempotency_key uuid not null,

  constraint ledger_client_shop_fk
    foreign key (shop_client_id, shop_id)
    references public.shop_clients(id, shop_id)
    on delete restrict,
  constraint ledger_id_shop_client_unique
    unique (id, shop_id, shop_client_id),
  constraint ledger_idempotency_unique
    unique (actor_auth_user_id, idempotency_key),
  constraint ledger_debt_positive
    check (entry_type <> 'debt' or amount_xof > 0),
  constraint ledger_repayment_negative
    check (entry_type <> 'repayment' or amount_xof < 0),
  constraint ledger_correction_reference check (
    (entry_type = 'correction' and reverses_entry_id is not null)
    or (entry_type <> 'correction' and reverses_entry_id is null)
  )
);

create unique index ledger_one_correction_per_entry_unique
  on public.ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

create index ledger_client_timeline_idx
  on public.ledger_entries (shop_client_id, occurred_at desc, sequence_number desc);
create index ledger_shop_recorded_idx
  on public.ledger_entries (shop_id, recorded_at desc);

create or replace function private.enforce_correction_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_original public.ledger_entries%rowtype;
begin
  if new.entry_type <> 'correction' then
    return new;
  end if;

  select * into v_original
  from public.ledger_entries
  where id = new.reverses_entry_id;

  if not found then
    raise exception 'reverses_entry_id not found';
  elsif v_original.entry_type = 'correction' then
    raise exception 'a correction cannot reverse another correction';
  elsif v_original.shop_id <> new.shop_id
     or v_original.shop_client_id <> new.shop_client_id then
    raise exception 'a correction must use the original shop and client';
  elsif new.amount_xof <> -v_original.amount_xof then
    raise exception 'correction must be the exact inverse of the original';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_correction_integrity
before insert on public.ledger_entries
for each row execute function private.enforce_correction_integrity();

create or replace function private.reject_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% is append-only; UPDATE and DELETE are forbidden', tg_table_name;
end;
$$;

create trigger trg_ledger_append_only
before update or delete on public.ledger_entries
for each row execute function private.reject_event_mutation();

-- ============================================================================
-- IMMUTABLE DISPUTE EVENTS
-- State is derived from the latest event for a ledger entry.
-- ============================================================================

create table public.dispute_events (
  id uuid primary key default gen_random_uuid(),
  sequence_number bigint generated always as identity unique,
  shop_id uuid not null,
  shop_client_id uuid not null,
  ledger_entry_id uuid not null,
  event_type text not null
    check (event_type in ('opened', 'withdrawn', 'resolved')),
  note text check (note is null or char_length(note) <= 2000),
  actor_auth_user_id uuid not null,
  recorded_at timestamptz not null default now(),
  idempotency_key uuid not null,

  constraint dispute_ledger_tenant_fk
    foreign key (ledger_entry_id, shop_id, shop_client_id)
    references public.ledger_entries(id, shop_id, shop_client_id)
    on delete restrict,
  constraint dispute_idempotency_unique
    unique (actor_auth_user_id, idempotency_key)
);

create index dispute_latest_state_idx
  on public.dispute_events
  (ledger_entry_id, recorded_at desc, sequence_number desc);
create index dispute_shop_idx
  on public.dispute_events (shop_id, recorded_at desc);
create index dispute_client_idx
  on public.dispute_events (shop_client_id, recorded_at desc);

create or replace function private.enforce_dispute_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry_type text;
begin
  select entry_type into v_entry_type
  from public.ledger_entries
  where id = new.ledger_entry_id
    and shop_id = new.shop_id
    and shop_client_id = new.shop_client_id;

  if not found then
    raise exception 'dispute target not found in the same tenant';
  elsif v_entry_type = 'correction' then
    raise exception 'a correction cannot be disputed';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_dispute_target
before insert on public.dispute_events
for each row execute function private.enforce_dispute_target();

create trigger trg_disputes_append_only
before update or delete on public.dispute_events
for each row execute function private.reject_event_mutation();

-- ============================================================================
-- REVOCABLE PRIVATE SHARE LINKS
-- Railway signs {link_id, expires_at} with an application HMAC secret.
-- The database stores no bearer token and the worker can regenerate the URL.
-- ============================================================================

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  shop_client_id uuid not null
    references public.shop_clients(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create unique index share_links_one_active_per_client_unique
  on public.share_links (shop_client_id)
  where revoked_at is null;

create index share_links_client_idx on public.share_links (shop_client_id);

-- ============================================================================
-- RELIABLE MESSAGE OUTBOX
-- ============================================================================

create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  shop_client_id uuid
    references public.shop_clients(id) on delete restrict,
  source_kind text not null
    check (source_kind in ('ledger_entry', 'dispute_event', 'share_link', 'verification')),
  source_id uuid not null,
  message_type text not null check (
    message_type in (
      'debt_receipt',
      'payment_receipt',
      'correction_notice',
      'dispute_notice',
      'share_link',
      'verification_result'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry_wait', 'sent', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint outbox_source_message_unique
    unique (source_kind, source_id, message_type),
  constraint outbox_lock_consistent check (
    (status = 'processing' and locked_by is not null and locked_until is not null)
    or (status <> 'processing' and locked_by is null and locked_until is null)
  ),
  constraint outbox_sent_consistent check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  )
);

create index outbox_claim_idx
  on public.message_outbox (available_at, created_at)
  where status in ('pending', 'retry_wait', 'processing');
create index outbox_client_idx on public.message_outbox (shop_client_id)
  where shop_client_id is not null;
create unique index outbox_provider_message_unique
  on public.message_outbox (provider_message_id)
  where provider_message_id is not null;

-- ============================================================================
-- READ PROJECTIONS
-- ============================================================================

create view public.shop_client_balances
with (security_invoker = true)
as
select
  sc.id as shop_client_id,
  sc.shop_id,
  coalesce(sum(le.amount_xof), 0)::bigint as balance_total_xof,
  coalesce(sum(le.amount_xof) filter (where ds.is_disputed), 0)::bigint
    as balance_disputed_xof,
  coalesce(sum(le.amount_xof) filter (where ds.is_disputed is not true), 0)::bigint
    as balance_clear_xof
from public.shop_clients sc
left join public.ledger_entries le on le.shop_client_id = sc.id
left join lateral (
  select de.event_type = 'opened' as is_disputed
  from public.dispute_events de
  where de.ledger_entry_id = le.id
  order by de.recorded_at desc, de.sequence_number desc
  limit 1
) ds on true
group by sc.id, sc.shop_id;

create view public.client_timeline
with (security_invoker = true)
as
select
  le.shop_client_id,
  le.id as event_id,
  le.sequence_number as source_sequence,
  'ledger'::text as source,
  le.entry_type as kind,
  le.amount_xof,
  le.reverses_entry_id as target_entry_id,
  le.title,
  le.detail,
  le.occurred_at as event_at
from public.ledger_entries le
union all
select
  de.shop_client_id,
  de.id as event_id,
  de.sequence_number as source_sequence,
  'dispute'::text as source,
  de.event_type as kind,
  null::bigint as amount_xof,
  de.ledger_entry_id as target_entry_id,
  de.note as title,
  null::text as detail,
  de.recorded_at as event_at
from public.dispute_events de;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.shops enable row level security;
alter table public.client_identities enable row level security;
alter table public.shop_clients enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.dispute_events enable row level security;
alter table public.share_links enable row level security;
alter table public.message_outbox enable row level security;

create policy shops_select_own
on public.shops for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy shops_insert_own
on public.shops for insert to authenticated
with check (
  auth_user_id = (select auth.uid())
  and (select auth.uid()) is not null
);

create policy shops_update_own
on public.shops for update to authenticated
using (auth_user_id = (select auth.uid()))
with check (auth_user_id = (select auth.uid()));

create policy client_identities_select_own
on public.client_identities for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy shop_clients_select_actor
on public.shop_clients for select to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = shop_clients.shop_id
      and s.auth_user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.client_identities ci
    where ci.id = shop_clients.client_identity_id
      and ci.auth_user_id = (select auth.uid())
  )
);

create policy shop_clients_insert_shop
on public.shop_clients for insert to authenticated
with check (
  client_identity_id is null
  and claimed_at is null
  and exists (
    select 1 from public.shops s
    where s.id = shop_clients.shop_id
      and s.auth_user_id = (select auth.uid())
      and s.archived_at is null
  )
);

create policy shop_clients_update_shop
on public.shop_clients for update to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = shop_clients.shop_id
      and s.auth_user_id = (select auth.uid())
      and s.archived_at is null
  )
)
with check (
  exists (
    select 1 from public.shops s
    where s.id = shop_clients.shop_id
      and s.auth_user_id = (select auth.uid())
      and s.archived_at is null
  )
);

create policy ledger_select_actor
on public.ledger_entries for select to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = ledger_entries.shop_id
      and s.auth_user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.shop_clients sc
    join public.client_identities ci on ci.id = sc.client_identity_id
    where sc.id = ledger_entries.shop_client_id
      and ci.auth_user_id = (select auth.uid())
  )
);

create policy disputes_select_actor
on public.dispute_events for select to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = dispute_events.shop_id
      and s.auth_user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.shop_clients sc
    join public.client_identities ci on ci.id = sc.client_identity_id
    where sc.id = dispute_events.shop_client_id
      and ci.auth_user_id = (select auth.uid())
  )
);

-- ============================================================================
-- BUSINESS RPC FUNCTIONS
-- ============================================================================

create or replace function public.record_debt(
  p_shop_client_id uuid,
  p_title text,
  p_detail text,
  p_amount_xof bigint,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_phone text;
  v_entry_id uuid;
  v_existing public.ledger_entries%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_amount_xof <= 0 then raise exception 'amount must be positive'; end if;

  select sc.shop_id, sc.phone_e164 into v_shop_id, v_phone
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = p_shop_client_id
    and sc.archived_at is null
    and s.archived_at is null
    and s.auth_user_id = v_actor;

  if not found then raise exception 'shop client not found or not authorized'; end if;

  select * into v_existing
  from public.ledger_entries
  where actor_auth_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.entry_type <> 'debt'
       or v_existing.shop_client_id <> p_shop_client_id
       or v_existing.amount_xof <> p_amount_xof
       or v_existing.title <> btrim(p_title)
       or v_existing.detail is distinct from p_detail then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  insert into public.ledger_entries (
    shop_id, shop_client_id, entry_type, amount_xof, title, detail,
    actor_auth_user_id, idempotency_key
  ) values (
    v_shop_id, p_shop_client_id, 'debt', p_amount_xof, btrim(p_title), p_detail,
    v_actor, p_idempotency_key
  )
  on conflict (actor_auth_user_id, idempotency_key) do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select * into strict v_existing
    from public.ledger_entries
    where actor_auth_user_id = v_actor
      and idempotency_key = p_idempotency_key;

    if v_existing.entry_type <> 'debt'
       or v_existing.shop_client_id <> p_shop_client_id
       or v_existing.amount_xof <> p_amount_xof
       or v_existing.title <> btrim(p_title)
       or v_existing.detail is distinct from p_detail then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  if v_phone is not null then
    insert into public.message_outbox (
      shop_client_id, source_kind, source_id, message_type
    ) values (
      p_shop_client_id, 'ledger_entry', v_entry_id, 'debt_receipt'
    );
  end if;

  return v_entry_id;
end;
$$;

create or replace function public.record_repayment(
  p_shop_client_id uuid,
  p_title text,
  p_detail text,
  p_amount_xof bigint,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_phone text;
  v_entry_id uuid;
  v_existing public.ledger_entries%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_amount_xof <= 0 then raise exception 'amount must be positive'; end if;

  select sc.shop_id, sc.phone_e164 into v_shop_id, v_phone
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = p_shop_client_id
    and sc.archived_at is null
    and s.archived_at is null
    and s.auth_user_id = v_actor;

  if not found then raise exception 'shop client not found or not authorized'; end if;

  select * into v_existing
  from public.ledger_entries
  where actor_auth_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.entry_type <> 'repayment'
       or v_existing.shop_client_id <> p_shop_client_id
       or v_existing.amount_xof <> -p_amount_xof
       or v_existing.title <> btrim(p_title)
       or v_existing.detail is distinct from p_detail then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  insert into public.ledger_entries (
    shop_id, shop_client_id, entry_type, amount_xof, title, detail,
    actor_auth_user_id, idempotency_key
  ) values (
    v_shop_id, p_shop_client_id, 'repayment', -p_amount_xof, btrim(p_title), p_detail,
    v_actor, p_idempotency_key
  )
  on conflict (actor_auth_user_id, idempotency_key) do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    select * into strict v_existing
    from public.ledger_entries
    where actor_auth_user_id = v_actor
      and idempotency_key = p_idempotency_key;

    if v_existing.entry_type <> 'repayment'
       or v_existing.shop_client_id <> p_shop_client_id
       or v_existing.amount_xof <> -p_amount_xof
       or v_existing.title <> btrim(p_title)
       or v_existing.detail is distinct from p_detail then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  if v_phone is not null then
    insert into public.message_outbox (
      shop_client_id, source_kind, source_id, message_type
    ) values (
      p_shop_client_id, 'ledger_entry', v_entry_id, 'payment_receipt'
    );
  end if;

  return v_entry_id;
end;
$$;

create or replace function public.correct_entry(
  p_original_entry_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_original public.ledger_entries%rowtype;
  v_existing public.ledger_entries%rowtype;
  v_correction_id uuid;
  v_last_dispute_type text;
  v_phone text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'correction reason is required';
  end if;

  select le.* into v_original
  from public.ledger_entries le
  join public.shop_clients sc on sc.id = le.shop_client_id
  join public.shops s on s.id = le.shop_id
  where le.id = p_original_entry_id
    and le.entry_type <> 'correction'
    and sc.archived_at is null
    and s.archived_at is null
    and s.auth_user_id = v_actor
  for update of le;

  if not found then raise exception 'entry not found or not authorized'; end if;

  select * into v_existing
  from public.ledger_entries
  where actor_auth_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.entry_type <> 'correction'
       or v_existing.reverses_entry_id <> p_original_entry_id
       or v_existing.detail is distinct from btrim(p_reason) then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  if exists (
    select 1 from public.ledger_entries
    where reverses_entry_id = p_original_entry_id
  ) then
    raise exception 'entry has already been corrected';
  end if;

  insert into public.ledger_entries (
    shop_id, shop_client_id, entry_type, amount_xof, reverses_entry_id,
    title, detail, actor_auth_user_id, idempotency_key
  ) values (
    v_original.shop_id,
    v_original.shop_client_id,
    'correction',
    -v_original.amount_xof,
    v_original.id,
    'Correction: ' || v_original.title,
    btrim(p_reason),
    v_actor,
    p_idempotency_key
  )
  returning id into v_correction_id;

  select event_type into v_last_dispute_type
  from public.dispute_events
  where ledger_entry_id = v_original.id
  order by recorded_at desc, sequence_number desc
  limit 1;

  if v_last_dispute_type = 'opened' then
    insert into public.dispute_events (
      shop_id, shop_client_id, ledger_entry_id, event_type, note,
      actor_auth_user_id, idempotency_key
    ) values (
      v_original.shop_id,
      v_original.shop_client_id,
      v_original.id,
      'resolved',
      'Resolved by correction: ' || btrim(p_reason),
      v_actor,
      v_correction_id
    );
  end if;

  select phone_e164 into v_phone
  from public.shop_clients where id = v_original.shop_client_id;

  if v_phone is not null then
    insert into public.message_outbox (
      shop_client_id, source_kind, source_id, message_type
    ) values (
      v_original.shop_client_id,
      'ledger_entry',
      v_correction_id,
      'correction_notice'
    );
  end if;

  return v_correction_id;
end;
$$;

create or replace function public.change_dispute_state(
  p_ledger_entry_id uuid,
  p_event_type text,
  p_note text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.ledger_entries%rowtype;
  v_existing public.dispute_events%rowtype;
  v_last_type text;
  v_event_id uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_event_type not in ('opened', 'withdrawn') then
    raise exception 'event type must be opened or withdrawn';
  end if;

  select * into v_existing
  from public.dispute_events
  where actor_auth_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.ledger_entry_id <> p_ledger_entry_id
       or v_existing.event_type <> p_event_type
       or v_existing.note is distinct from p_note then
      raise exception 'idempotency key reused with a different command';
    end if;
    return v_existing.id;
  end if;

  select le.* into v_entry
  from public.ledger_entries le
  join public.shop_clients sc on sc.id = le.shop_client_id
  join public.client_identities ci on ci.id = sc.client_identity_id
  where le.id = p_ledger_entry_id
    and le.entry_type <> 'correction'
    and sc.archived_at is null
    and ci.auth_user_id = v_actor
  for update of le;

  if not found then raise exception 'entry not found or not authorized'; end if;

  if exists (
    select 1 from public.ledger_entries
    where reverses_entry_id = p_ledger_entry_id
  ) then
    raise exception 'a corrected entry cannot be disputed';
  end if;

  select event_type into v_last_type
  from public.dispute_events
  where ledger_entry_id = p_ledger_entry_id
  order by recorded_at desc, sequence_number desc
  limit 1;

  if p_event_type = 'opened' and v_last_type is not null and v_last_type <> 'withdrawn' then
    raise exception 'dispute is already open or permanently resolved';
  elsif p_event_type = 'withdrawn' and v_last_type is distinct from 'opened' then
    raise exception 'only an open dispute can be withdrawn';
  end if;

  insert into public.dispute_events (
    shop_id, shop_client_id, ledger_entry_id, event_type, note,
    actor_auth_user_id, idempotency_key
  ) values (
    v_entry.shop_id,
    v_entry.shop_client_id,
    v_entry.id,
    p_event_type,
    p_note,
    v_actor,
    p_idempotency_key
  )
  returning id into v_event_id;

  insert into public.message_outbox (
    shop_client_id, source_kind, source_id, message_type
  ) values (
    v_entry.shop_client_id,
    'dispute_event',
    v_event_id,
    'dispute_notice'
  );

  return v_event_id;
end;
$$;

-- Called by Railway only after Twilio Verify has confirmed the phone number.
create or replace function public.register_verified_client_identity(
  p_auth_user_id uuid,
  p_phone_e164 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity public.client_identities%rowtype;
begin
  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid E.164 phone number';
  end if;

  perform 1 from auth.users where id = p_auth_user_id;
  if not found then raise exception 'auth user not found'; end if;

  select * into v_identity
  from public.client_identities
  where phone_e164 = p_phone_e164
  for update;

  if found then
    if v_identity.auth_user_id is not null
       and v_identity.auth_user_id <> p_auth_user_id then
      raise exception 'phone number already belongs to another identity';
    end if;

    update public.client_identities
    set auth_user_id = p_auth_user_id,
        verified_at = now()
    where id = v_identity.id;
    return v_identity.id;
  end if;

  if exists (
    select 1 from public.client_identities
    where auth_user_id = p_auth_user_id
  ) then
    raise exception 'auth user already has another verified phone number';
  end if;

  insert into public.client_identities (
    phone_e164, auth_user_id, verified_at
  ) values (
    p_phone_e164, p_auth_user_id, now()
  )
  returning id into v_identity.id;

  return v_identity.id;
end;
$$;

-- The caller claims every unclaimed local record matching their verified phone.
create or replace function public.claim_shop_clients()
returns table (shop_client_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_identity public.client_identities%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select * into v_identity
  from public.client_identities
  where auth_user_id = v_actor;

  if not found then raise exception 'verified client identity not found'; end if;

  perform 1
  from public.shop_clients
  where phone_e164 = v_identity.phone_e164
    and client_identity_id is not null
    and client_identity_id <> v_identity.id;

  if found then
    raise exception 'a matching shop client belongs to another identity';
  end if;

  return query
  update public.shop_clients sc
  set client_identity_id = v_identity.id,
      claimed_at = coalesce(sc.claimed_at, now())
  where sc.phone_e164 = v_identity.phone_e164
    and sc.archived_at is null
    and (sc.client_identity_id is null or sc.client_identity_id = v_identity.id)
  returning sc.id;
end;
$$;

create or replace function public.archive_shop_client(p_shop_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  update public.shop_clients sc
  set archived_at = coalesce(sc.archived_at, now())
  from public.shops s
  where sc.id = p_shop_client_id
    and s.id = sc.shop_id
    and s.auth_user_id = v_actor
    and s.archived_at is null;

  if not found then raise exception 'shop client not found or not authorized'; end if;
end;
$$;

create or replace function public.create_share_link(
  p_shop_client_id uuid,
  p_ttl interval default interval '30 days'
)
returns table (share_link_id uuid, valid_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_link_id uuid;
  v_expires_at timestamptz;
  v_phone text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_ttl < interval '5 minutes' or p_ttl > interval '90 days' then
    raise exception 'share link lifetime must be between 5 minutes and 90 days';
  end if;

  select sc.phone_e164 into v_phone
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = p_shop_client_id
    and sc.archived_at is null
    and s.archived_at is null
    and s.auth_user_id = v_actor
  for update of sc;

  if not found then raise exception 'shop client not found or not authorized'; end if;
  if v_phone is null then raise exception 'client needs a normalized phone number'; end if;

  update public.share_links
  set revoked_at = now()
  where shop_client_id = p_shop_client_id
    and revoked_at is null;

  v_expires_at := now() + p_ttl;

  insert into public.share_links (
    shop_client_id, created_by_auth_user_id, expires_at
  ) values (
    p_shop_client_id, v_actor, v_expires_at
  )
  returning id into v_link_id;

  insert into public.message_outbox (
    shop_client_id, source_kind, source_id, message_type
  ) values (
    p_shop_client_id, 'share_link', v_link_id, 'share_link'
  );

  return query select v_link_id, v_expires_at;
end;
$$;

create or replace function public.revoke_share_link(p_share_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  update public.share_links sl
  set revoked_at = coalesce(sl.revoked_at, now())
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sl.id = p_share_link_id
    and sc.id = sl.shop_client_id
    and s.auth_user_id = v_actor;

  if not found then raise exception 'share link not found or not authorized'; end if;
end;
$$;

-- Railway verifies the HMAC signature before calling this service-role-only RPC.
create or replace function public.read_shared_ledger(p_share_link_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform 1
  from public.share_links
  where id = p_share_link_id
    and revoked_at is null
    and expires_at > now();

  if not found then raise exception 'share link is invalid, revoked, or expired'; end if;

  select jsonb_build_object(
    'shop', jsonb_build_object('name', s.name, 'phone_e164', s.phone_e164),
    'client', jsonb_build_object('name', sc.name),
    'balance', to_jsonb(b) - 'shop_client_id' - 'shop_id',
    'timeline', coalesce(
      (
        select jsonb_agg(
          to_jsonb(t) - 'shop_client_id'
          order by t.event_at, t.source, t.source_sequence, t.event_id
        )
        from public.client_timeline t
        where t.shop_client_id = sc.id
      ),
      '[]'::jsonb
    )
  ) into v_result
  from public.share_links sl
  join public.shop_clients sc on sc.id = sl.shop_client_id
  join public.shops s on s.id = sc.shop_id
  join public.shop_client_balances b on b.shop_client_id = sc.id
  where sl.id = p_share_link_id;

  return v_result;
end;
$$;

-- ============================================================================
-- OUTBOX WORKER RPC FUNCTIONS
-- ============================================================================

create or replace function public.claim_outbox_messages(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.message_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100';
  end if;
  if p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'lease must be between 10 and 900 seconds';
  end if;

  return query
  with candidates as (
    select mo.id
    from public.message_outbox mo
    where (
      mo.status in ('pending', 'retry_wait')
      and mo.available_at <= now()
    ) or (
      mo.status = 'processing'
      and mo.locked_until <= now()
    )
    order by mo.available_at, mo.created_at
    limit p_limit
    for update skip locked
  )
  update public.message_outbox mo
  set status = 'processing',
      attempts = mo.attempts + 1,
      locked_by = p_worker_id,
      locked_until = now() + (p_lease_seconds * interval '1 second'),
      last_error = null
  from candidates c
  where mo.id = c.id
  returning mo.*;
end;
$$;

create or replace function public.mark_outbox_sent(
  p_message_id uuid,
  p_worker_id text,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_outbox
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = now(),
      locked_by = null,
      locked_until = null,
      last_error = null
  where id = p_message_id
    and status = 'processing'
    and locked_by = p_worker_id;

  if not found then raise exception 'message is not leased by this worker'; end if;
end;
$$;

create or replace function public.mark_outbox_failed(
  p_message_id uuid,
  p_worker_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_outbox
  set status = case when attempts >= 8 then 'dead' else 'retry_wait' end,
      available_at = now() + (
        least(3600, 15 * power(2, least(greatest(attempts - 1, 0), 8))::integer)
        * interval '1 second'
      ),
      locked_by = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'unknown provider error'), 4000)
  where id = p_message_id
    and status = 'processing'
    and locked_by = p_worker_id;

  if not found then raise exception 'message is not leased by this worker'; end if;
end;
$$;

-- ============================================================================
-- EXPLICIT GRANTS
-- ============================================================================

revoke all on table public.shops from anon, authenticated, service_role;
revoke all on table public.client_identities from anon, authenticated, service_role;
revoke all on table public.shop_clients from anon, authenticated, service_role;
revoke all on table public.ledger_entries from anon, authenticated, service_role;
revoke all on table public.dispute_events from anon, authenticated, service_role;
revoke all on table public.share_links from anon, authenticated, service_role;
revoke all on table public.message_outbox from anon, authenticated, service_role;

grant select on table public.shops to authenticated, service_role;
grant insert (auth_user_id, name, phone_e164)
  on table public.shops to authenticated;
grant update (name, phone_e164)
  on table public.shops to authenticated;

grant select (id, phone_e164, auth_user_id, verified_at, created_at)
  on table public.client_identities to authenticated, service_role;

grant select on table public.shop_clients to authenticated, service_role;
grant insert (shop_id, name, phone_raw, phone_e164, avatar_url)
  on table public.shop_clients to authenticated;
grant update (name, phone_raw, phone_e164, avatar_url)
  on table public.shop_clients to authenticated;

grant select (
  id, sequence_number, shop_id, shop_client_id, entry_type, amount_xof,
  reverses_entry_id, title, detail, occurred_at, recorded_at
) on table public.ledger_entries to authenticated;
grant select on table public.ledger_entries to service_role;

grant select (
  id, sequence_number, shop_id, shop_client_id, ledger_entry_id,
  event_type, note, recorded_at
) on table public.dispute_events to authenticated;
grant select on table public.dispute_events to service_role;

grant select on table public.share_links to service_role;
grant select on table public.message_outbox to service_role;

grant select on table public.shop_client_balances to authenticated, service_role;
grant select on table public.client_timeline to authenticated, service_role;

revoke execute on function private.protect_claimed_client_identity() from public, anon, authenticated, service_role;
revoke execute on function private.enforce_correction_integrity() from public, anon, authenticated, service_role;
revoke execute on function private.enforce_dispute_target() from public, anon, authenticated, service_role;
revoke execute on function private.reject_event_mutation() from public, anon, authenticated, service_role;

revoke execute on function public.record_debt(uuid, text, text, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.record_repayment(uuid, text, text, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.correct_entry(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.change_dispute_state(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.register_verified_client_identity(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_shop_clients()
  from public, anon, authenticated, service_role;
revoke execute on function public.archive_shop_client(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_share_link(uuid, interval)
  from public, anon, authenticated, service_role;
revoke execute on function public.revoke_share_link(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.read_shared_ledger(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.claim_outbox_messages(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_outbox_sent(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_outbox_failed(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.record_debt(uuid, text, text, bigint, uuid)
  to authenticated;
grant execute on function public.record_repayment(uuid, text, text, bigint, uuid)
  to authenticated;
grant execute on function public.correct_entry(uuid, text, uuid)
  to authenticated;
grant execute on function public.change_dispute_state(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.claim_shop_clients()
  to authenticated;
grant execute on function public.archive_shop_client(uuid)
  to authenticated;
grant execute on function public.create_share_link(uuid, interval)
  to authenticated;
grant execute on function public.revoke_share_link(uuid)
  to authenticated;

grant execute on function public.register_verified_client_identity(uuid, text)
  to service_role;
grant execute on function public.read_shared_ledger(uuid)
  to service_role;
grant execute on function public.claim_outbox_messages(text, integer, integer)
  to service_role;
grant execute on function public.mark_outbox_sent(uuid, text, text)
  to service_role;
grant execute on function public.mark_outbox_failed(uuid, text, text)
  to service_role;

comment on table public.ledger_entries is
  'Immutable financial source of truth. Corrections are exact inverse entries.';
comment on table public.dispute_events is
  'Immutable dispute state transitions. Current state is derived from the latest event.';
comment on table public.share_links is
  'Revocable link identifiers signed by Railway; no bearer token is stored in PostgreSQL.';
comment on function public.read_shared_ledger(uuid) is
  'Service-role-only. Railway must verify the HMAC signature and apply private, no-store HTTP caching.';

commit;
