-- Boutikier live integration: authenticated read models, onboarding and
-- re-readable signed identities. All financial writes remain in the existing
-- transaction functions and immutable tables.

begin;

-- ---------------------------------------------------------------------------
-- Authenticated actor context and onboarding
-- ---------------------------------------------------------------------------

create or replace function public.get_actor_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_phone text;
  v_phone_confirmed boolean;
  v_shop public.shops%rowtype;
  v_identity public.client_identities%rowtype;
  v_profile public.client_profiles%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;

  select u.phone, u.phone_confirmed_at is not null
  into v_phone, v_phone_confirmed
  from auth.users u
  where u.id = v_actor;

  select * into v_shop
  from public.shops
  where auth_user_id = v_actor and archived_at is null;

  select * into v_identity
  from public.client_identities
  where auth_user_id = v_actor;

  select * into v_profile
  from public.client_profiles
  where auth_user_id = v_actor;

  return jsonb_build_object(
    'auth_user_id', v_actor,
    'phone_e164', nullif(v_phone, ''),
    'shop', case when v_shop.id is null then null else jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'phone_e164', v_shop.phone_e164,
      'currency_code', v_shop.currency_code
    ) end,
    'client', case when v_identity.id is null then null else jsonb_build_object(
      'auth_user_id', v_actor,
      'display_name', coalesce(v_profile.display_name, 'Client'),
      'phone_e164', v_identity.phone_e164
    ) end,
    'default_audience', case
      when v_shop.id is not null then 'shop'
      when v_identity.id is not null then 'client'
      else null
    end,
    'needs_onboarding', v_shop.id is null and v_identity.id is null,
    'phone_confirmed', coalesce(v_phone_confirmed, false)
  );
end;
$$;

