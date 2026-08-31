begin;

-- Product architecture: one immutable journal shared by one shop and one client.
-- This migration is additive so existing ledger history remains untouched.

-- ============================================================================
-- CLIENT PROFILE AND REVOCABLE SHOP QR IDENTITY
-- ============================================================================

create table public.client_profiles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (btrim(display_name) <> '' and char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shop_public_codes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  code_prefix text not null check (code_prefix ~ '^[A-Za-z0-9_-]{4,12}$'),
  created_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= created_at)
);

create unique index shop_public_codes_one_active_per_shop
  on public.shop_public_codes (shop_id)
  where revoked_at is null;
create index shop_public_codes_active_hash
  on public.shop_public_codes (code_hash)
  where revoked_at is null;

-- Only a hash of the QR secret is persisted. The Worker returns the raw secret once.
comment on table public.shop_public_codes is
  'Permanent, revocable shop QR identities. Raw QR secrets are never stored.';

-- ============================================================================
-- ENRICHED JOURNAL AND IMMUTABLE FIFO ALLOCATION EVENTS
-- ============================================================================

alter table public.ledger_entries
  add column due_on date,
  add column source_channel text not null default 'app'
    check (source_channel in ('app', 'shop_qr', 'whatsapp_assisted', 'shared_link')),
  add column client_reference text
    check (client_reference is null or char_length(client_reference) <= 80),
  add column possible_duplicate_of uuid
    references public.ledger_entries(id) on delete restrict,
  add column recorded_by_role text
    check (recorded_by_role in ('shop', 'client'));

update public.ledger_entries le
set recorded_by_role = case
  when exists (
    select 1 from public.shops s
    where s.id = le.shop_id and s.auth_user_id = le.actor_auth_user_id
  ) then 'shop'
  else 'client'
end;

alter table public.ledger_entries
  alter column recorded_by_role set not null,
  add constraint ledger_due_date_debt_only
    check (due_on is null or entry_type = 'debt'),
  add constraint ledger_duplicate_not_self
    check (possible_duplicate_of is null or possible_duplicate_of <> id);

create index ledger_probable_duplicate_idx
  on public.ledger_entries (
    shop_client_id,
    entry_type,
    amount_xof,
    recorded_at desc
  )
  where entry_type in ('debt', 'repayment');

