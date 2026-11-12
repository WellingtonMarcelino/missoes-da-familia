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
