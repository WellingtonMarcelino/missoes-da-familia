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