create table public.repayment_allocation_events (
  id uuid primary key default gen_random_uuid(),
  sequence_number bigint generated always as identity unique,
  shop_id uuid not null,
  shop_client_id uuid not null,
  repayment_entry_id uuid not null,
  debt_entry_id uuid not null,
  event_type text not null check (event_type in ('allocated', 'released')),
  amount_xof bigint not null check (amount_xof > 0),
  reverses_event_id uuid references public.repayment_allocation_events(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  constraint allocation_repayment_tenant_fk
    foreign key (repayment_entry_id, shop_id, shop_client_id)
    references public.ledger_entries(id, shop_id, shop_client_id)
    on delete restrict,
  constraint allocation_debt_tenant_fk
    foreign key (debt_entry_id, shop_id, shop_client_id)
    references public.ledger_entries(id, shop_id, shop_client_id)
    on delete restrict,
  constraint allocation_event_shape check (
    (event_type = 'allocated' and reverses_event_id is null)
    or (event_type = 'released' and reverses_event_id is not null)
  )
);

create unique index allocation_one_release_per_event
  on public.repayment_allocation_events (reverses_event_id)
  where reverses_event_id is not null;
create index allocation_debt_timeline_idx
  on public.repayment_allocation_events (debt_entry_id, recorded_at, sequence_number);
create index allocation_repayment_timeline_idx
  on public.repayment_allocation_events (repayment_entry_id, recorded_at, sequence_number);

create trigger trg_allocations_append_only
before update or delete on public.repayment_allocation_events
for each row execute function private.reject_event_mutation();

alter table public.message_outbox
  add column recipient_role text check (recipient_role in ('shop', 'client')),
  add column recipient_phone_e164 text check (
    recipient_phone_e164 is null or recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  );

-- ============================================================================
-- SHARED AUTHORIZATION HELPERS
-- ============================================================================

create or replace function private.relationship_actor_role(
  p_shop_client_id uuid,
  p_actor uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.auth_user_id = p_actor then 'shop'::text
    when ci.auth_user_id = p_actor then 'client'::text
    else null::text
  end
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  left join public.client_identities ci on ci.id = sc.client_identity_id
  where sc.id = p_shop_client_id
    and sc.archived_at is null
    and s.archived_at is null;
$$;

create or replace function private.allocate_repayment_fifo(p_repayment_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repayment public.ledger_entries%rowtype;
  v_remaining bigint;
  v_debt record;
  v_amount bigint;
begin
  select * into v_repayment
  from public.ledger_entries
  where id = p_repayment_entry_id
    and entry_type = 'repayment'
  for update;

  if not found then raise exception 'repayment entry not found'; end if;
  select -v_repayment.amount_xof - coalesce(sum(
    case event_type when 'allocated' then amount_xof else -amount_xof end
  ), 0)
  into v_remaining
  from public.repayment_allocation_events
  where repayment_entry_id = v_repayment.id;

  if v_remaining <= 0 then return; end if;

  for v_debt in
    select
      debt.id,
      debt.amount_xof - coalesce(sum(
        case ae.event_type when 'allocated' then ae.amount_xof else -ae.amount_xof end
      ), 0) as remaining_xof
    from public.ledger_entries debt
    left join public.repayment_allocation_events ae on ae.debt_entry_id = debt.id
    where debt.shop_client_id = v_repayment.shop_client_id
      and debt.entry_type = 'debt'
      and debt.occurred_at <= v_repayment.occurred_at
      and not exists (
        select 1 from public.ledger_entries correction
        where correction.reverses_entry_id = debt.id
      )
    group by debt.id, debt.amount_xof, debt.occurred_at, debt.sequence_number
    having debt.amount_xof > coalesce(sum(
      case ae.event_type when 'allocated' then ae.amount_xof else -ae.amount_xof end
    ), 0)
    order by debt.occurred_at, debt.sequence_number
  loop
    exit when v_remaining = 0;
    v_amount := least(v_remaining, v_debt.remaining_xof);

    insert into public.repayment_allocation_events (
      shop_id,
      shop_client_id,
      repayment_entry_id,
      debt_entry_id,
      event_type,
      amount_xof
    ) values (
      v_repayment.shop_id,
      v_repayment.shop_client_id,
      v_repayment.id,
      v_debt.id,
      'allocated',
      v_amount
    );

    v_remaining := v_remaining - v_amount;
  end loop;
end;
$$;

create or replace function private.release_debt_allocations(p_debt_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repayment_id uuid;
begin
  for v_repayment_id in
    select distinct ae.repayment_entry_id
    from public.repayment_allocation_events ae
    where ae.debt_entry_id = p_debt_entry_id
      and ae.event_type = 'allocated'
      and not exists (
        select 1 from public.repayment_allocation_events released
        where released.reverses_event_id = ae.id
      )
  loop
    insert into public.repayment_allocation_events (
      shop_id,
      shop_client_id,
      repayment_entry_id,
      debt_entry_id,
      event_type,
      amount_xof,
      reverses_event_id
    )
    select
      ae.shop_id,
      ae.shop_client_id,
      ae.repayment_entry_id,
      ae.debt_entry_id,
      'released',
      ae.amount_xof,
      ae.id
    from public.repayment_allocation_events ae
    where ae.debt_entry_id = p_debt_entry_id
      and ae.repayment_entry_id = v_repayment_id
      and ae.event_type = 'allocated'
      and not exists (
        select 1 from public.repayment_allocation_events released
        where released.reverses_event_id = ae.id
      );

    perform private.allocate_repayment_fifo(v_repayment_id);
  end loop;
end;
$$;

create or replace function private.release_repayment_allocations(p_repayment_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.repayment_allocation_events (
    shop_id,
    shop_client_id,
    repayment_entry_id,
    debt_entry_id,
    event_type,
    amount_xof,
    reverses_event_id
  )
  select
    ae.shop_id,
    ae.shop_client_id,
    ae.repayment_entry_id,
    ae.debt_entry_id,
    'released',
    ae.amount_xof,
    ae.id
  from public.repayment_allocation_events ae
  where ae.repayment_entry_id = p_repayment_entry_id
    and ae.event_type = 'allocated'
    and not exists (
      select 1 from public.repayment_allocation_events released
      where released.reverses_event_id = ae.id
    );
end;
$$;

-- ============================================================================
-- READ PROJECTIONS: ALLOCATIONS, RELATION SUMMARY, AND CLIENT-ONLY TRUST SCORE
-- ============================================================================

create view public.repayment_allocation_totals
with (security_invoker = true)
as
select
  shop_id,
  shop_client_id,
  repayment_entry_id,
  debt_entry_id,
  sum(
    case event_type when 'allocated' then amount_xof else -amount_xof end
  )::bigint as allocated_xof
from public.repayment_allocation_events
group by shop_id, shop_client_id, repayment_entry_id, debt_entry_id
having sum(
  case event_type when 'allocated' then amount_xof else -amount_xof end
) <> 0;

create view public.debt_repayment_metrics
with (security_invoker = true)
as
select
  debt.shop_id,
  debt.shop_client_id,
  debt.id as debt_entry_id,
  debt.amount_xof as debt_amount_xof,
  debt.due_on,
  debt.occurred_at,
  coalesce(alloc.allocated_xof, 0)::bigint as repaid_xof,
  greatest(debt.amount_xof - coalesce(alloc.allocated_xof, 0), 0)::bigint
    as remaining_xof,
  alloc.settled_at,
  coalesce(dispute.is_disputed, false) as is_disputed,
  exists (
    select 1 from public.ledger_entries correction
    where correction.reverses_entry_id = debt.id
  ) as is_corrected
from public.ledger_entries debt
left join lateral (
  select
    sum(case ae.event_type when 'allocated' then ae.amount_xof else -ae.amount_xof end)::bigint
      as allocated_xof,
    max(ae.recorded_at) filter (where ae.event_type = 'allocated') as settled_at
  from public.repayment_allocation_events ae
  where ae.debt_entry_id = debt.id
) alloc on true
left join lateral (
  select de.event_type = 'opened' as is_disputed
  from public.dispute_events de
  where de.ledger_entry_id = debt.id
  order by de.recorded_at desc, de.sequence_number desc
  limit 1
) dispute on true
where debt.entry_type = 'debt';

create view public.client_trust_metrics
with (security_invoker = true)
as
select
  sc.shop_id,
  sc.id as shop_client_id,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
  )::integer as eligible_debt_count,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.remaining_xof = 0
  )::integer as settled_debt_count,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.remaining_xof = 0 and dm.due_on is not null
  )::integer as due_dated_settled_count,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.remaining_xof = 0 and dm.due_on is not null
      and dm.settled_at::date <= dm.due_on
  )::integer as on_time_settled_count,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.remaining_xof > 0 and dm.due_on < current_date
  )::integer as active_overdue_count,
  count(dm.debt_entry_id) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.repaid_xof > 0 and dm.remaining_xof > 0
  )::integer as partially_repaid_count,
  round(avg(
    extract(epoch from (dm.settled_at - dm.occurred_at)) / 86400.0
  ) filter (
    where not dm.is_corrected and not dm.is_disputed
      and dm.remaining_xof = 0
  ), 1) as average_days_to_settle
