-- =====================================================================
-- MISSÕES DA NOSSA FAMÍLIA — banco de dados (Supabase / PostgreSQL)
-- Fuso: America/Sao_Paulo. Pontuação e permissões aplicadas no banco.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- utilitários de data ----------
create or replace function public.today_sp() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- ---------- configurações ----------
create table public.settings (
  id int primary key default 1 check (id = 1),
  family_name text not null default 'Nossa Família',
  family_code text not null default upper(substr(md5(random()::text), 1, 8)),
  individual_goal numeric not null default 80,
  group_goal numeric not null default 85,
  late_factor numeric not null default 0.6,
  reward_budget numeric not null default 150,
  start_date date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  family_day_weekday int not null default 2,
  family_day_time time not null default '19:00',
  culto_weekday int not null default 4,
  culto_time time not null default '20:00',
  penalty_fight int not null default 5,
  penalty_school int not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------- membros ----------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('parent','child')),
  color text not null default '#c084fc',
  avatar text not null default '🌸',
  photo_path text,
  login_email text,
  invite_email text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from members where user_id = auth.uid() and active limit 1 $$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from members where user_id = auth.uid() and active) $$;
create or replace function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from members where user_id = auth.uid() and active and role = 'parent') $$;
create or replace function public.member_name(p uuid) returns text
language sql stable security definer set search_path = public as $$ select name from members where id = p $$;

-- ---------- tipos de tarefa ----------
create table public.task_types (
  id text primary key,
  name text not null,
  icon text not null,
  points int not null check (points >= 0),
  category text not null check (category in ('casa','estudo','rotina','opcional')),
  default_start time,
  default_due time not null,
  guidance text,
  optional boolean not null default false,
  sort int not null default 0,
  active boolean not null default true
);

-- ---------- rodízio semanal (0 = domingo ... 6 = sábado) ----------
create table public.rotation (
  id uuid primary key default gen_random_uuid(),
  weekday int not null check (weekday between 0 and 6),
  member_id uuid not null references public.members(id) on delete cascade,
  task_type_id text not null references public.task_types(id) on delete cascade,
  due_time time,
  active boolean not null default true,
  unique (weekday, member_id, task_type_id)
);

-- ---------- horários da tarde ----------
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  weekdays int[] not null,
  start_time time not null,
  end_time time,
  label text not null,
  icon text not null default '⏰',
  sort int not null default 0
);

-- ---------- tarefas do dia (geradas a partir do rodízio) ----------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  task_type_id text not null references public.task_types(id),
  task_name text not null,
  icon text not null,
  points_max int not null,
  optional boolean not null default false,
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','awaiting','approved','rejected','excused','missed')),
  completed_at timestamptz,
  completed_by uuid references public.members(id),
  on_time boolean,
  points_awarded int not null default 0,
  reviewed_by uuid references public.members(id),
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (date, member_id, task_type_id)          -- nunca pontuar a mesma tarefa 2x no dia
);
create index on public.assignments (date);
create index on public.assignments (member_id, date);
create index on public.assignments (status);

create table public.generated_days (date date primary key, created_at timestamptz not null default now());

-- ---------- ajustes de pontuação ----------
create table public.point_adjustments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  date date not null default public.today_sp(),
  delta int not null,
  category text not null default 'ajuste' check (category in ('ajuste','bonus','briga','escola','comportamento')),
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid references public.members(id),
  created_at timestamptz not null default now()
);

-- ---------- fechamento mensal ----------
create table public.month_closures (
  month date primary key check (extract(day from month) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid references public.members(id),
  unlocked boolean not null default false,
  summary jsonb not null,
  revisions jsonb not null default '[]'::jsonb
);
create or replace function public.is_month_closed(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from month_closures where month = date_trunc('month', d)::date) $$;

-- ---------- histórico de alterações (auditoria) ----------
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  action text not null,
  table_name text not null,
  record_id text,
  before jsonb,
  after jsonb,
  reason text
);
create index on public.audit_log (at desc);

-- ---------- notificações dentro do app ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  title text not null,
  body text,
  kind text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (member_id, created_at desc);

-- ---------- mural da gratidão / mensagens dos pais ----------
create table public.gratitude (
  id uuid primary key default gen_random_uuid(),
  from_member uuid not null references public.members(id) on delete cascade,
  to_member uuid not null references public.members(id) on delete cascade,
  message text not null check (length(trim(message)) between 1 and 500),
  kind text not null default 'gratidao' check (kind in ('gratidao','incentivo')),
  created_at timestamptz not null default now()
);

