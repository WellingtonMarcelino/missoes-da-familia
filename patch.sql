-- =====================================================================
-- TAREFAS EXTRAS (um dia, para uma ou mais meninas)
-- =====================================================================
create or replace function public.add_extra_task(p_members uuid[], p_date date, p_name text, p_icon text,
  p_points int, p_due time, p_guidance text default null, p_optional boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare v_id text := 'extra_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10); n int;
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  if coalesce(length(trim(p_name)), 0) < 2 or length(p_name) > 80 then raise exception 'Escreva o nome da tarefa'; end if;
  if p_points is null or p_points < 0 or p_points > 50 then raise exception 'Pontos devem ficar entre 0 e 50'; end if;
  if p_date < today_sp() - 31 then raise exception 'Data muito antiga'; end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then raise exception 'Escolha pelo menos uma menina'; end if;
  perform set_config('app.reason', 'Tarefa extra: ' || trim(p_name), true);
  insert into task_types (id, name, icon, points, category, default_start, default_due, guidance, optional, sort, active)
  values (v_id, trim(p_name), coalesce(nullif(p_icon, ''), '⭐'), case when p_optional then 0 else p_points end,
          case when p_optional then 'opcional' else 'casa' end, null, p_due, nullif(trim(coalesce(p_guidance, '')), ''),
          coalesce(p_optional, false), 900, false);
  insert into assignments (date, member_id, task_type_id, task_name, icon, points_max, optional, due_at, note)
  select p_date, m.id, v_id, trim(p_name), coalesce(nullif(p_icon, ''), '⭐'), case when p_optional then 0 else p_points end,
         coalesce(p_optional, false), ((p_date + p_due)::timestamp at time zone 'America/Sao_Paulo'), 'Tarefa extra'
    from members m where m.id = any(p_members) and m.role = 'child' and m.active;
  get diagnostics n = row_count;
  insert into notifications (member_id, title, body, kind)
  select m.id, 'Nova missão extra ⭐', trim(p_name) || ' — ' || to_char(p_date, 'DD/MM') || ' até ' || to_char(p_due, 'HH24"h"MI'), 'info'
    from members m where m.id = any(p_members) and m.role = 'child' and m.active;
  return n;
end $$;

-- Apaga uma tarefa extra que ainda não foi feita.
create or replace function public.remove_extra_task(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_parent() then raise exception 'Somente responsáveis'; end if;
  perform set_config('app.reason', 'Tarefa extra apagada', true);
  delete from assignments where id = p_id and task_type_id like 'extra\_%' and status = 'pending';
  if not found then raise exception 'Só dá para apagar tarefas extras ainda pendentes'; end if;
end $$;

-- Pontos possíveis futuros incluem as tarefas extras já marcadas para os próximos dias.
create or replace function public.projected_possible(p_member uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select (
    select coalesce(sum(t.points), 0)::int
      from generate_series(p_from, p_to, interval '1 day') g(d)
      join rotation r on r.weekday = extract(dow from g.d)::int and r.member_id = p_member and r.active
      join task_types t on t.id = r.task_type_id and t.active and not t.optional
     where p_from <= p_to
       and not exists (select 1 from schedule_overrides o
                        where o.active and o.kind = 'ausencia' and g.d::date between o.date_from and o.date_to
                          and (o.member_id is null or o.member_id = p_member)
                          and (o.scope = 'todas' or o.scope = t.category or o.scope = t.id))
  ) + (
    select coalesce(sum(points_max), 0)::int from assignments
     where member_id = p_member and date between p_from and p_to and not optional and status <> 'excused'
  ) $$;

revoke execute on function public.add_extra_task(uuid[], date, text, text, int, time, text, boolean) from anon, public;
revoke execute on function public.remove_extra_task(uuid) from anon, public;
grant execute on function public.add_extra_task(uuid[], date, text, text, int, time, text, boolean) to authenticated;
grant execute on function public.remove_extra_task(uuid) to authenticated;