from public.shop_clients sc
left join public.debt_repayment_metrics dm on dm.shop_client_id = sc.id
where current_user = 'service_role'
   or exists (
     select 1
     from public.client_identities ci
     where ci.id = sc.client_identity_id
       and ci.auth_user_id = (select auth.uid())
   )
group by sc.shop_id, sc.id;

create view public.client_trust_scores
with (security_invoker = true)
as
select
  metrics.*,
  case
    when settled_debt_count < 3 then null::smallint
    else round(greatest(0, least(100,
      35.0 * settled_debt_count
        / greatest(settled_debt_count + active_overdue_count, 1)
      + case
          when due_dated_settled_count = 0 then 18
          else 30.0 * on_time_settled_count / due_dated_settled_count
        end
      + case
          when average_days_to_settle is null then 8
          when average_days_to_settle <= 7 then 20
          when average_days_to_settle <= 30 then 14
          when average_days_to_settle <= 60 then 8
          else 3
        end
      + least(partially_repaid_count, 5) * 2
    )))::smallint
  end as trust_score,
  case
    when settled_debt_count < 3 then 'new'
    when round(greatest(0, least(100,
      35.0 * settled_debt_count
        / greatest(settled_debt_count + active_overdue_count, 1)
      + case
          when due_dated_settled_count = 0 then 18
          else 30.0 * on_time_settled_count / due_dated_settled_count
        end
      + case
          when average_days_to_settle is null then 8
          when average_days_to_settle <= 7 then 20
          when average_days_to_settle <= 30 then 14
          when average_days_to_settle <= 60 then 8
          else 3
        end
      + least(partially_repaid_count, 5) * 2
    ))) >= 80 then 'reliable'
    when round(greatest(0, least(100,
      35.0 * settled_debt_count
        / greatest(settled_debt_count + active_overdue_count, 1)
      + case
          when due_dated_settled_count = 0 then 18
          else 30.0 * on_time_settled_count / due_dated_settled_count
        end
      + case
          when average_days_to_settle is null then 8
          when average_days_to_settle <= 7 then 20
          when average_days_to_settle <= 30 then 14
          when average_days_to_settle <= 60 then 8
          else 3
        end
      + least(partially_repaid_count, 5) * 2
    ))) >= 60 then 'regular'
    else 'watch'
  end as trust_status