-- ---------- recompensas ----------
create table public.reward_options (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 80),
  emoji text not null default '🎁',
  est_cost numeric,
  description text,
  suggested_by uuid references public.members(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.monthly_rewards (
  month date primary key check (extract(day from month) = 1),
  status text not null default 'locked'
    check (status in ('locked','voting','awaiting_approval','approved','done')),
  unlocked_manually boolean not null default false,
  unlock_reason text,
  chosen_option uuid references public.reward_options(id),
  budget numeric,
  approved_by uuid references public.members(id),
  approved_at timestamptz,
  done_at timestamptz,
  note text
);
create table public.reward_votes (
  month date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  option_id uuid not null references public.reward_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (month, member_id)
);

-- ---------- Dia da Família ----------
create table public.family_day_options (
  id uuid primary key default gen_random_uuid(),
  title text not null, emoji text not null default '🎲', active boolean not null default true
);
create table public.family_day_votes (
  date date not null,
  member_id uuid not null references public.members(id) on delete cascade,
  option_id uuid not null references public.family_day_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (date, member_id)
);

-- ---------- missões em família (opcionais, sem pontos) ----------
create table public.family_missions (
  id uuid primary key default gen_random_uuid(),
  title text not null, emoji text not null default '🤝', description text,
  active boolean not null default true,
  done_at timestamptz, done_by uuid references public.members(id),
  created_at timestamptz not null default now()
);

-- ---------- "pulso" para atualizar todos os aparelhos ----------
create table public.app_pulse (id int primary key default 1 check (id = 1), changed_at timestamptz not null default now(), what text);
insert into public.app_pulse (id) values (1);
-- =====================================================================
-- FUNÇÕES, GATILHOS E REGRAS DE NEGÓCIO
-- =====================================================================

-- ---------- pulso: avisa todos os aparelhos que algo mudou ----------
create or replace function public.bump_pulse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update app_pulse set changed_at = now(), what = TG_TABLE_NAME where id = 1;
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['assignments','point_adjustments','gratitude','reward_votes','monthly_rewards',
    'reward_options','family_day_votes','family_missions','members','rotation','task_types','settings',
    'month_closures','schedule_blocks','family_day_options'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.bump_pulse()', 'pulse_'||t, t);
  end loop;
end $$;

-- ---------- auditoria ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_member_id(); v_new jsonb; v_old jsonb;
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(old); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(new); end if;
  insert into audit_log (actor, actor_name, action, table_name, record_id, before, after, reason)
  values (v_actor, member_name(v_actor), TG_OP, TG_TABLE_NAME,
          coalesce(v_new->>'id', v_old->>'id', v_new->>'month', v_old->>'month'),
          v_old, v_new, nullif(current_setting('app.reason', true), ''));
  return null;
end $$;

create trigger audit_assignments after update or delete on public.assignments
  for each row execute function public.audit_trigger();
do $$ declare t text; begin
  foreach t in array array['point_adjustments','members','rotation','task_types','settings','month_closures',
    'monthly_rewards','schedule_blocks'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', 'audit_'||t, t);
  end loop;
end $$;

-- ---------- proteção do mês fechado ----------
create or replace function public.guard_closed_month() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  d := case when TG_OP = 'DELETE' then old.date else new.date end;
  if (is_month_closed(d) or (TG_OP = 'UPDATE' and is_month_closed(old.date)))
     and coalesce(current_setting('app.allow_closed', true), '') <> 'on' then
    raise exception 'Este mês já foi fechado. Use "Corrigir com justificativa".';
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end $$;
create trigger guard_assignments before insert or update or delete on public.assignments
  for each row execute function public.guard_closed_month();
create trigger guard_adjustments before insert or update or delete on public.point_adjustments
  for each row execute function public.guard_closed_month();

-- ---------- notificações automáticas ----------
create or replace function public.notify_parents(p_title text, p_body text, p_kind text default 'info') returns void
language sql security definer set search_path = public as $$
  insert into notifications (member_id, title, body, kind)
  select id, p_title, p_body, p_kind from members where role = 'parent' and active $$;

create or replace function public.fmt_time(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'America/Sao_Paulo', 'HH24"h"MI') $$;

create or replace function public.assignment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text := member_name(new.member_id);
begin
  if new.status = 'awaiting' and old.status is distinct from 'awaiting' then
    perform notify_parents(v_name || ' concluiu: ' || new.task_name,
      'Marcado às ' || fmt_time(new.completed_at) || case when new.on_time then ' — no horário ✅' else ' — com atraso ⏰' end
      || '. Aguardando aprovação.', 'awaiting');
  elsif new.status = 'approved' and old.status is distinct from 'approved' then
    insert into notifications (member_id, title, body, kind)
    values (new.member_id, 'Missão aprovada! 🎉', new.task_name || ': +' || new.points_awarded || ' pontos', 'approved');
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    insert into notifications (member_id, title, body, kind)
    values (new.member_id, 'Vamos tentar de novo 💜', new.task_name || coalesce(' — ' || new.note, ''), 'rejected');
  elsif new.status = 'excused' and old.status is distinct from 'excused' then
    insert into notifications (member_id, title, body, kind)
    values (new.member_id, 'Tarefa dispensada', new.task_name || coalesce(' — ' || new.note, ''), 'info');
  end if;
  return null;
end $$;
create trigger notify_assignments after update on public.assignments
  for each row execute function public.assignment_notify();

create or replace function public.gratitude_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (member_id, title, body, kind)
  values (new.to_member,
    case when new.kind = 'incentivo' then 'Mensagem carinhosa de ' else 'Agradecimento de ' end || member_name(new.from_member) || ' 💌',
    left(new.message, 140), 'gratitude');
  return null;
end $$;
create trigger notify_gratitude after insert on public.gratitude
  for each row execute function public.gratitude_notify();

-- =====================================================================
-- ACESSO / CADASTRO
-- =====================================================================

-- Vincula o usuário logado a um membro (1º responsável, convite por e-mail).
create or replace function public.claim_membership(p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; m members;
begin
  if v_uid is null then raise exception 'Faça login primeiro'; end if;
  select * into m from members where user_id = v_uid;
  if found then return to_jsonb(m); end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  -- convite de responsável
  select * into m from members where user_id is null and role = 'parent' and lower(invite_email) = v_email limit 1;
  if found then
    update members set user_id = v_uid where id = m.id returning * into m;
    return to_jsonb(m);
  end if;
  -- primeiro responsável (quando ainda não há nenhum)
  if not exists (select 1 from members where role = 'parent') then
    perform pg_advisory_xact_lock(4242);
    if not exists (select 1 from members where role = 'parent') then
      insert into members (user_id, name, role, color, avatar, invite_email, sort)
      values (v_uid, coalesce(nullif(trim(p_name), ''), 'Responsável'), 'parent', '#7c3aed', '👨', v_email, 0)
      returning * into m;
      return to_jsonb(m);
    end if;
  end if;
  return null;  -- sem convite: sem acesso
end $$;

-- Lista os perfis para a tela de entrada (somente com o código da família).
create or replace function public.login_tiles(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from settings where family_code = upper(trim(p_code)))
    then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'avatar', avatar, 'color', color,
                   'login_email', login_email) order by sort)
          from members where role = 'child' and active and user_id is not null), '[]'::jsonb)
    else null end $$;

