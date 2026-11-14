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
