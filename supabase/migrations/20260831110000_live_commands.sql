begin;

alter table public.shop_public_codes
  add column if not exists last_used_at timestamptz;

create or replace function public.create_shop_client(
  p_name text,
  p_phone_raw text default null,
  p_phone_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop_id uuid;
  v_client public.shop_clients%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 120 then
    raise exception 'client name is required and must not exceed 120 characters';
  end if;
  if p_phone_e164 is not null and p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid E.164 phone number';
  end if;

  select id into v_shop_id from public.shops
  where auth_user_id = v_actor and archived_at is null for update;
  if v_shop_id is null then raise exception 'active shop not found'; end if;

  insert into public.shop_clients (shop_id, name, phone_raw, phone_e164)
  values (v_shop_id, btrim(p_name), nullif(btrim(p_phone_raw), ''), p_phone_e164)
  returning * into v_client;

  return jsonb_build_object(
    'id', v_client.id,
    'shop_id', v_client.shop_id,
    'name', v_client.name,
    'phone_e164', v_client.phone_e164,
    'verified', false,
    'created_at', v_client.created_at,
    'balance_total_xof', 0,
    'balance_disputed_xof', 0,
    'balance_clear_xof', 0
  );
end;
$$;

create or replace function public.update_shop_profile(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_shop public.shops%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 120 then
    raise exception 'shop name is required and must not exceed 120 characters';
  end if;
  update public.shops set name = btrim(p_name)
  where auth_user_id = v_actor and archived_at is null
  returning * into v_shop;
  if not found then raise exception 'active shop not found'; end if;
  return jsonb_build_object(
    'id', v_shop.id,
    'name', v_shop.name,
    'phone_e164', v_shop.phone_e164,
    'currency_code', v_shop.currency_code
  );
end;
$$;

-- This resolver is deliberately service-role-only. It reveals only a shop name;
-- connection and relationship creation still require a verified client session.
create or replace function public.resolve_shop_code(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid code hash'; end if;
  select jsonb_build_object('shop_id', s.id, 'shop_name', s.name)
  into v_result
  from public.shop_public_codes c
  join public.shops s on s.id = c.shop_id
  where c.code_hash = p_code_hash
    and c.revoked_at is null
    and s.archived_at is null;
  if v_result is null then raise exception 'shop code is invalid or revoked'; end if;
  update public.shop_public_codes set last_used_at = now()
  where code_hash = p_code_hash and revoked_at is null;
  return v_result;
end;
$$;

create or replace function public.correct_and_replace_operation(
  p_original_entry_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_replacement_title text default null,
  p_replacement_amount_xof bigint default null,
  p_replacement_detail text default null,
  p_replacement_due_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correction_id uuid;
  v_original public.ledger_entries%rowtype;
  v_replacement jsonb := null;
begin
  select * into v_original from public.ledger_entries where id = p_original_entry_id;
  if not found then raise exception 'entry not found'; end if;
  if p_replacement_title is not null or p_replacement_amount_xof is not null then
    if v_original.entry_type <> 'debt' or p_replacement_title is null
       or p_replacement_amount_xof is null then
      raise exception 'replacement must include a debt title and amount';
    end if;
  elsif p_replacement_detail is not null or p_replacement_due_on is not null then
    raise exception 'replacement fields are incomplete';
  end if;

  v_correction_id := public.correct_entry(
    p_original_entry_id, p_reason, p_idempotency_key
  );

  if p_replacement_title is not null then
    v_replacement := public.record_operation(
      v_original.shop_client_id,
      'debt',
      p_replacement_title,
      p_replacement_detail,
      p_replacement_amount_xof,
      p_replacement_due_on,
      now(),
      v_original.source_channel,
      null,
      gen_random_uuid(),
      false
    );
    if coalesce((v_replacement->>'recorded')::boolean, false) is not true then
      raise exception 'replacement operation was not recorded';
    end if;
  end if;

  return jsonb_build_object(
    'correction_entry_id', v_correction_id,
    'replacement', v_replacement
  );
end;
$$;

revoke all on function public.create_shop_client(text, text, text) from public, anon, authenticated;
revoke all on function public.update_shop_profile(text) from public, anon, authenticated;
revoke all on function public.resolve_shop_code(text) from public, anon, authenticated;
revoke all on function public.correct_and_replace_operation(uuid, text, uuid, text, bigint, text, date)
  from public, anon, authenticated;
grant execute on function public.create_shop_client(text, text, text) to authenticated;
grant execute on function public.update_shop_profile(text) to authenticated;
grant execute on function public.resolve_shop_code(text) to service_role;
grant execute on function public.correct_and_replace_operation(uuid, text, uuid, text, bigint, text, date)
  to authenticated;

commit;
