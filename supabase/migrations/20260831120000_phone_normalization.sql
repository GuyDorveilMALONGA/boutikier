begin;

create or replace function private.normalize_phone_e164(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when left(btrim(p_phone), 1) = '+' then '+' || regexp_replace(btrim(p_phone), '[^0-9]', '', 'g')
    else '+' || regexp_replace(btrim(p_phone), '[^0-9]', '', 'g')
  end;
$$;

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
  select private.normalize_phone_e164(u.phone), u.phone_confirmed_at is not null
  into v_phone, v_phone_confirmed from auth.users u where u.id = v_actor;
  select * into v_shop from public.shops where auth_user_id = v_actor and archived_at is null;
  select * into v_identity from public.client_identities where auth_user_id = v_actor;
  select * into v_profile from public.client_profiles where auth_user_id = v_actor;
  return jsonb_build_object(
    'auth_user_id', v_actor,
    'phone_e164', v_phone,
    'shop', case when v_shop.id is null then null else jsonb_build_object(
      'id', v_shop.id, 'name', v_shop.name, 'phone_e164', v_shop.phone_e164,
      'currency_code', v_shop.currency_code) end,
    'client', case when v_identity.id is null then null else jsonb_build_object(
      'auth_user_id', v_actor, 'display_name', coalesce(v_profile.display_name, 'Client'),
      'phone_e164', v_identity.phone_e164) end,
    'default_audience', case when v_shop.id is not null then 'shop'
      when v_identity.id is not null then 'client' else null end,
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
  select private.normalize_phone_e164(phone) into v_phone from auth.users where id = v_actor;
  insert into public.shops (auth_user_id, name, phone_e164)
  values (v_actor, btrim(p_name), v_phone)
  on conflict (auth_user_id) do update set name = excluded.name,
    phone_e164 = coalesce(public.shops.phone_e164, excluded.phone_e164)
  returning * into v_shop;
  return jsonb_build_object('id', v_shop.id, 'name', v_shop.name,
    'phone_e164', v_shop.phone_e164, 'currency_code', v_shop.currency_code);
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
  v_confirmed boolean;
  v_profile public.client_profiles%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_display_name is null or btrim(p_display_name) = ''
     or char_length(btrim(p_display_name)) > 120 then
    raise exception 'display name is required and must not exceed 120 characters';
  end if;
  select private.normalize_phone_e164(phone), phone_confirmed_at is not null
  into v_phone, v_confirmed from auth.users where id = v_actor;
  if not coalesce(v_confirmed, false) or v_phone is null then
    raise exception 'verified phone required';
  end if;
  perform public.register_verified_client_identity(v_actor, v_phone);
  insert into public.client_profiles (auth_user_id, display_name)
  values (v_actor, btrim(p_display_name))
  on conflict (auth_user_id) do update set display_name = excluded.display_name
  returning * into v_profile;
  perform public.claim_shop_clients();
  return jsonb_build_object('auth_user_id', v_actor,
    'display_name', v_profile.display_name, 'phone_e164', v_phone, 'claimed', true);
end;
$$;

commit;
