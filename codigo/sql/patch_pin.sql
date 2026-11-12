create or replace function public.set_child_pin(p_member uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m members; v_uid uuid; v_email text;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if length(p_password) < 8 then raise exception 'Senha muito curta'; end if;
  select * into m from members where id = p_member and role = 'child';
  if not found then raise exception 'Criança não encontrada'; end if;
  if m.user_id is not null then
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now() where id = m.user_id;
    return;
  end if;
  v_email := prepare_child_login(p_member);
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('name', m.name), now(), now(), '', '', '', '',
      '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = v_uid;
  end if;
  update members set user_id = v_uid where id = p_member;
end $$;