from public.client_trust_metrics metrics;

comment on view public.client_trust_scores is
  'Advisory client score scoped to one shop-client relationship; never an automatic credit decision.';

-- ============================================================================
-- TRANSACTIONAL COMMANDS
-- ============================================================================

create or replace function public.record_operation(
  p_shop_client_id uuid,
  p_entry_type text,
  p_title text,
  p_detail text,
  p_amount_xof bigint,
  p_due_on date,
  p_occurred_at timestamptz,
  p_source_channel text,
  p_client_reference text,
  p_idempotency_key uuid,
  p_duplicate_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_shop_id uuid;
  v_client_phone text;
  v_shop_phone text;
  v_client_verified boolean;
  v_signed_amount bigint;
  v_entry_id uuid;
  v_duplicate_id uuid;
  v_existing public.ledger_entries%rowtype;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_source_channel text := coalesce(p_source_channel, 'app');
  v_recipient_role text;
  v_recipient_phone text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_entry_type not in ('debt', 'repayment') then
    raise exception 'entry type must be debt or repayment';
  end if;
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > 200 then
    raise exception 'title is required and must not exceed 200 characters';
  end if;
  if p_amount_xof <= 0 then raise exception 'amount must be positive'; end if;
  if v_source_channel not in ('app', 'shop_qr', 'whatsapp_assisted', 'shared_link') then
    raise exception 'invalid source channel';
  end if;
  if v_occurred_at > now() + interval '5 minutes'
     or v_occurred_at < now() - interval '1 year' then
    raise exception 'operation date is outside the allowed range';
  end if;
  if p_entry_type = 'repayment' and p_due_on is not null then
    raise exception 'only a debt can have a due date';
  end if;
  if p_entry_type = 'debt' and p_due_on is not null
     and p_due_on < v_occurred_at::date then
    raise exception 'due date cannot be before the operation date';
  end if;

  select
    sc.shop_id,
    sc.phone_e164,
    s.phone_e164,
    sc.client_identity_id is not null
  into v_shop_id, v_client_phone, v_shop_phone, v_client_verified
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = p_shop_client_id
    and sc.archived_at is null
    and s.archived_at is null
  for update of sc;

  if not found then raise exception 'shop client not found'; end if;

  v_actor_role := private.relationship_actor_role(p_shop_client_id, v_actor);
  if v_actor_role is null then raise exception 'relationship access denied'; end if;

  v_signed_amount := case
    when p_entry_type = 'debt' then p_amount_xof
    else -p_amount_xof
  end;

  select * into v_existing
  from public.ledger_entries
  where actor_auth_user_id = v_actor
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.entry_type <> p_entry_type
       or v_existing.shop_client_id <> p_shop_client_id
       or v_existing.amount_xof <> v_signed_amount
       or v_existing.title <> btrim(p_title)
       or v_existing.detail is distinct from nullif(btrim(p_detail), '')
       or v_existing.due_on is distinct from p_due_on
       or v_existing.source_channel <> v_source_channel
       or v_existing.client_reference is distinct from nullif(btrim(p_client_reference), '') then
      raise exception 'idempotency key reused with a different command';
    end if;

    return jsonb_build_object(
      'entry_id', v_existing.id,
      'recorded', true,
      'idempotent_replay', true,
      'possible_duplicate_of', v_existing.possible_duplicate_of
    );
  end if;

  select candidate.id into v_duplicate_id
  from public.ledger_entries candidate
  where candidate.shop_client_id = p_shop_client_id
    and candidate.entry_type = p_entry_type
    and candidate.amount_xof = v_signed_amount
    and lower(regexp_replace(btrim(candidate.title), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(p_title), '\s+', ' ', 'g'))
    and candidate.recorded_at >= now() - interval '10 minutes'
    and not exists (
      select 1 from public.ledger_entries correction
      where correction.reverses_entry_id = candidate.id
    )
  order by candidate.recorded_at desc, candidate.sequence_number desc
  limit 1;

  if v_duplicate_id is not null and not p_duplicate_override then
    return jsonb_build_object(
      'recorded', false,
      'reason', 'probable_duplicate',
      'possible_duplicate_of', v_duplicate_id
    );
  end if;

  insert into public.ledger_entries (
    shop_id,
    shop_client_id,
    entry_type,
    amount_xof,
    title,
    detail,
    due_on,
    occurred_at,
    actor_auth_user_id,
    idempotency_key,
    source_channel,
    client_reference,
    possible_duplicate_of,
    recorded_by_role
  ) values (
    v_shop_id,
    p_shop_client_id,
    p_entry_type,
    v_signed_amount,
    btrim(p_title),
    nullif(btrim(p_detail), ''),
    p_due_on,
    v_occurred_at,
    v_actor,
    p_idempotency_key,
    v_source_channel,
    nullif(btrim(p_client_reference), ''),
    case when p_duplicate_override then v_duplicate_id else null end,
    v_actor_role
  )
  returning id into v_entry_id;

  if p_entry_type = 'repayment' then
    perform private.allocate_repayment_fifo(v_entry_id);
  end if;

  v_recipient_role := case v_actor_role when 'shop' then 'client' else 'shop' end;
  v_recipient_phone := case v_actor_role when 'shop' then v_client_phone else v_shop_phone end;

  if v_recipient_phone is not null then
    insert into public.message_outbox (
      shop_client_id,
      source_kind,
      source_id,
      message_type,
      payload,
      recipient_role,
      recipient_phone_e164
    ) values (
      p_shop_client_id,
      'ledger_entry',
      v_entry_id,
      case p_entry_type when 'debt' then 'debt_receipt' else 'payment_receipt' end,
      jsonb_build_object(
        'recorded_by_role', v_actor_role,
        'include_financial_details', v_recipient_role = 'shop' or v_client_verified
      ),
      v_recipient_role,
      v_recipient_phone
    );
  end if;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'recorded', true,
    'idempotent_replay', false,
    'possible_duplicate_of', case when p_duplicate_override then v_duplicate_id else null end
  );
