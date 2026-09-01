-- Make a shop and its permanent QR one onboarding invariant, then expose the
-- existing relationship-scoped trust calculation to the owning shop.

create or replace function public.complete_shop_onboarding_with_code(
  p_name text,
  p_code_id uuid,
  p_code_hash text,
  p_code_prefix text
)
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
  if p_code_id is null then raise exception 'code id is required'; end if;
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code hash'; end if;
  if p_code_prefix !~ '^[A-Za-z0-9_-]{4,12}$' then raise exception 'invalid code prefix'; end if;

  select private.normalize_phone_e164(phone)
  into v_phone
  from auth.users
  where id = v_actor;

  insert into public.shops (auth_user_id, name, phone_e164)
  values (v_actor, btrim(p_name), v_phone)
  on conflict (auth_user_id) do update
  set name = excluded.name,
      phone_e164 = coalesce(public.shops.phone_e164, excluded.phone_e164)
  returning * into v_shop;

  perform 1
  from public.shop_public_codes
  where shop_id = v_shop.id and revoked_at is null
  for update;

  if not found then
    insert into public.shop_public_codes (
      id, shop_id, code_hash, code_prefix, created_by_auth_user_id
    ) values (
      p_code_id, v_shop.id, p_code_hash, p_code_prefix, v_actor
    );
  end if;

  return jsonb_build_object(
    'id', v_shop.id,
    'name', v_shop.name,
    'phone_e164', v_shop.phone_e164,
    'currency_code', v_shop.currency_code
  );
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

  select to_jsonb(ts) - 'shop_id' - 'shop_client_id'
  into v_trust
  from public.client_trust_scores ts
  where ts.shop_client_id = p_shop_client_id;

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
  select id into v_shop_id
  from public.shops
  where auth_user_id = v_actor and archived_at is null;
  if v_shop_id is null then raise exception 'active shop not found'; end if;

  select coalesce(jsonb_agg(row_data.item), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'entry', private.ledger_entry_payload(le.id),
      'client', jsonb_build_object(
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
      'trust', to_jsonb(ts) - 'shop_id' - 'shop_client_id'
    ) as item
    from public.ledger_entries le
    join public.shop_clients sc on sc.id = le.shop_client_id
    left join public.shop_client_balances b on b.shop_client_id = sc.id
    left join public.client_trust_scores ts on ts.shop_client_id = sc.id
    where le.shop_id = v_shop_id and sc.archived_at is null
    order by le.recorded_at desc, le.sequence_number desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) row_data;

  return jsonb_build_object('items', v_items, 'next_cursor', null);
end;
$$;

revoke all on function public.complete_shop_onboarding_with_code(text, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_shop_onboarding_with_code(text, uuid, text, text)
to authenticated;