-- Prepara o e-mail interno da criança (usa o e-mail do responsável com +nome).
create or replace function public.prepare_child_login(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_email text; v_slug text; m members;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  select * into m from members where id = p_member and role = 'child';
  if not found then raise exception 'Criança não encontrada'; end if;
  if m.login_email is not null then return m.login_email; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  v_slug := lower(regexp_replace(translate(m.name, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc' || 'aaaaeeiooouc'), '[^a-zA-Z0-9]', '', 'g'));
  v_email := split_part(v_email, '@', 1) || '+' || v_slug || substr(md5(m.id::text), 1, 4) || '@' || split_part(v_email, '@', 2);
  update members set login_email = v_email where id = p_member;
  return v_email;
end $$;

-- Cria (ou troca) o acesso da criança com PIN, já confirmado, sem e-mail real.
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

-- A criança escolhe o próprio avatar.
create or replace function public.set_my_avatar(p_avatar text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_avatar) > 16 then raise exception 'Avatar inválido'; end if;
  update members set avatar = p_avatar where id = current_member_id();
end $$;

-- =====================================================================
-- GERAÇÃO DAS TAREFAS DO DIA
-- =====================================================================
create or replace function public.sync_assignments() returns void
language plpgsql security definer set search_path = public as $$
declare d date; v_start date; v_today date := today_sp();
begin
  if not is_member() then raise exception 'Acesso negado'; end if;
  perform pg_advisory_xact_lock(4243);
  select start_date into v_start from settings where id = 1;
  select coalesce(max(date) + 1, v_start) into d from generated_days;
  if d < v_start then d := v_start; end if;
  while d <= v_today loop
    insert into assignments (date, member_id, task_type_id, task_name, icon, points_max, optional, due_at)
    select d, r.member_id, t.id, t.name, t.icon, t.points, t.optional,
           ((d + coalesce(r.due_time, t.default_due))::timestamp at time zone 'America/Sao_Paulo')
      from rotation r join task_types t on t.id = r.task_type_id join members m on m.id = r.member_id
     where r.weekday = extract(dow from d)::int and r.active and t.active and m.active
    on conflict do nothing;
    insert into generated_days (date) values (d) on conflict do nothing;
    d := d + 1;
  end loop;
end $$;

-- Reaplica o rodízio de hoje (após editar o rodízio).
create or replace function public.refresh_today() returns void
language plpgsql security definer set search_path = public as $$
declare d date := today_sp();
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  perform sync_assignments();
  perform set_config('app.reason', 'Rodízio de hoje atualizado', true);
  delete from assignments a where a.date = d and a.status = 'pending'
    and not exists (select 1 from rotation r where r.weekday = extract(dow from d)::int and r.active
                    and r.member_id = a.member_id and r.task_type_id = a.task_type_id);
  insert into assignments (date, member_id, task_type_id, task_name, icon, points_max, optional, due_at)
  select d, r.member_id, t.id, t.name, t.icon, t.points, t.optional,
         ((d + coalesce(r.due_time, t.default_due))::timestamp at time zone 'America/Sao_Paulo')
    from rotation r join task_types t on t.id = r.task_type_id join members m on m.id = r.member_id
   where r.weekday = extract(dow from d)::int and r.active and t.active and m.active
  on conflict do nothing;
end $$;

-- =====================================================================
-- MARCAR / APROVAR / RECUSAR / DISPENSAR
-- =====================================================================
create or replace function public.complete_task(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; me uuid := current_member_id(); v_now timestamptz := now();
begin
  if me is null then raise exception 'Acesso negado'; end if;
  select * into a from assignments where id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada'; end if;
  if a.member_id <> me and not is_parent() then raise exception 'Você só pode marcar as suas próprias tarefas'; end if;
  if a.status <> 'pending' then raise exception 'Esta tarefa já foi marcada'; end if;
  if a.date > today_sp() then raise exception 'Ainda não é o dia desta tarefa'; end if;
  update assignments set status = 'awaiting', completed_at = v_now, completed_by = me,
         on_time = (v_now <= a.due_at)
   where id = p_id returning * into a;
  return to_jsonb(a);
end $$;

-- A criança pode desfazer enquanto aguarda aprovação (toque sem querer).
create or replace function public.undo_complete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a assignments;
begin
  select * into a from assignments where id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada'; end if;
  if a.member_id <> current_member_id() and not is_parent() then raise exception 'Acesso negado'; end if;
  if a.status <> 'awaiting' then raise exception 'Só dá para desfazer enquanto aguarda aprovação'; end if;
  perform set_config('app.reason', 'Marcação desfeita', true);
  update assignments set status = 'pending', completed_at = null, completed_by = null, on_time = null where id = p_id;
end $$;

create or replace function public.review_task(p_id uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assignments; v_lf numeric; v_pts int;
begin
  if not is_parent() then raise exception 'Somente responsáveis podem aprovar ou recusar'; end if;
  select * into a from assignments where id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada'; end if;
  if a.status <> 'awaiting' then raise exception 'Esta tarefa não está aguardando aprovação'; end if;
  if not p_approve and coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe o motivo da recusa'; end if;
  select late_factor into v_lf from settings where id = 1;
  v_pts := case when a.on_time then a.points_max else round(a.points_max * v_lf)::int end;
  perform set_config('app.reason', coalesce(p_reason, case when p_approve then 'Aprovada' else 'Recusada' end), true);
  update assignments set
      status = case when p_approve then 'approved' else 'rejected' end,
      points_awarded = case when p_approve then v_pts else 0 end,
      reviewed_by = current_member_id(), reviewed_at = now(),
      note = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.excuse_task(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe a justificativa'; end if;
  perform set_config('app.reason', p_reason, true);
  update assignments set status = 'excused', points_awarded = 0, reviewed_by = current_member_id(),
         reviewed_at = now(), note = trim(p_reason)
   where id = p_id;
  if not found then raise exception 'Tarefa não encontrada'; end if;
end $$;

create or replace function public.mark_missed(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  perform set_config('app.reason', coalesce(p_reason, 'Não realizada'), true);
  update assignments set status = 'missed', points_awarded = 0, reviewed_by = current_member_id(),
         reviewed_at = now(), note = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_id;
end $$;

-- Volta a tarefa para o estado anterior à revisão (corrigir engano).
create or replace function public.reopen_task(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe a justificativa'; end if;
  perform set_config('app.reason', p_reason, true);
  update assignments set status = case when completed_at is null then 'pending' else 'awaiting' end,
         points_awarded = 0, reviewed_by = null, reviewed_at = null, note = null
   where id = p_id;
end $$;

-- Remarca uma tarefa para outro dia (a original fica dispensada).
create or replace function public.reschedule_task(p_id uuid, p_new_date date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a assignments; v_time time;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe a justificativa'; end if;
  select * into a from assignments where id = p_id for update;
  if not found then raise exception 'Tarefa não encontrada'; end if;
  if a.status not in ('pending','missed') then raise exception 'Só tarefas pendentes podem ser remarcadas'; end if;
  if exists (select 1 from assignments where date = p_new_date and member_id = a.member_id and task_type_id = a.task_type_id) then
    raise exception 'Essa tarefa já existe nesse dia';
  end if;
  v_time := (a.due_at at time zone 'America/Sao_Paulo')::time;
  perform set_config('app.reason', 'Remarcada para ' || to_char(p_new_date, 'DD/MM') || ': ' || p_reason, true);
  update assignments set status = 'excused', points_awarded = 0, reviewed_by = current_member_id(), reviewed_at = now(),
         note = 'Remarcada para ' || to_char(p_new_date, 'DD/MM') || ' — ' || trim(p_reason)
   where id = p_id;
  insert into assignments (date, member_id, task_type_id, task_name, icon, points_max, optional, due_at, note)
  values (p_new_date, a.member_id, a.task_type_id, a.task_name, a.icon, a.points_max, a.optional,
          ((p_new_date + v_time)::timestamp at time zone 'America/Sao_Paulo'),
          'Remarcada de ' || to_char(a.date, 'DD/MM'));
end $$;

create or replace function public.adjust_points(p_member uuid, p_delta int, p_reason text, p_date date default null,
  p_category text default 'ajuste') returns void
language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe a justificativa'; end if;
  if p_delta = 0 then raise exception 'Informe um valor diferente de zero'; end if;
  if p_category in ('briga','escola','comportamento') and p_delta > 0 then raise exception 'Desconto deve ser negativo'; end if;
  if (select role from members where id = p_member) <> 'child' then raise exception 'Somente para as meninas'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into point_adjustments (member_id, date, delta, category, reason, created_by)
  values (p_member, coalesce(p_date, today_sp()), p_delta, coalesce(p_category, 'ajuste'), trim(p_reason), current_member_id());
  v_label := case p_category when 'briga' then 'Combinado: convivência entre irmãs'
                             when 'escola' then 'Combinado: comportamento na escola'
                             when 'comportamento' then 'Combinado: comportamento'
                             when 'bonus' then 'Bônus especial 🌟' else 'Ajuste de pontos' end;
  insert into notifications (member_id, title, body, kind)
  values (p_member, v_label, (case when p_delta > 0 then '+' else '' end) || p_delta || ' pontos — ' || trim(p_reason)
          || case when p_delta < 0 then '. Amanhã é uma nova chance 💜' else '' end, 'adjust');
end $$;

-- =====================================================================
-- PROGRESSO / RESUMOS
-- =====================================================================
-- Pontos possíveis projetados (dias ainda não gerados) para um intervalo.
create or replace function public.projected_possible(p_member uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.points), 0)::int
    from generate_series(p_from, p_to, interval '1 day') g(d)
    join rotation r on r.weekday = extract(dow from g.d)::int and r.member_id = p_member and r.active
    join task_types t on t.id = r.task_type_id and t.active and not t.optional
   where p_from <= p_to $$;

create or replace function public.member_stats(p_member uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (select * from assignments where member_id = p_member and date between p_from and p_to),
       s as (select late_factor lf from settings where id = 1)
  select jsonb_build_object(
    'earned', coalesce((select sum(points_awarded) from a where status = 'approved'), 0)
            + coalesce((select sum(delta) from point_adjustments where member_id = p_member and date between p_from and p_to), 0),
    'provisional', coalesce((select sum(case when on_time then points_max else round(points_max * s.lf) end) from a, s where status = 'awaiting'), 0),
    'possible', coalesce((select sum(points_max) from a where not optional and status <> 'excused'), 0),
    'excused_points', coalesce((select sum(points_max) from a where not optional and status = 'excused'), 0),
    'count_total', (select count(*) from a where not optional and status <> 'excused'),
    'count_approved', (select count(*) from a where status = 'approved'),
    'count_on_time', (select count(*) from a where status = 'approved' and on_time),
    'count_late', (select count(*) from a where status = 'approved' and not on_time),
    'count_awaiting', (select count(*) from a where status = 'awaiting'),
    'count_pending', (select count(*) from a where status = 'pending' and not optional),
    'count_missed', (select count(*) from a where status = 'missed' or (status = 'pending' and date < today_sp() and not optional)),
    'count_rejected', (select count(*) from a where status = 'rejected'),
    'count_excused', (select count(*) from a where status = 'excused'),
    'adjustments', coalesce((select sum(delta) from point_adjustments where member_id = p_member and date between p_from and p_to), 0),
    'penalties', coalesce((select sum(delta) from point_adjustments where member_id = p_member and date between p_from and p_to and delta < 0), 0),
    'bonus', coalesce((select sum(delta) from point_adjustments where member_id = p_member and date between p_from and p_to and delta > 0), 0),
    'count_penalties', (select count(*) from point_adjustments where member_id = p_member and date between p_from and p_to and delta < 0)
  ) $$;

-- Resumo da família (todas veem números gerais; detalhes ficam com os pais).
create or replace function public.family_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := today_sp(); v_ms date; v_me date; v_ws date; r jsonb := '[]'::jsonb; m members;
        st settings; t jsonb; w jsonb; mo jsonb; v_proj int; g_earned numeric := 0; g_poss numeric := 0; g_proj numeric := 0;
begin
  if not is_member() then raise exception 'Acesso negado'; end if;
  select * into st from settings where id = 1;
  v_ms := date_trunc('month', v_today)::date; v_me := (v_ms + interval '1 month - 1 day')::date;
  v_ws := v_today - ((extract(isodow from v_today)::int) - 1);
  for m in select * from members where role = 'child' and active order by sort loop
    t := member_stats(m.id, v_today, v_today);
    w := member_stats(m.id, greatest(v_ws, st.start_date), v_today);
    mo := member_stats(m.id, greatest(v_ms, st.start_date), v_today);
    v_proj := (mo->>'possible')::int + projected_possible(m.id, greatest(v_today + 1, st.start_date), v_me);
    g_earned := g_earned + (mo->>'earned')::numeric; g_poss := g_poss + (mo->>'possible')::numeric; g_proj := g_proj + v_proj;
    r := r || jsonb_build_object('id', m.id, 'name', m.name, 'avatar', m.avatar, 'color', m.color, 'photo_path', m.photo_path,
      'today', t, 'week', w, 'month', mo || jsonb_build_object('projected_possible', v_proj));
  end loop;
  return jsonb_build_object('today', v_today, 'month_start', v_ms, 'month_end', v_me, 'week_start', v_ws,
    'days_left', (v_me - v_today), 'individual_goal', st.individual_goal, 'group_goal', st.group_goal,
    'children', r, 'group', jsonb_build_object('earned', g_earned, 'possible', g_poss, 'projected_possible', g_proj));
end $$;

-- Relatório de um mês (pais: todas; criança: somente ela).
create or replace function public.month_report(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ms date := date_trunc('month', p_month)::date; v_me date; v_to date; st settings; m members; s jsonb;
        r jsonb := '[]'::jsonb; g_e numeric := 0; g_p numeric := 0; all_ok boolean := true; pct numeric; v_parent boolean := is_parent();
begin
  if not is_member() then raise exception 'Acesso negado'; end if;
  select * into st from settings where id = 1;
  v_me := (v_ms + interval '1 month - 1 day')::date;
  v_to := least(v_me, today_sp());
  for m in select * from members where role = 'child' and active order by sort loop
    s := member_stats(m.id, greatest(v_ms, st.start_date), v_to);
    pct := case when (s->>'possible')::numeric > 0 then round(100 * (s->>'earned')::numeric / (s->>'possible')::numeric, 1) else null end;
    g_e := g_e + (s->>'earned')::numeric; g_p := g_p + (s->>'possible')::numeric;
    if pct is null or pct < st.individual_goal then all_ok := false; end if;
    if v_parent or m.id = current_member_id() then
      r := r || (s || jsonb_build_object('id', m.id, 'name', m.name, 'avatar', m.avatar, 'color', m.color, 'pct', pct,
                 'goal_met', coalesce(pct >= st.individual_goal, false)));
    end if;
  end loop;
  return jsonb_build_object('month', v_ms, 'until', v_to, 'individual_goal', st.individual_goal, 'group_goal', st.group_goal,
    'children', r, 'group_earned', g_e, 'group_possible', g_p,
    'group_pct', case when g_p > 0 then round(100 * g_e / g_p, 1) end,
    'group_goal_met', g_p > 0 and round(100 * g_e / g_p, 1) >= st.group_goal,
    'all_individual_met', all_ok,
    'unlocked', all_ok and g_p > 0 and round(100 * g_e / g_p, 1) >= st.group_goal,
    'closed', is_month_closed(v_ms));
end $$;

-- Fechamento auditado do mês.
create or replace function public.close_month(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ms date := date_trunc('month', p_month)::date; v_rep jsonb;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if v_ms >= date_trunc('month', today_sp())::date then raise exception 'Só é possível fechar meses que já terminaram'; end if;
  if is_month_closed(v_ms) then raise exception 'Este mês já foi fechado'; end if;
  perform sync_assignments();
  perform set_config('app.reason', 'Fechamento do mês', true);
  update assignments set status = 'missed' where status = 'pending' and not optional
     and date between v_ms and (v_ms + interval '1 month - 1 day')::date;
  -- pendentes de aprovação no fechamento: ficam sem pontos até revisão (avisar os pais)
  v_rep := month_report(v_ms);
  insert into month_closures (month, closed_by, unlocked, summary)
  values (v_ms, current_member_id(), (v_rep->>'unlocked')::boolean, v_rep);
  insert into monthly_rewards (month, status, budget)
  values (v_ms, case when (v_rep->>'unlocked')::boolean then 'voting' else 'locked' end,
          (select reward_budget from settings where id = 1))
  on conflict (month) do update set status = case when (v_rep->>'unlocked')::boolean and monthly_rewards.status = 'locked'
                                                  then 'voting' else monthly_rewards.status end,
                                     budget = coalesce(monthly_rewards.budget, excluded.budget);
  perform check_reward_consensus(v_ms);
  return v_rep;
end $$;

-- Correção após o fechamento (sempre com justificativa, fica no histórico).
create or replace function public.correct_closed_task(p_id uuid, p_status text, p_points int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare a assignments; v_ms date;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then raise exception 'Informe a justificativa da correção'; end if;
  if p_status not in ('approved','rejected','excused','missed') then raise exception 'Situação inválida'; end if;
  select * into a from assignments where id = p_id;
  if not found then raise exception 'Tarefa não encontrada'; end if;
  if p_points < 0 or p_points > a.points_max then raise exception 'Pontos devem ficar entre 0 e %', a.points_max; end if;
  v_ms := date_trunc('month', a.date)::date;
  perform set_config('app.allow_closed', 'on', true);
  perform set_config('app.reason', 'Correção após fechamento: ' || p_reason, true);
  update assignments set status = p_status, points_awarded = case when p_status = 'approved' then p_points else 0 end,
         reviewed_by = current_member_id(), reviewed_at = now(), note = trim(p_reason)
   where id = p_id;
  if is_month_closed(v_ms) then
    update month_closures set
      revisions = revisions || jsonb_build_array(jsonb_build_object('at', now(), 'by', member_name(current_member_id()),
                   'reason', p_reason, 'task', a.task_name, 'date', a.date, 'child', member_name(a.member_id))),
      summary = month_report(v_ms)
     where month = v_ms;
  end if;
  perform set_config('app.allow_closed', '', true);
end $$;

-- =====================================================================
-- RECOMPENSAS
-- =====================================================================
create or replace function public.check_reward_consensus(p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare v_kids int; v_votes int; v_distinct int; v_opt uuid; mr monthly_rewards;
begin
  select * into mr from monthly_rewards where month = p_month;
  if not found or mr.status <> 'voting' then return; end if;
  select count(*) into v_kids from members where role = 'child' and active;
  select count(*), count(distinct option_id), min(option_id::text)::uuid into v_votes, v_distinct, v_opt
    from reward_votes v join members m on m.id = v.member_id and m.role = 'child' and m.active where v.month = p_month;
  if v_votes = v_kids and v_kids > 0 and v_distinct = 1 then
    update monthly_rewards set status = 'awaiting_approval', chosen_option = v_opt where month = p_month;
    perform notify_parents('As meninas escolheram o prêmio! 🎁',
      (select title from reward_options where id = v_opt) || ' — aguardando a aprovação de vocês.', 'reward');
  end if;
end $$;

create or replace function public.vote_reward(p_month date, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_member_id(); mr monthly_rewards; v_cost numeric; v_ms date := date_trunc('month', p_month)::date;
begin
  if me is null then raise exception 'Acesso negado'; end if;
  if (select role from members where id = me) <> 'child' then raise exception 'A votação é das meninas 💜'; end if;
  insert into monthly_rewards (month, budget) values (v_ms, (select reward_budget from settings where id = 1)) on conflict do nothing;
  select * into mr from monthly_rewards where month = v_ms;
  if mr.status not in ('locked','voting') then raise exception 'A votação deste mês já terminou'; end if;
  select est_cost into v_cost from reward_options where id = p_option and active;
  if not found then raise exception 'Opção não encontrada'; end if;
  if v_cost is not null and mr.budget is not null and v_cost > mr.budget then raise exception 'Essa opção passa do orçamento combinado'; end if;
  insert into reward_votes (month, member_id, option_id) values (v_ms, me, p_option)
  on conflict (month, member_id) do update set option_id = excluded.option_id, created_at = now();
  perform check_reward_consensus(v_ms);
end $$;

create or replace function public.unlock_reward(p_month date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ms date := date_trunc('month', p_month)::date;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe o motivo'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into monthly_rewards (month, status, unlocked_manually, unlock_reason, budget)
  values (v_ms, 'voting', true, p_reason, (select reward_budget from settings where id = 1))
  on conflict (month) do update set status = 'voting', unlocked_manually = true, unlock_reason = p_reason
   where monthly_rewards.status = 'locked';
  perform check_reward_consensus(v_ms);
end $$;

create or replace function public.decide_reward(p_month date, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_ms date := date_trunc('month', p_month)::date; mr monthly_rewards;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  select * into mr from monthly_rewards where month = v_ms for update;
  if not found then raise exception 'Prêmio não encontrado'; end if;
  perform set_config('app.reason', coalesce(p_note, p_action), true);
  if p_action = 'approve' and mr.status = 'awaiting_approval' then
    update monthly_rewards set status = 'approved', approved_by = current_member_id(), approved_at = now(), note = p_note where month = v_ms;
    insert into notifications (member_id, title, body, kind)
      select id, 'Prêmio aprovado! 🎉', (select title from reward_options where id = mr.chosen_option), 'reward'
        from members where role = 'child' and active;
  elsif p_action = 'revote' and mr.status = 'awaiting_approval' then
    delete from reward_votes where month = v_ms;
    update monthly_rewards set status = 'voting', chosen_option = null, note = p_note where month = v_ms;
  elsif p_action = 'done' and mr.status = 'approved' then
    update monthly_rewards set status = 'done', done_at = now(), note = coalesce(p_note, note) where month = v_ms;
  elsif p_action = 'budget' then
    update monthly_rewards set budget = nullif(p_note, '')::numeric where month = v_ms;
  else
    raise exception 'Ação não permitida agora';
  end if;
end $$;

-- =====================================================================
-- DIA DA FAMÍLIA / MISSÕES / NOTIFICAÇÕES
-- =====================================================================
create or replace function public.next_family_day() returns date
language sql stable security definer set search_path = public as $$
  select today_sp() + ((family_day_weekday - extract(dow from today_sp())::int + 7) % 7) from settings where id = 1 $$;

create or replace function public.vote_family_day(p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_member_id();
begin
  if me is null then raise exception 'Acesso negado'; end if;
  insert into family_day_votes (date, member_id, option_id) values (next_family_day(), me, p_option)
  on conflict (date, member_id) do update set option_id = excluded.option_id, created_at = now();
end $$;

create or replace function public.complete_family_mission(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Acesso negado'; end if;
  update family_missions set done_at = now(), done_by = current_member_id() where id = p_id and done_at is null;
  perform notify_parents('Missão em família concluída 🤝', (select title from family_missions where id = p_id), 'mission');
end $$;

create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where member_id = current_member_id() and read_at is null $$;
-- =====================================================================
-- PERMISSÕES NO BANCO (Row Level Security)
-- Crianças: leem o que é da família, alteram somente pelas funções seguras.
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['settings','members','task_types','rotation','schedule_blocks','assignments','generated_days',
    'point_adjustments','month_closures','audit_log','notifications','gratitude','reward_options','monthly_rewards',
    'reward_votes','family_day_options','family_day_votes','family_missions','app_pulse'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- leitura para membros da família
create policy "membros leem" on public.settings for select to authenticated using (is_member());
create policy "membros leem" on public.members for select to authenticated using (is_member());
create policy "membros leem" on public.task_types for select to authenticated using (is_member());
create policy "membros leem" on public.rotation for select to authenticated using (is_member());
create policy "membros leem" on public.schedule_blocks for select to authenticated using (is_member());
create policy "membros leem" on public.month_closures for select to authenticated using (is_member());
create policy "membros leem" on public.gratitude for select to authenticated using (is_member());
create policy "membros leem" on public.reward_options for select to authenticated using (is_member());
create policy "membros leem" on public.monthly_rewards for select to authenticated using (is_member());
create policy "membros leem" on public.reward_votes for select to authenticated using (is_member());
create policy "membros leem" on public.family_day_options for select to authenticated using (is_member());
create policy "membros leem" on public.family_day_votes for select to authenticated using (is_member());
create policy "membros leem" on public.family_missions for select to authenticated using (is_member());
create policy "membros leem" on public.app_pulse for select to authenticated using (is_member());

-- tarefas e ajustes: pais veem tudo; cada criança vê só as suas
create policy "pais ou dona" on public.assignments for select to authenticated
  using (is_parent() or member_id = current_member_id());
create policy "pais ou dona" on public.point_adjustments for select to authenticated
  using (is_parent() or member_id = current_member_id());
-- histórico: somente pais
create policy "pais leem" on public.audit_log for select to authenticated using (is_parent());
-- notificações: cada um as suas
create policy "minhas" on public.notifications for select to authenticated using (member_id = current_member_id());

-- escrita direta: somente responsáveis (configurações)
create policy "pais alteram" on public.settings for update to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.members for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.task_types for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.rotation for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.schedule_blocks for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.family_day_options for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.family_missions for all to authenticated using (is_parent()) with check (is_parent());
create policy "pais alteram" on public.reward_options for update to authenticated using (is_parent()) with check (is_parent());
create policy "pais apagam" on public.reward_options for delete to authenticated using (is_parent());

-- qualquer membro sugere prêmio (em seu nome) e escreve no mural (em seu nome)
create policy "sugerir" on public.reward_options for insert to authenticated
  with check (is_member() and suggested_by = current_member_id() and active);
create policy "escrever" on public.gratitude for insert to authenticated
  with check (is_member() and from_member = current_member_id() and to_member <> from_member
              and (kind = 'gratidao' or is_parent()));
create policy "apagar" on public.gratitude for delete to authenticated
  using (is_parent() or from_member = current_member_id());

-- funções internas não podem ser chamadas por visitantes
revoke execute on all functions in schema public from anon, public;
grant execute on function public.login_tiles(text) to anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['claim_membership(text)','set_child_pin(uuid,text)','set_my_avatar(text)','sync_assignments()','refresh_today()','complete_task(uuid)',
    'undo_complete(uuid)','review_task(uuid,boolean,text)','excuse_task(uuid,text)','mark_missed(uuid,text)',
    'reopen_task(uuid,text)','reschedule_task(uuid,date,text)','adjust_points(uuid,integer,text,date,text)',
    'family_summary()','month_report(date)','close_month(date)','correct_closed_task(uuid,text,integer,text)',
    'vote_reward(date,uuid)','unlock_reward(date,text)','decide_reward(date,text,text)','next_family_day()',
    'vote_family_day(uuid)','complete_family_mission(uuid)','mark_notifications_read()',
    'is_member()','is_parent()','current_member_id()','today_sp()','is_month_closed(date)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- tempo real (Supabase Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.app_pulse, public.notifications;
  end if;
end $$;
-- =====================================================================
-- DADOS INICIAIS — rodízio real, horários e opções
-- =====================================================================
insert into public.task_types (id, name, icon, points, category, default_start, default_due, guidance, optional, sort) values
 ('lavar_louca',   'Lavar a louça',                       '🍽️', 10, 'casa',   '13:15', '13:45', 'Use só detergente comum. Facas afiadas e panelas pesadas: chame um adulto.', false, 1),
 ('secar_louca',   'Secar e guardar a louça',             '🧺',  5, 'casa',   '13:15', '13:45', 'Guarde com cuidado o que for de vidro.', false, 2),
 ('guardar_alimentos','Guardar os alimentos do almoço',   '🥡',  5, 'casa',   '13:15', '13:45', 'Se a comida ainda estiver quente, chame um adulto antes de guardar.', false, 3),
 ('varrer',        'Varrer a casa',                       '🧹', 10, 'casa',   '13:15', '13:45', null, false, 4),
 ('banheiro',      'Organização leve do banheiro',        '🚿', 10, 'casa',   '13:15', '13:45', 'Organização leve: toalhas, pia e objetos no lugar. Nada de produtos químicos fortes.', false, 5),
 ('dobrar_roupas', 'Dobrar roupas',                       '👕',  5, 'casa',   '13:15', '13:45', null, false, 6),
 ('organizar',     'Organizar quarto, sala e pertences',  '🛏️',  5, 'casa',   '13:15', '13:45', 'De 5 a 10 minutinhos já fazem diferença!', false, 7),
 ('estudos',       'Deveres escolares e estudos',         '📚', 10, 'estudo', '13:45', '14:30', null, false, 8),
 ('leitura',       'Leitura de 20 minutos',               '📖',  5, 'estudo', '14:30', '14:50', null, false, 9),
 ('celular',       'Respeitar o horário do celular',      '📱',  5, 'rotina', '14:50', '15:50', 'Celular só no horário combinado: 14h50 às 15h50.', false, 10),
 ('mochila',       'Preparar mochila e uniforme',         '🎒',  5, 'rotina', '17:30', '19:30', null, false, 11),
 ('fogao',         'Limpar o fogão frio (opcional)',      '✨',  0, 'opcional','13:15','13:45', 'SOMENTE com o fogão completamente frio, com supervisão e autorização de um adulto. Só pano úmido.', true, 12);

insert into public.schedule_blocks (weekdays, start_time, end_time, label, icon, sort) values
 ('{1,2,3,4,5}', '12:30', '13:15', 'Almoço e descanso', '🍲', 1),
 ('{1,2,3,4,5}', '13:15', '13:45', 'Tarefas domésticas', '🧹', 2),
 ('{1,2,3,4,5}', '13:45', '14:30', 'Deveres escolares e estudos', '📚', 3),
 ('{1,2,3,4,5}', '14:30', '14:50', 'Leitura de 20 minutos', '📖', 4),
 ('{1,2,3,4,5}', '14:50', '15:50', 'Tempo combinado de celular', '📱', 5),
 ('{1,2,3,4,5}', '15:50', '17:30', 'Lanche, brincadeiras e tempo livre', '🧃', 6),
 ('{1,2,3,4,5}', '17:30', null,    'Banho, mochila, uniforme e convivência familiar', '🛁', 7),
 ('{0,6}',       '09:00', '18:00', 'Fim de semana: organização do banheiro e atividades opcionais', '☀️', 8);

insert into public.members (name, role, color, avatar, sort) values
 ('Filha A', 'child', '#ec4899', '🦋', 1),
 ('Filha B', 'child', '#8b5cf6', '🌻', 2),
 ('Filha C', 'child', '#10b981', '🐬', 3);

-- Rodízio EXATO (0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb)
with k as (select id from members where name = 'Filha A'),
     l as (select id from members where name = 'Filha B'),
     v as (select id from members where name = 'Filha C'),
     plan(weekday, who, task) as (values
  (1,'K','lavar_louca'),
  (1,'L','secar_louca'),(1,'L','guardar_alimentos'),(1,'L','dobrar_roupas'),
  (1,'V','varrer'),(1,'V','banheiro'),
  (2,'K','varrer'),(2,'K','banheiro'),
  (2,'L','lavar_louca'),
  (2,'V','secar_louca'),(2,'V','guardar_alimentos'),
  (3,'K','secar_louca'),(3,'K','guardar_alimentos'),(3,'K','dobrar_roupas'),
  (3,'L','varrer'),(3,'L','banheiro'),
  (3,'V','lavar_louca'),
  (4,'K','lavar_louca'),
  (4,'L','secar_louca'),(4,'L','guardar_alimentos'),
  (4,'V','varrer'),(4,'V','banheiro'),
  (5,'K','varrer'),(5,'K','banheiro'),
  (5,'L','lavar_louca'),
  (5,'V','secar_louca'),(5,'V','guardar_alimentos'),(5,'V','dobrar_roupas'),
  (6,'L','banheiro'),
  (0,'V','banheiro'))
insert into public.rotation (weekday, member_id, task_type_id, due_time)
select p.weekday,
       case p.who when 'K' then (select id from k) when 'L' then (select id from l) else (select id from v) end,
       p.task,
       case when p.weekday in (0,6) then '18:00'::time end
  from plan p;

-- Rotina de segunda a sexta para as três
insert into public.rotation (weekday, member_id, task_type_id)
select d, m.id, t from members m, generate_series(1,5) d,
  unnest(array['organizar','estudos','leitura','celular','mochila']) t
 where m.role = 'child';


insert into public.reward_options (title, emoji, est_cost, description) values
 ('Passeio especial', '🎡', 150, 'Um passeio escolhido pelas três'),
 ('Cinema', '🎬', 120, 'Filme no cinema com pipoca'),
 ('Piquenique', '🧺', 60, 'Piquenique no parque'),
 ('Noite de pizza', '🍕', 100, 'Pizza em casa com a família'),
 ('Presente coletivo', '🎁', 150, 'Um presente para as três dividirem'),
 ('Experiência em família', '🌈', 100, 'Uma experiência especial juntos');

insert into public.family_day_options (title, emoji) values
 ('Jogos de tabuleiro', '🎲'), ('Filme em família', '🎬'), ('Roda de conversa', '💬'),
 ('Brincadeiras', '🤸'), ('Lanche especial juntos', '🍪'), ('Música e dança', '🎶');

insert into public.family_missions (title, emoji, description) values
 ('Organizar uma estante juntas', '📚', 'As três escolhem uma estante e deixam tudo lindo.'),
 ('Preparar uma brincadeira para a família', '🎈', 'Inventem uma brincadeira para o Dia da Família.'),
 ('Escolher um livro para ler juntas', '📖', 'Escolham um livro e combinem um capítulo por semana.'),
 ('Ajudar a preparar o Dia da Família', '🎉', 'Decoração, lanche ou convite — vocês decidem!'),
 ('Limpar o fogão frio (quinta)', '✨', 'Opcional, sem pontos. SOMENTE com o fogão completamente frio e com um adulto junto. Só pano úmido.');
-- Fotos privadas das meninas (somente membros logados da família veem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "familia ve fotos" on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.is_member());
create policy "pais enviam fotos" on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.is_parent());
create policy "pais trocam fotos" on storage.objects for update to authenticated using (bucket_id = 'fotos' and public.is_parent());
create policy "pais apagam fotos" on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.is_parent());
-- =====================================================================
-- AUSÊNCIAS E MUDANÇAS DE HORÁRIO (por período, para uma ou todas)
-- Ex.: Filha A na casa da mãe no fim de semana; estudos até 15h em um dia.
-- =====================================================================
alter table public.assignments add column if not exists override_id uuid;

create table if not exists public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ausencia','horario')),
  date_from date not null,
  date_to date not null,
  member_id uuid references public.members(id) on delete cascade,   -- vazio = todas as meninas
  scope text not null default 'todas',                                -- todas | casa | estudo | rotina | id da tarefa
  new_due time,
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid references public.members(id),
  created_at timestamptz not null default now(),
  active boolean not null default true,
  check (date_to >= date_from and date_to - date_from <= 92),
  check (kind = 'ausencia' or new_due is not null)
);
alter table public.schedule_overrides enable row level security;
revoke all on public.schedule_overrides from anon;
drop policy if exists "pais ou dona" on public.schedule_overrides;
create policy "pais ou dona" on public.schedule_overrides for select to authenticated
  using (is_parent() or (is_member() and (member_id is null or member_id = current_member_id())));

drop trigger if exists pulse_schedule_overrides on public.schedule_overrides;
create trigger pulse_schedule_overrides after insert or update or delete on public.schedule_overrides
  for each statement execute function public.bump_pulse();
drop trigger if exists audit_schedule_overrides on public.schedule_overrides;
create trigger audit_schedule_overrides after insert or update or delete on public.schedule_overrides
  for each row execute function public.audit_trigger();

-- Aplica uma ausência/mudança às tarefas já criadas (somente pendentes, mês aberto).
create or replace function public.apply_override(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare o schedule_overrides; n int := 0;
begin
  select * into o from schedule_overrides where id = p_id and active;
  if not found then return 0; end if;
  perform set_config('app.reason', o.reason, true);
  if o.kind = 'ausencia' then
    update assignments a set status = 'excused', points_awarded = 0, override_id = o.id,
           note = 'Ausência: ' || o.reason, reviewed_by = o.created_by, reviewed_at = now()
      from task_types t
     where t.id = a.task_type_id and a.status = 'pending'
       and a.date between o.date_from and o.date_to
       and (o.member_id is null or a.member_id = o.member_id)
       and (o.scope = 'todas' or o.scope = t.category or o.scope = a.task_type_id)
       and not is_month_closed(a.date);
  else
    update assignments a set due_at = ((a.date + o.new_due)::timestamp at time zone 'America/Sao_Paulo'), override_id = o.id
      from task_types t
     where t.id = a.task_type_id and a.status = 'pending'
       and a.date between o.date_from and o.date_to
       and (o.member_id is null or a.member_id = o.member_id)
       and (o.scope = 'todas' or o.scope = t.category or o.scope = a.task_type_id)
       and not is_month_closed(a.date)
       and a.due_at is distinct from ((a.date + o.new_due)::timestamp at time zone 'America/Sao_Paulo');
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.add_override(p_kind text, p_from date, p_to date, p_member uuid, p_scope text,
  p_new_due time, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe o motivo'; end if;
  if p_to < p_from then raise exception 'A data final é antes da inicial'; end if;
  if p_member is not null and (select role from members where id = p_member) <> 'child' then raise exception 'Escolha uma das meninas'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into schedule_overrides (kind, date_from, date_to, member_id, scope, new_due, reason, created_by)
  values (p_kind, p_from, p_to, p_member, coalesce(nullif(p_scope, ''), 'todas'),
          case when p_kind = 'horario' then p_new_due end, trim(p_reason), current_member_id())
  returning id into v_id;
  n := apply_override(v_id);
  if p_kind = 'ausencia' then
    insert into notifications (member_id, title, body, kind)
    select id, 'Ausência registrada', name || ': ' || to_char(p_from, 'DD/MM') ||
           case when p_to <> p_from then ' a ' || to_char(p_to, 'DD/MM') else '' end || ' — ' || trim(p_reason), 'info'
      from members where role = 'child' and active and (p_member is null or id = p_member);
  end if;
  return jsonb_build_object('id', v_id, 'tarefas_alteradas', n);
end $$;

create or replace function public.cancel_override(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare o schedule_overrides; n int := 0;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  select * into o from schedule_overrides where id = p_id;
  if not found then raise exception 'Registro não encontrado'; end if;
  perform set_config('app.reason', 'Cancelada: ' || o.reason, true);
  update schedule_overrides set active = false where id = p_id;
  if o.kind = 'ausencia' then
    update assignments set status = 'pending', note = null, override_id = null, reviewed_by = null, reviewed_at = null
     where override_id = p_id and status = 'excused' and not is_month_closed(date);
  else
    update assignments a set due_at = ((a.date + t.default_due)::timestamp at time zone 'America/Sao_Paulo'),
           override_id = null
      from task_types t
     where a.override_id = p_id and a.status = 'pending' and t.id = a.task_type_id and not is_month_closed(a.date);
    update assignments a set due_at = ((a.date + r.due_time)::timestamp at time zone 'America/Sao_Paulo')
      from rotation r
     where a.date between o.date_from and o.date_to and a.status = 'pending' and a.override_id is null
       and r.member_id = a.member_id and r.task_type_id = a.task_type_id and r.weekday = extract(dow from a.date)::int
       and r.due_time is not null and not is_month_closed(a.date);
  end if;
  get diagnostics n = row_count;
  -- reaplica outras mudanças ainda ativas no mesmo período
  perform apply_override(id) from schedule_overrides
   where active and id <> p_id and date_from <= o.date_to and date_to >= o.date_from order by created_at;
  return n;
end $$;

-- Muda o prazo de uma tarefa só naquele dia.
create or replace function public.set_task_due(p_id uuid, p_time time, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Informe o motivo'; end if;
  perform set_config('app.reason', 'Novo prazo ' || to_char(p_time, 'HH24:MI') || ': ' || p_reason, true);
  update assignments set due_at = ((date + p_time)::timestamp at time zone 'America/Sao_Paulo')
   where id = p_id and status = 'pending';
  if not found then raise exception 'Só dá para mudar o prazo de tarefas pendentes'; end if;
end $$;

-- Geração diária agora respeita ausências e horários especiais.
create or replace function public.sync_assignments() returns void
language plpgsql security definer set search_path = public as $$
declare d date; v_start date; v_today date := today_sp(); v_first date;
begin
  if not is_member() then raise exception 'Acesso negado'; end if;
  perform pg_advisory_xact_lock(4243);
  select start_date into v_start from settings where id = 1;
  select coalesce(max(date) + 1, v_start) into d from generated_days;
  if d < v_start then d := v_start; end if;
  v_first := d;
  while d <= v_today loop
    insert into assignments (date, member_id, task_type_id, task_name, icon, points_max, optional, due_at)
    select d, r.member_id, t.id, t.name, t.icon, t.points, t.optional,
           ((d + coalesce(r.due_time, t.default_due))::timestamp at time zone 'America/Sao_Paulo')
      from rotation r join task_types t on t.id = r.task_type_id join members m on m.id = r.member_id
     where r.weekday = extract(dow from d)::int and r.active and t.active and m.active
    on conflict do nothing;
    insert into generated_days (date) values (d) on conflict do nothing;
    d := d + 1;
  end loop;
  if v_first <= v_today then
    perform apply_override(id) from schedule_overrides
     where active and date_to >= v_first and date_from <= v_today order by created_at;
  end if;
end $$;

-- Pontos possíveis futuros descontam ausências já registradas.
create or replace function public.projected_possible(p_member uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.points), 0)::int
    from generate_series(p_from, p_to, interval '1 day') g(d)
    join rotation r on r.weekday = extract(dow from g.d)::int and r.member_id = p_member and r.active
    join task_types t on t.id = r.task_type_id and t.active and not t.optional
   where p_from <= p_to
     and not exists (select 1 from schedule_overrides o
                      where o.active and o.kind = 'ausencia' and g.d::date between o.date_from and o.date_to
                        and (o.member_id is null or o.member_id = p_member)
                        and (o.scope = 'todas' or o.scope = t.category or o.scope = t.id)) $$;

revoke execute on function public.apply_override(uuid) from anon, public;
grant execute on function public.add_override(text, date, date, uuid, text, time, text) to authenticated;
grant execute on function public.cancel_override(uuid) to authenticated;
grant execute on function public.set_task_due(uuid, time, text) to authenticated;
revoke execute on function public.add_override(text, date, date, uuid, text, time, text) from anon, public;
revoke execute on function public.cancel_override(uuid) from anon, public;
revoke execute on function public.set_task_due(uuid, time, text) from anon, public;