end;
$$;

create or replace function public.record_debt(
  p_shop_client_id uuid,
  p_title text,
  p_detail text,
  p_amount_xof bigint,
  p_idempotency_key uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select (public.record_operation(
    p_shop_client_id,
    'debt',
    p_title,
    p_detail,
    p_amount_xof,
    null,
    null,
    'app',
    null,
    p_idempotency_key,
    true
  )->>'entry_id')::uuid;
$$;

create or replace function public.record_repayment(
  p_shop_client_id uuid,
  p_title text,
  p_detail text,
  p_amount_xof bigint,
  p_idempotency_key uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select (public.record_operation(
    p_shop_client_id,
    'repayment',
    p_title,
    p_detail,
    p_amount_xof,
    null,
    null,
    'app',
    null,
    p_idempotency_key,
    true
  )->>'entry_id')::uuid;
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
  v_actor_role text;
  v_original public.ledger_entries%rowtype;
  v_existing public.ledger_entries%rowtype;
  v_correction_id uuid;
  v_last_dispute_type text;
  v_client_phone text;
  v_shop_phone text;
  v_client_verified boolean;
  v_recipient_role text;
  v_recipient_phone text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'correction reason is required';
  end if;

  select le.* into v_original
  from public.ledger_entries le
  where le.id = p_original_entry_id
    and le.entry_type <> 'correction'
  for update;

  if not found then raise exception 'entry not found'; end if;

  perform 1 from public.shop_clients sc
  where sc.id = v_original.shop_client_id
  for update;

  v_actor_role := private.relationship_actor_role(v_original.shop_client_id, v_actor);
  if v_actor_role is null then raise exception 'relationship access denied'; end if;
  if v_actor_role <> 'shop' and v_original.actor_auth_user_id <> v_actor then
    raise exception 'only the recording party or the shop can correct this entry';
  end if;

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
    shop_id,
    shop_client_id,
    entry_type,
    amount_xof,
    reverses_entry_id,
    title,
    detail,
    actor_auth_user_id,
    idempotency_key,
    source_channel,
    recorded_by_role
  ) values (
    v_original.shop_id,
    v_original.shop_client_id,
    'correction',
    -v_original.amount_xof,
    v_original.id,
    'Correction: ' || v_original.title,
    btrim(p_reason),
    v_actor,
    p_idempotency_key,
    v_original.source_channel,
    v_actor_role
  )
  returning id into v_correction_id;

  if v_original.entry_type = 'repayment' then
    perform private.release_repayment_allocations(v_original.id);
  else
    perform private.release_debt_allocations(v_original.id);
  end if;

  select event_type into v_last_dispute_type
  from public.dispute_events
  where ledger_entry_id = v_original.id
  order by recorded_at desc, sequence_number desc
  limit 1;

  if v_last_dispute_type = 'opened' then
    insert into public.dispute_events (
      shop_id,
      shop_client_id,
      ledger_entry_id,
      event_type,
      note,
      actor_auth_user_id,
      idempotency_key
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

  select sc.phone_e164, s.phone_e164, sc.client_identity_id is not null
  into v_client_phone, v_shop_phone, v_client_verified
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = v_original.shop_client_id;

  v_recipient_role := case v_actor_role when 'shop' then 'client' else 'shop' end;
  v_recipient_phone := case v_actor_role when 'shop' then v_client_phone else v_shop_phone end;

  if v_recipient_phone is not null then
    insert into public.message_outbox (
      shop_client_id,
      source_kind,
      source_id,
      message_type,
      payload,
      recipient_role,
      recipient_phone_e164
    ) values (
      v_original.shop_client_id,
      'ledger_entry',
      v_correction_id,
      'correction_notice',
      jsonb_build_object(
        'recorded_by_role', v_actor_role,
        'include_financial_details', v_recipient_role = 'shop' or v_client_verified
      ),
      v_recipient_role,
      v_recipient_phone
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
  v_actor_role text;
  v_entry public.ledger_entries%rowtype;
  v_existing public.dispute_events%rowtype;
  v_last public.dispute_events%rowtype;
  v_event_id uuid;
  v_client_phone text;
  v_shop_phone text;
  v_recipient_role text;
  v_recipient_phone text;
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

  select * into v_entry
  from public.ledger_entries
  where id = p_ledger_entry_id
    and entry_type <> 'correction'
  for update;

  if not found then raise exception 'entry not found'; end if;

  perform 1 from public.shop_clients
  where id = v_entry.shop_client_id
  for update;

  v_actor_role := private.relationship_actor_role(v_entry.shop_client_id, v_actor);
  if v_actor_role is null then raise exception 'relationship access denied'; end if;

  if exists (
    select 1 from public.ledger_entries
    where reverses_entry_id = p_ledger_entry_id
  ) then
    raise exception 'a corrected entry cannot be disputed';
  end if;

  select * into v_last
  from public.dispute_events
  where ledger_entry_id = p_ledger_entry_id
  order by recorded_at desc, sequence_number desc
  limit 1;

  if p_event_type = 'opened' then
    if v_entry.recorded_by_role = v_actor_role then
      raise exception 'the recording party cannot dispute its own operation';
    end if;
    if v_last.event_type is not null and v_last.event_type <> 'withdrawn' then
      raise exception 'dispute is already open or permanently resolved';
    end if;
  elsif v_last.event_type is distinct from 'opened'
     or v_last.actor_auth_user_id <> v_actor then
    raise exception 'only the party with an open dispute can withdraw it';
  end if;

  insert into public.dispute_events (
    shop_id,
    shop_client_id,
    ledger_entry_id,
    event_type,
    note,
    actor_auth_user_id,
    idempotency_key
  ) values (
    v_entry.shop_id,
    v_entry.shop_client_id,
    v_entry.id,
    p_event_type,
    nullif(btrim(p_note), ''),
    v_actor,
    p_idempotency_key
  )
  returning id into v_event_id;

  select sc.phone_e164, s.phone_e164
  into v_client_phone, v_shop_phone
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  where sc.id = v_entry.shop_client_id;

  v_recipient_role := case v_actor_role when 'shop' then 'client' else 'shop' end;
  v_recipient_phone := case v_actor_role when 'shop' then v_client_phone else v_shop_phone end;

  if v_recipient_phone is not null then
    insert into public.message_outbox (
      shop_client_id,
      source_kind,
      source_id,
      message_type,
      recipient_role,
      recipient_phone_e164
    ) values (
      v_entry.shop_client_id,
      'dispute_event',
      v_event_id,
      'dispute_notice',
      v_recipient_role,
      v_recipient_phone
    );
  end if;

  return v_event_id;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_client_profiles_updated_at
before update on public.client_profiles
for each row execute function private.touch_updated_at();

create or replace function public.upsert_client_profile(p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_display_name is null or btrim(p_display_name) = ''
     or char_length(btrim(p_display_name)) > 120 then
    raise exception 'display name is required and must not exceed 120 characters';
  end if;

  insert into public.client_profiles (auth_user_id, display_name)
  values (v_actor, btrim(p_display_name))
  on conflict (auth_user_id) do update
    set display_name = excluded.display_name;

  return v_actor;
end;
$$;

create or replace function public.rotate_shop_public_code(
  p_code_hash text,
  p_code_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_code_id uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code hash'; end if;
  if p_code_prefix !~ '^[A-Za-z0-9_-]{4,12}$' then raise exception 'invalid code prefix'; end if;

  select id into v_shop_id
  from public.shops
  where auth_user_id = v_actor
    and archived_at is null
  for update;

  if not found then raise exception 'active shop not found'; end if;

  update public.shop_public_codes
  set revoked_at = now()
  where shop_id = v_shop_id
    and revoked_at is null;

  insert into public.shop_public_codes (
    shop_id,
    code_hash,
    code_prefix,
    created_by_auth_user_id
  ) values (
    v_shop_id,
    p_code_hash,
    p_code_prefix,
    v_actor
  )
  returning id into v_code_id;

  return v_code_id;
end;
$$;

create or replace function public.connect_to_shop(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_identity public.client_identities%rowtype;
  v_profile public.client_profiles%rowtype;
  v_shop public.shops%rowtype;
  v_shop_client_id uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code hash'; end if;

  select * into v_identity
  from public.client_identities
  where auth_user_id = v_actor;

  if not found then raise exception 'verified client identity required'; end if;

  select * into v_profile
  from public.client_profiles
  where auth_user_id = v_actor;

  if not found then raise exception 'client profile required'; end if;

  select s.* into v_shop
  from public.shop_public_codes code
  join public.shops s on s.id = code.shop_id
  where code.code_hash = p_code_hash
    and code.revoked_at is null
    and s.archived_at is null
  for update of code;

  if not found then raise exception 'shop code is invalid or revoked'; end if;

  select id into v_shop_client_id
  from public.shop_clients
  where shop_id = v_shop.id
    and client_identity_id = v_identity.id
    and archived_at is null;

  if not found then
    select id into v_shop_client_id
    from public.shop_clients
    where shop_id = v_shop.id
      and phone_e164 = v_identity.phone_e164
      and client_identity_id is null
      and archived_at is null
    for update;

    if found then
      update public.shop_clients
      set client_identity_id = v_identity.id,
          claimed_at = now(),
          name = v_profile.display_name
      where id = v_shop_client_id;
    else
      insert into public.shop_clients (
        shop_id,
        name,
        phone_raw,
        phone_e164,
        client_identity_id,
        claimed_at
      ) values (
        v_shop.id,
        v_profile.display_name,
        v_identity.phone_e164,
        v_identity.phone_e164,
        v_identity.id,
        now()
      )
      returning id into v_shop_client_id;
    end if;
  end if;

  return jsonb_build_object(
    'shop_client_id', v_shop_client_id,
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'connected', true
  );
end;
$$;

create or replace function public.get_shop_summary(p_period text default 'today')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_since timestamptz;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select id into v_shop_id
  from public.shops
  where auth_user_id = v_actor
    and archived_at is null;

  if not found then raise exception 'active shop not found'; end if;

  v_since := case p_period
    when 'today' then date_trunc('day', now())
    when '7d' then now() - interval '7 days'
    when 'month' then date_trunc('month', now())
    when 'all' then '-infinity'::timestamptz
    else null
  end;

  if v_since is null then raise exception 'invalid summary period'; end if;

  with entries as (
    select le.*, original.entry_type as original_entry_type
    from public.ledger_entries le
    left join public.ledger_entries original on original.id = le.reverses_entry_id
    where le.shop_id = v_shop_id
  ), current_disputes as (
    select distinct on (de.ledger_entry_id)
      de.ledger_entry_id,
      de.event_type
    from public.dispute_events de
    where de.shop_id = v_shop_id
    order by de.ledger_entry_id, de.recorded_at desc, de.sequence_number desc
  )
  select jsonb_build_object(
    'period', p_period,
    'balance_total_xof', coalesce(sum(e.amount_xof), 0)::bigint,
    'balance_disputed_xof', coalesce(sum(e.amount_xof) filter (
      where d.event_type = 'opened'
    ), 0)::bigint,
    'balance_clear_xof', coalesce(sum(e.amount_xof) filter (
      where d.event_type is distinct from 'opened'
    ), 0)::bigint,
    'credit_granted_xof', coalesce(sum(case
      when e.recorded_at < v_since then 0
      when e.entry_type = 'debt' then e.amount_xof
      when e.entry_type = 'correction' and e.original_entry_type = 'debt' then e.amount_xof
      else 0
    end), 0)::bigint,
    'repaid_xof', -coalesce(sum(case
      when e.recorded_at < v_since then 0
      when e.entry_type = 'repayment' then e.amount_xof
      when e.entry_type = 'correction' and e.original_entry_type = 'repayment' then e.amount_xof
      else 0
    end), 0)::bigint,
    'active_clients', (
      select count(*) from public.shop_clients sc
      where sc.shop_id = v_shop_id and sc.archived_at is null
    )
  ) into v_result
  from entries e
  left join current_disputes d on d.ledger_entry_id = e.id;

  return v_result;
end;
$$;

create or replace view public.client_timeline
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
  le.occurred_at as event_at,
  le.due_on,
  le.source_channel,
  le.recorded_by_role,
  le.client_reference,
  le.possible_duplicate_of
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
  de.recorded_at as event_at,
  null::date as due_on,
  null::text as source_channel,
  null::text as recorded_by_role,
  null::text as client_reference,
  null::uuid as possible_duplicate_of
from public.dispute_events de;

-- ============================================================================
-- RLS AND EXPLICIT API PRIVILEGES
-- ============================================================================

alter table public.client_profiles enable row level security;
alter table public.shop_public_codes enable row level security;
alter table public.repayment_allocation_events enable row level security;

create policy client_profiles_select_own
on public.client_profiles for select to authenticated
using ((select auth.uid()) is not null and auth_user_id = (select auth.uid()));

create policy shop_public_codes_select_owner
on public.shop_public_codes for select to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = shop_public_codes.shop_id
      and s.auth_user_id = (select auth.uid())
  )
);

create policy allocations_select_actor
on public.repayment_allocation_events for select to authenticated
using (
  exists (
    select 1 from public.shops s
    where s.id = repayment_allocation_events.shop_id
      and s.auth_user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.shop_clients sc
    join public.client_identities ci on ci.id = sc.client_identity_id
    where sc.id = repayment_allocation_events.shop_client_id
      and ci.auth_user_id = (select auth.uid())
  )
);

revoke all on table public.client_profiles from anon, authenticated, service_role;
revoke all on table public.shop_public_codes from anon, authenticated, service_role;
revoke all on table public.repayment_allocation_events from anon, authenticated, service_role;

grant select on table public.client_profiles to authenticated, service_role;
grant select (
  id, shop_id, code_prefix, created_at, revoked_at
) on table public.shop_public_codes to authenticated;
grant select on table public.shop_public_codes to service_role;
grant select on table public.repayment_allocation_events to authenticated, service_role;

grant select (
  due_on,
  source_channel,
  client_reference,
  possible_duplicate_of,
  recorded_by_role
) on table public.ledger_entries to authenticated;
grant select (
  recipient_role,
  recipient_phone_e164
) on table public.message_outbox to service_role;

grant select on table public.repayment_allocation_totals to authenticated, service_role;
grant select on table public.debt_repayment_metrics to authenticated, service_role;
grant select on table public.client_trust_metrics to authenticated, service_role;
grant select on table public.client_trust_scores to authenticated, service_role;

revoke execute on function private.relationship_actor_role(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.allocate_repayment_fifo(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.release_repayment_allocations(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.release_debt_allocations(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.touch_updated_at()
  from public, anon, authenticated, service_role;

revoke execute on function public.record_operation(
  uuid, text, text, text, bigint, date, timestamptz, text, text, uuid, boolean
) from public, anon, authenticated, service_role;
revoke execute on function public.upsert_client_profile(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.rotate_shop_public_code(text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.connect_to_shop(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_shop_summary(text)
  from public, anon, authenticated, service_role;

grant execute on function public.record_operation(
  uuid, text, text, text, bigint, date, timestamptz, text, text, uuid, boolean
) to authenticated;
grant execute on function public.upsert_client_profile(text) to authenticated;
grant execute on function public.rotate_shop_public_code(text, text) to authenticated;
grant execute on function public.connect_to_shop(text) to authenticated;
grant execute on function public.get_shop_summary(text) to authenticated;

comment on function public.record_operation(
  uuid, text, text, text, bigint, date, timestamptz, text, text, uuid, boolean
) is 'Atomic shared-journal command used by both verified clients and shop owners.';
comment on function public.connect_to_shop(text) is
  'Resolves a server-hashed active shop QR code and creates or claims the relationship.';
comment on function public.register_verified_client_identity(uuid, text) is
  'Called by the Cloudflare Worker only after Twilio Verify confirms the phone number.';
comment on function public.read_shared_ledger(uuid) is
  'Called by the Cloudflare Worker after it verifies the private link signature.';
comment on table public.share_links is
  'Revocable private link identifiers signed by the Cloudflare Worker; no bearer token is stored in PostgreSQL.';

commit;