create or replace function public.complete_shop_onboarding(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_phone text;
  v_shop public.shops%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 120 then
    raise exception 'shop name is required and must not exceed 120 characters';
  end if;

  select phone into v_phone from auth.users where id = v_actor;

  insert into public.shops (auth_user_id, name, phone_e164)
  values (v_actor, btrim(p_name), nullif(v_phone, ''))
  on conflict (auth_user_id) do update
    set name = excluded.name,
        phone_e164 = coalesce(public.shops.phone_e164, excluded.phone_e164)
  returning * into v_shop;

  return jsonb_build_object(
    'id', v_shop.id,
    'name', v_shop.name,
    'phone_e164', v_shop.phone_e164,
    'currency_code', v_shop.currency_code
  );
end;
$$;

create or replace function public.complete_client_onboarding(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_phone text;
  v_phone_confirmed boolean;
  v_identity_id uuid;
  v_profile public.client_profiles%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_display_name is null or btrim(p_display_name) = ''
     or char_length(btrim(p_display_name)) > 120 then
    raise exception 'display name is required and must not exceed 120 characters';
  end if;

  select u.phone, u.phone_confirmed_at is not null
  into v_phone, v_phone_confirmed
  from auth.users u
  where u.id = v_actor;

  if not coalesce(v_phone_confirmed, false) or v_phone is null then
    raise exception 'verified phone required';
  end if;

  v_identity_id := public.register_verified_client_identity(v_actor, v_phone);

  insert into public.client_profiles (auth_user_id, display_name)
  values (v_actor, btrim(p_display_name))
  on conflict (auth_user_id) do update
    set display_name = excluded.display_name
  returning * into v_profile;

  perform public.claim_shop_clients();

  return jsonb_build_object(
    'auth_user_id', v_actor,
    'display_name', v_profile.display_name,
    'phone_e164', v_phone,
    'claimed', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Stable JSON projection used by every API surface
-- ---------------------------------------------------------------------------

create or replace function private.ledger_entry_payload(p_entry_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', le.id,
    'type', le.entry_type,
    'title', le.title,
    'detail', le.detail,
    'amount_xof', abs(le.amount_xof),
    'occurred_at', le.occurred_at,
    'recorded_at', le.recorded_at,
    'due_on', le.due_on,
    'source_channel', le.source_channel,
    'client_reference', le.client_reference,
    'possible_duplicate_of', le.possible_duplicate_of,
    'recorded_by_role', le.recorded_by_role,
    'dispute_state', coalesce(ds.event_type, 'none'),
    'dispute_note', ds.note,
    'corrected', exists (
      select 1 from public.ledger_entries correction
      where correction.reverses_entry_id = le.id
    ),
    'reverses_entry_id', le.reverses_entry_id
  )
  from public.ledger_entries le
  left join lateral (
    select de.event_type, de.note
    from public.dispute_events de
    where de.ledger_entry_id = le.id
    order by de.recorded_at desc, de.sequence_number desc
    limit 1
  ) ds on true
  where le.id = p_entry_id;
$$;

create or replace function public.list_shop_clients(
  p_query text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_items jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select id into v_shop_id from public.shops
  where auth_user_id = v_actor and archived_at is null;
  if v_shop_id is null then raise exception 'active shop not found'; end if;

  select coalesce(jsonb_agg(row_data.item), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', sc.id,
      'shop_id', sc.shop_id,
      'name', sc.name,
      'phone_e164', sc.phone_e164,
      'verified', sc.client_identity_id is not null,
      'created_at', sc.created_at,
      'balance_total_xof', coalesce(b.balance_total_xof, 0),
      'balance_disputed_xof', coalesce(b.balance_disputed_xof, 0),
      'balance_clear_xof', coalesce(b.balance_clear_xof, 0)
    ) as item
    from public.shop_clients sc
    left join public.shop_client_balances b on b.shop_client_id = sc.id
    where sc.shop_id = v_shop_id
      and sc.archived_at is null
      and (nullif(btrim(p_query), '') is null
        or lower(sc.name) like '%' || lower(btrim(p_query)) || '%'
        or coalesce(sc.phone_e164, '') like '%' || btrim(p_query) || '%')
    order by sc.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ) row_data;

  return jsonb_build_object('items', v_items, 'next_cursor', null);
end;
$$;

create or replace function public.get_shop_client(p_shop_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_result jsonb;
  v_trust jsonb := null;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  v_role := private.relationship_actor_role(p_shop_client_id, v_actor);
  if v_role is null then raise exception 'relationship access denied'; end if;

  if v_role = 'client' then
    select to_jsonb(ts) - 'shop_id' - 'shop_client_id'
    into v_trust
    from public.client_trust_scores ts
    where ts.shop_client_id = p_shop_client_id;
  end if;

  select jsonb_build_object(
    'shop_client', jsonb_build_object(
      'id', sc.id,
      'shop_id', sc.shop_id,
      'name', sc.name,
      'phone_e164', sc.phone_e164,
      'verified', sc.client_identity_id is not null,
      'created_at', sc.created_at,
      'balance_total_xof', coalesce(b.balance_total_xof, 0),
      'balance_disputed_xof', coalesce(b.balance_disputed_xof, 0),
      'balance_clear_xof', coalesce(b.balance_clear_xof, 0)
    ),
    'shop', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'phone_e164', s.phone_e164,
      'currency_code', s.currency_code
    ),
    'client', jsonb_build_object(
      'name', case when v_role = 'client' then coalesce(cp.display_name, sc.name) else sc.name end,
      'phone_e164', sc.phone_e164,
      'verified', sc.client_identity_id is not null
    ),
    'balance', jsonb_build_object(
      'balance_total_xof', coalesce(b.balance_total_xof, 0),
      'balance_disputed_xof', coalesce(b.balance_disputed_xof, 0),
      'balance_clear_xof', coalesce(b.balance_clear_xof, 0)
    ),
    'entries', coalesce((
      select jsonb_agg(private.ledger_entry_payload(le.id)
        order by le.occurred_at desc, le.sequence_number desc)
      from public.ledger_entries le
      where le.shop_client_id = sc.id
    ), '[]'::jsonb),
    'trust', v_trust
  ) into v_result
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  left join public.client_profiles cp on cp.auth_user_id = v_actor
  left join public.shop_client_balances b on b.shop_client_id = sc.id
  where sc.id = p_shop_client_id;

  if v_result is null then raise exception 'relationship not found'; end if;
  return v_result;
end;
$$;

create or replace function public.get_shop_activity(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_items jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select id into v_shop_id from public.shops
  where auth_user_id = v_actor and archived_at is null;
  if v_shop_id is null then raise exception 'active shop not found'; end if;

  select coalesce(jsonb_agg(row_data.item), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'entry', private.ledger_entry_payload(le.id),
      'client', jsonb_build_object(
        'id', sc.id, 'shop_id', sc.shop_id, 'name', sc.name,
        'phone_e164', sc.phone_e164, 'verified', sc.client_identity_id is not null,
        'created_at', sc.created_at,
        'balance_total_xof', coalesce(b.balance_total_xof, 0),
        'balance_disputed_xof', coalesce(b.balance_disputed_xof, 0),
        'balance_clear_xof', coalesce(b.balance_clear_xof, 0)
      )
    ) as item
    from public.ledger_entries le
    join public.shop_clients sc on sc.id = le.shop_client_id
    left join public.shop_client_balances b on b.shop_client_id = sc.id
    where le.shop_id = v_shop_id and sc.archived_at is null
    order by le.recorded_at desc, le.sequence_number desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) row_data;

  return jsonb_build_object('items', v_items, 'next_cursor', null);
end;
$$;

create or replace function public.get_client_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_identity public.client_identities%rowtype;
  v_profile public.client_profiles%rowtype;
  v_relationships jsonb;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_identity from public.client_identities where auth_user_id = v_actor;
  if not found then raise exception 'verified client identity required'; end if;
  select * into v_profile from public.client_profiles where auth_user_id = v_actor;
  if not found then raise exception 'client profile required'; end if;

  select coalesce(jsonb_agg(public.get_shop_client(sc.id)), '[]'::jsonb)
  into v_relationships
  from public.shop_clients sc
  where sc.client_identity_id = v_identity.id and sc.archived_at is null;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'auth_user_id', v_actor,
      'display_name', v_profile.display_name,
      'phone_e164', v_identity.phone_e164
    ),
    'relationships', v_relationships
  );
end;
$$;

create or replace function public.preview_operation(
  p_shop_client_id uuid,
  p_entry_type text,
  p_title text,
  p_amount_xof bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_current public.shop_client_balances%rowtype;
  v_signed bigint;
  v_dupes jsonb;
  v_phone text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_entry_type not in ('debt', 'repayment') or p_amount_xof <= 0 then
    raise exception 'invalid operation preview';
  end if;
  v_role := private.relationship_actor_role(p_shop_client_id, v_actor);
  if v_role is null then raise exception 'relationship access denied'; end if;

  select * into v_current from public.shop_client_balances
  where shop_client_id = p_shop_client_id;
  if not found then raise exception 'relationship not found'; end if;
  v_signed := case when p_entry_type = 'debt' then p_amount_xof else -p_amount_xof end;

  select coalesce(jsonb_agg(private.ledger_entry_payload(candidate.id)
    order by candidate.recorded_at desc, candidate.sequence_number desc), '[]'::jsonb)
  into v_dupes
  from public.ledger_entries candidate
  where candidate.shop_client_id = p_shop_client_id
    and candidate.entry_type = p_entry_type
    and candidate.amount_xof = v_signed
    and lower(regexp_replace(btrim(candidate.title), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(p_title), '\s+', ' ', 'g'))
    and candidate.recorded_at >= now() - interval '10 minutes'
    and not exists (
      select 1 from public.ledger_entries correction
      where correction.reverses_entry_id = candidate.id
    );

  select case when v_role = 'shop' then ci.phone_e164 else s.phone_e164 end
  into v_phone
  from public.shop_clients sc
  join public.shops s on s.id = sc.shop_id
  left join public.client_identities ci on ci.id = sc.client_identity_id
  where sc.id = p_shop_client_id;

  return jsonb_build_object(
    'shop_client_id', p_shop_client_id,
    'current_balance', jsonb_build_object(
      'balance_total_xof', v_current.balance_total_xof,
      'balance_disputed_xof', v_current.balance_disputed_xof,
      'balance_clear_xof', v_current.balance_clear_xof
    ),
    'projected_balance', jsonb_build_object(
      'balance_total_xof', v_current.balance_total_xof + v_signed,
      'balance_disputed_xof', v_current.balance_disputed_xof,
      'balance_clear_xof', v_current.balance_clear_xof + v_signed
    ),
    'probable_duplicates', v_dupes,
    'recipient_role', case when v_role = 'shop' then 'client' else 'shop' end,
    'recipient_phone_e164', v_phone
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-readable QR and complete share outbox payload
-- ---------------------------------------------------------------------------

create or replace function public.rotate_shop_public_code_with_id(
  p_code_id uuid,
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
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code hash'; end if;
  if p_code_prefix !~ '^[A-Za-z0-9_-]{4,12}$' then raise exception 'invalid code prefix'; end if;
  if p_code_id is null then raise exception 'code id is required'; end if;

  select id into v_shop_id from public.shops
  where auth_user_id = v_actor and archived_at is null for update;
  if not found then raise exception 'active shop not found'; end if;

  update public.shop_public_codes set revoked_at = now()
  where shop_id = v_shop_id and revoked_at is null;

  insert into public.shop_public_codes (
    id, shop_id, code_hash, code_prefix, created_by_auth_user_id
  ) values (p_code_id, v_shop_id, p_code_hash, p_code_prefix, v_actor);
  return p_code_id;
end;
$$;

create or replace function public.get_active_shop_code()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_code public.shop_public_codes%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select c.* into v_code
  from public.shop_public_codes c
  join public.shops s on s.id = c.shop_id
  where s.auth_user_id = v_actor and s.archived_at is null and c.revoked_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'code_id', v_code.id,
    'code_prefix', v_code.code_prefix,
    'created_at', v_code.created_at,
    'revoked_at', v_code.revoked_at
  );
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
  where sc.id = p_shop_client_id and sc.archived_at is null
    and s.archived_at is null and s.auth_user_id = v_actor
  for update of sc;
  if not found then raise exception 'shop client not found or not authorized'; end if;
  if v_phone is null then raise exception 'client needs a normalized phone number'; end if;

  update public.share_links set revoked_at = now()
  where shop_client_id = p_shop_client_id and revoked_at is null;
  v_expires_at := now() + p_ttl;

  insert into public.share_links (shop_client_id, created_by_auth_user_id, expires_at)
  values (p_shop_client_id, v_actor, v_expires_at)
  returning id into v_link_id;

  insert into public.message_outbox (
    shop_client_id, source_kind, source_id, message_type,
    recipient_role, recipient_phone_e164, payload
  ) values (
    p_shop_client_id, 'share_link', v_link_id, 'share_link',
    'client', v_phone, jsonb_build_object('valid_until', v_expires_at)
  );

  return query select v_link_id, v_expires_at;
end;
$$;

-- Explicit grants for the new public API surface.
revoke all on function public.get_actor_context() from public, anon, authenticated;
revoke all on function public.complete_shop_onboarding(text) from public, anon, authenticated;
revoke all on function public.complete_client_onboarding(text) from public, anon, authenticated;
revoke all on function public.list_shop_clients(text, integer) from public, anon, authenticated;
revoke all on function public.get_shop_client(uuid) from public, anon, authenticated;
revoke all on function public.get_shop_activity(integer) from public, anon, authenticated;
revoke all on function public.get_client_home() from public, anon, authenticated;
revoke all on function public.preview_operation(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.rotate_shop_public_code_with_id(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_active_shop_code() from public, anon, authenticated;
grant execute on function public.get_actor_context() to authenticated;
grant execute on function public.complete_shop_onboarding(text) to authenticated;
grant execute on function public.complete_client_onboarding(text) to authenticated;
grant execute on function public.list_shop_clients(text, integer) to authenticated;
grant execute on function public.get_shop_client(uuid) to authenticated;
grant execute on function public.get_shop_activity(integer) to authenticated;
grant execute on function public.get_client_home() to authenticated;
grant execute on function public.preview_operation(uuid, text, text, bigint) to authenticated;
grant execute on function public.rotate_shop_public_code_with_id(uuid, text, text) to authenticated;
grant execute on function public.get_active_shop_code() to authenticated;

commit;
