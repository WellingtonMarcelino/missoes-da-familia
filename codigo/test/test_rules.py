"""Testes obrigatórios do app Missões da Nossa Família (banco local que imita o Supabase)."""
import psycopg2, json, sys, datetime as dt

conn = psycopg2.connect(host='/tmp', user='postgres', dbname='t')
conn.autocommit = True
results = []

def q(sql, args=None, as_user=None, one=False):
    cur = conn.cursor()
    cur.execute('begin')
    try:
        if as_user:
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (as_user,))
        cur.execute(sql, args)
        rows = cur.fetchall() if cur.description else None
        cur.execute('commit')
        return (rows[0][0] if rows else None) if one else rows
    except Exception:
        cur.execute('rollback')
        raise

def fails(sql, args=None, as_user=None):
    try:
        q(sql, args, as_user)
        return None
    except Exception as e:
        return str(e).split('\n')[0]

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('✅' if ok else '❌'), name, ('— ' + str(detail)) if detail else '')

def new_user(email):
    return q("insert into auth.users(email) values (%s) returning id::text", (email,), one=True)

# ---------- preparação ----------
q("update settings set start_date = '2026-10-01'")
pai = new_user('responsavel@gmail.com')
m_pai = q("select claim_membership('Wellington')", as_user=pai, one=True)
check('1º responsável vira administrador', m_pai and m_pai['role'] == 'parent')
q("insert into members(name, role, invite_email) values ('Esposa','parent','esposa@exemplo.com')", as_user=pai)
mae = new_user('esposa@exemplo.com')
m_mae = q("select claim_membership(null)", as_user=mae, one=True)
check('Esposa entra pelo convite', m_mae and m_mae['role'] == 'parent')
estranho = new_user('estranho@exemplo.com')
check('Pessoa sem convite não ganha acesso', q("select claim_membership('X')", as_user=estranho, one=True) is None)
check('Pessoa sem convite não vê dados', q("select count(*) from members", as_user=estranho, one=True) == 0)

kids = {}
for name in ['Filha A', 'Filha B', 'Filha C']:
    mid = q("select id::text from members where name=%s", (name,), one=True)
    q("select set_child_pin(%s, 'mf.4826.missoes')", (mid,), as_user=pai)
    uid = q("select user_id::text from members where id=%s", (mid,), one=True)
    email = q("select login_email from members where id=%s", (mid,), one=True)
    kids[name] = {'mid': mid, 'uid': uid, 'email': email}
check('E-mail interno das crianças usa o e-mail do responsável', kids['Filha A']['email'].startswith('responsavel+kaylane'), kids['Filha A']['email'])
code = q("select family_code from settings", one=True)
check('PIN cria acesso já confirmado', q("select count(*) from auth.users where email_confirmed_at is not null and email like 'responsavel+%%'", one=True) == 3)
q("select set_child_pin(%s, 'mf.9999.missoes')", (kids['Filha A']['mid'],), as_user=pai)
check('Trocar PIN não cria conta nova', q("select count(*) from auth.users", one=True) == 6)
check('Criança não cria PIN', fails("select set_child_pin(%s, 'mf.1111.missoes')", (kids['Filha B']['mid'],), as_user=kids['Filha A']['uid']))
check('Tela de entrada exige código da família', fails("select login_tiles('ERRADO')") is None and q("select login_tiles('ERRADO')", one=True) is None)
check('Com o código, mostra as 3 meninas', len(q("select login_tiles(%s)", (code,), one=True)) == 3)

K, L, V = kids['Filha A'], kids['Filha B'], kids['Filha C']
q("select sync_assignments()", as_user=K['uid'])

def tasks(member, date):
    return sorted(r[0] for r in q("select task_type_id from assignments where member_id=%s and date=%s", (member['mid'], date)))

# ---------- rodízio ----------
check('Segunda 09/11: Filha A recebe lavar a louça', 'lavar_louca' in tasks(K, '2026-11-09'))
check('Terça 10/11: Filha B recebe lavar a louça', 'lavar_louca' in tasks(L, '2026-11-10'))
check('Quarta 11/11: Filha C recebe lavar a louça', 'lavar_louca' in tasks(V, '2026-11-11'))
sab = q("select m.name, a.task_type_id from assignments a join members m on m.id=a.member_id where date='2026-11-07'")
check('Sábado: somente Filha B, banheiro', sab == [('Filha B', 'banheiro')], sab)
dom = q("select m.name, a.task_type_id from assignments a join members m on m.id=a.member_id where date='2026-11-08'")
check('Domingo: somente Filha C, banheiro', dom == [('Filha C', 'banheiro')], dom)
banh = q("select count(distinct date) from assignments where task_type_id='banheiro' and date between '2026-11-02' and '2026-11-08'", one=True)
check('Banheiro todos os dias da semana', banh == 7)
fds_estudo = q("select count(*) from assignments where extract(dow from date) in (0,6) and task_type_id in ('estudos','leitura','celular','mochila')", one=True)
check('Fim de semana sem tarefas escolares obrigatórias', fds_estudo == 0)
check('Sem tarefa duplicada "fiz minha atividade do rodízio"', q("select count(*) from task_types where name ilike '%rodízio%'", one=True) == 0)
due = q("select to_char(due_at at time zone 'America/Sao_Paulo','HH24:MI') from assignments where member_id=%s and date='2026-11-09' and task_type_id='lavar_louca'", (K['mid'],), one=True)
check('Prazo das tarefas domésticas 13h45 (horário de Brasília)', due == '13:45', due)

# ---------- caso 1: no horário = 10 pontos ----------
a1 = q("select id::text from assignments where member_id=%s and task_type_id='lavar_louca' and date='2026-11-09'", (K['mid'],), one=True)
q("update assignments set due_at = now() + interval '15 minutes' where id=%s", (a1,))  # simula marcar às 13h30 (15 min antes do prazo)
r = q("select complete_task(%s)", (a1,), as_user=K['uid'], one=True)
check('Filha A marca: fica "aguardando aprovação" com horário do servidor', r['status'] == 'awaiting' and r['on_time'] is True and r['completed_at'])
seen = q("select status from assignments where id=%s", (a1,), as_user=pai, one=True)
notif = q("select title from notifications where member_id=%s order by created_at desc limit 1", (m_pai['id'],), as_user=pai, one=True)
check('Responsável vê na hora (outro aparelho) + aviso', seen == 'awaiting' and 'Filha A concluiu' in notif, notif)
r = q("select review_task(%s, true, null)", (a1,), as_user=pai, one=True)
check('Aprovada no horário = 10 pontos', r['points_awarded'] == 10, r['points_awarded'])

# ---------- caso 2: com atraso = 6 pontos ----------
a2 = q("select id::text from assignments where member_id=%s and task_type_id='lavar_louca' and date='2026-11-10'", (L['mid'],), one=True)
q("update assignments set due_at = now() - interval '15 minutes' where id=%s", (a2,))  # simula marcar às 14h (prazo 13h45)
r = q("select complete_task(%s)", (a2,), as_user=L['uid'], one=True)
check('Filha B marca atrasada: registra atraso', r['on_time'] is False)
q("update assignments set due_at = now() + interval '1 day' where id=%s", (a2,))  # aprovação tardia não muda nada
r = q("select review_task(%s, true, null)", (a2,), as_user=mae, one=True)
check('Aprovada com atraso = 6 pontos (60%) e aprovação posterior não altera', r['points_awarded'] == 6, r['points_awarded'])

# ---------- permissões ----------
a_v = q("select id::text from assignments where member_id=%s and date='2026-11-11' and task_type_id='lavar_louca'", (V['mid'],), one=True)
check('Criança não marca tarefa da irmã', fails("select complete_task(%s)", (a_v,), as_user=K['uid']))
check('Criança não altera pontos diretamente', q("update assignments set points_awarded=999 where id=%s returning 1", (a1,), as_user=K['uid']) == [] and q("select points_awarded from assignments where id=%s", (a1,), one=True) == 10)
check('Criança não altera pontos da irmã', q("update assignments set points_awarded=0 where id=%s returning 1", (a2,), as_user=K['uid']) == [])
check('Criança não usa ajuste de pontos', fails("select adjust_points(%s, 50, 'quero pontos')", (K['mid'],), as_user=K['uid']))
check('Criança não insere ajuste direto', fails("insert into point_adjustments(member_id, delta, reason) values (%s, 50, 'hack')", (K['mid'],), as_user=K['uid']))
q("select complete_task(%s)", (a_v,), as_user=V['uid'])
check('Criança não aprova a própria tarefa', fails("select review_task(%s, true, null)", (a_v,), as_user=V['uid']))
check('Criança só vê as próprias tarefas', q("select count(distinct member_id) from assignments", as_user=K['uid'], one=True) == 1)
check('Criança não vê histórico de auditoria', q("select count(*) from audit_log", as_user=K['uid'], one=True) == 0)
check('Criança não muda regras (rodízio)', q("delete from rotation returning 1", as_user=K['uid']) == [] and q("select count(*) from rotation", one=True) > 0)
check('Criança não muda metas', q("update settings set individual_goal=1 returning 1", as_user=K['uid']) == [])

# ---------- não pontuar duas vezes ----------
check('Não marca a mesma tarefa 2x', fails("select complete_task(%s)", (a1,), as_user=K['uid']))
check('Não aprova 2x', fails("select review_task(%s, true, null)", (a1,), as_user=pai))
check('Não existe a mesma tarefa 2x no dia', fails("insert into assignments(date, member_id, task_type_id, task_name, icon, points_max, due_at) values ('2026-11-09', %s, 'lavar_louca','x','x',10, now())", (K['mid'],)))

# ---------- dispensa justificada ----------
def month_stats(m):
    return q("select member_stats(%s, '2026-11-01', today_sp())", (m['mid'],), one=True)
before = month_stats(K)
a_ex = q("select id::text from assignments where member_id=%s and date='2026-11-10' and task_type_id='varrer'", (K['mid'],), one=True)
check('Dispensa exige justificativa', fails("select excuse_task(%s, '')", (a_ex,), as_user=pai))
q("select excuse_task(%s, 'Estava doente')", (a_ex,), as_user=pai)
after = month_stats(K)
check('Dispensa justificada tira a tarefa dos pontos possíveis', after['possible'] == before['possible'] - 10, (before['possible'], after['possible']))
check('Dispensa fica no histórico com motivo', q("select reason from audit_log where record_id=%s order by id desc limit 1", (a_ex,), one=True) == 'Estava doente')

# ---------- ajuste com justificativa ----------
q("select adjust_points(%s, 3, 'Ajudou a vizinha idosa')", (K['mid'],), as_user=pai)
check('Ajuste de pontos registrado com justificativa', month_stats(K)['adjustments'] == 3)

# ---------- descontos (briga / escola) ----------
e0 = month_stats(K)['earned']
q("select adjust_points(%s, -5, 'Briga com a irmã na hora do almoço', null, 'briga')", (K['mid'],), as_user=pai)
q("select adjust_points(%s, -5, 'Briga com a irmã na hora do almoço', null, 'briga')", (L['mid'],), as_user=pai)
check('Desconto por briga abate dos pontos ganhos', month_stats(K)['earned'] == e0 - 5 and month_stats(K)['count_penalties'] == 1)
q("select adjust_points(%s, -10, 'Bilhete da professora', null, 'escola')", (V['mid'],), as_user=mae)
check('Desconto por comportamento na escola registrado', month_stats(V)['penalties'] == -10)
check('Desconto precisa ser negativo', fails("select adjust_points(%s, 5, 'teste', null, 'briga')", (K['mid'],), as_user=pai))
check('Criança não aplica desconto na irmã', fails("select adjust_points(%s, -5, 'briguei', null, 'briga')", (L['mid'],), as_user=K['uid']))
check('Criança vê só os próprios descontos', q("select count(distinct member_id) from point_adjustments", as_user=K['uid'], one=True) == 1)
check('Criança recebe aviso do desconto', q("select count(*) from notifications where member_id=%s and kind='adjust'", (V['mid'],), one=True) == 1)
check('Desconto fica no histórico', q("select count(*) from audit_log where table_name='point_adjustments' and reason='Bilhete da professora'", one=True) == 1)

# ---------- ausências e horários ----------
def kst(member, d): return q("select status from assignments where member_id=%s and date=%s and task_type_id='organizar'", (member['mid'], d), one=True)
poss0 = month_stats(K)['possible']
r = q("select add_override('ausencia', '2026-11-05', '2026-11-06', %s, 'todas', null, 'Fim de semana na casa da mãe')", (K['mid'],), as_user=pai, one=True)
check('Ausência dispensa as tarefas do período', kst(K, '2026-11-05') == 'excused' and kst(L, '2026-11-05') == 'pending', r)
check('Ausência não prejudica a meta (sai dos pontos possíveis)', month_stats(K)['possible'] < poss0)
check('Criança não registra ausência', fails("select add_override('ausencia', '2026-11-12', '2026-11-12', %s, 'todas', null, 'quero folga')", (K['mid'],), as_user=K['uid']))
q("select cancel_override(%s)", (r['id'],), as_user=pai)
check('Cancelar ausência devolve as tarefas', kst(K, '2026-11-05') == 'pending' and month_stats(K)['possible'] == poss0)
# ausência futura: cria hoje e já reduz o possível projetado
proj0 = q("select family_summary()", as_user=pai, one=True)['children'][0]['month']['projected_possible']
q("select add_override('ausencia', '2026-11-20', '2026-11-22', %s, 'todas', null, 'Viagem com a mãe')", (K['mid'],), as_user=pai)
proj1 = q("select family_summary()", as_user=pai, one=True)['children'][0]['month']['projected_possible']
check('Ausência futura já ajusta a meta do mês', proj1 < proj0, (proj0, proj1))
# horário especial
q("select add_override('horario', '2026-11-13', '2026-11-13', null, 'estudo', '16:00', 'Reunião na escola')", as_user=mae)
hh = q("select distinct to_char(due_at at time zone 'America/Sao_Paulo','HH24:MI') from assignments a join task_types t on t.id=a.task_type_id where a.date='2026-11-13' and t.category='estudo' and a.status='pending'")
check('Mudança de horário do dia vale para todas', hh == [('16:00',)], hh)
a_m = q("select id::text from assignments where member_id=%s and date='2026-11-13' and task_type_id='mochila'", (V['mid'],), one=True)
q("select set_task_due(%s, '20:30', 'Chegamos tarde')", (a_m,), as_user=pai)
check('Mudar prazo de uma tarefa só', q("select to_char(due_at at time zone 'America/Sao_Paulo','HH24:MI') from assignments where id=%s", (a_m,), one=True) == '20:30')
check('Criança não muda prazo', fails("select set_task_due(%s, '23:00', 'quero mais tempo')", (a_m,), as_user=V['uid']))

# ---------- tarefas extras ----------
n = q("select add_extra_task(array[%s,%s]::uuid[], today_sp(), 'Arrumar o quintal', '🌿', 10, '23:59', null, false)", (K['mid'], L['mid']), as_user=pai, one=True)
check('Tarefa extra criada para as escolhidas', n == 2 and q("select count(*) from assignments where task_name='Arrumar o quintal' and member_id=%s", (V['mid'],), one=True) == 0)
q("select add_extra_task(array[%s]::uuid[], today_sp(), 'Arrumar o quintal', '🌿', 5, '23:59', null, false)", (K['mid'],), as_user=pai)
check('Pode haver duas tarefas extras no mesmo dia', q("select count(*) from assignments where task_name='Arrumar o quintal' and member_id=%s", (K['mid'],), one=True) == 2)
ex = q("select id::text from assignments where task_name='Arrumar o quintal' and member_id=%s and points_max=10", (K['mid'],), one=True)
q("update assignments set due_at = now() + interval '1 hour' where id=%s", (ex,))
q("select complete_task(%s)", (ex,), as_user=K['uid'])
check('Tarefa extra pontua normalmente', q("select review_task(%s, true, null)", (ex,), as_user=pai, one=True)['points_awarded'] == 10)
check('Criança não cria tarefa extra', fails("select add_extra_task(array[%s]::uuid[], today_sp(), 'Folga', '⭐', 50, '23:00', null, false)", (K['mid'],), as_user=K['uid']))
ex2 = q("select id::text from assignments where task_name='Arrumar o quintal' and member_id=%s and points_max=5", (K['mid'],), one=True)
q("select remove_extra_task(%s)", (ex2,), as_user=pai)
check('Apagar tarefa extra pendente', q("select count(*) from assignments where id=%s", (ex2,), one=True) == 0)
check('Não apaga tarefa feita', fails("select remove_extra_task(%s)", (ex,), as_user=pai))
pj0 = q("select family_summary()", as_user=pai, one=True)['children'][2]['month']['projected_possible']
q("select add_extra_task(array[%s]::uuid[], '2026-11-25', 'Ajudar na festa', '🎉', 10, '18:00', null, false)", (V['mid'],), as_user=pai)
pj1 = q("select family_summary()", as_user=pai, one=True)['children'][2]['month']['projected_possible']
check('Tarefa extra futura entra na meta do mês', pj1 == pj0 + 10, (pj0, pj1))

# ---------- fechamento do mês ----------
q("update assignments set status='awaiting', completed_at=due_at - interval '5 min', on_time=true where date between '2026-10-01' and '2026-10-31' and not optional")
q("select review_task(id, true, null) from assignments where status='awaiting' and date < '2026-11-01'", as_user=pai)
check('Mês atual não pode ser fechado antes de terminar', fails("select close_month('2026-11-01')", as_user=pai))
check('Criança não fecha o mês', fails("select close_month('2026-10-01')", as_user=K['uid']))
rep = q("select close_month('2026-10-01')", as_user=pai, one=True)
check('Outubro fechado: 100% e prêmio desbloqueado', rep['unlocked'] is True and rep['group_pct'] == 100, rep['group_pct'])
oct_task = q("select id::text from assignments where date='2026-10-05' and member_id=%s limit 1", (K['mid'],), one=True)
check('Mês fechado fica congelado', fails("select excuse_task(%s, 'teste de alteração')", (oct_task,), as_user=pai))
q("select correct_closed_task(%s, 'approved', 0, 'Corrigido: tarefa não foi feita de verdade')", (oct_task,), as_user=pai)
rev = q("select jsonb_array_length(revisions) from month_closures where month='2026-10-01'", one=True)
check('Correção após fechamento fica registrada', rev == 1)
check('Novo mês preserva o resultado anterior', q("select count(*) from assignments where date < '2026-11-01'", one=True) > 0
      and q("select month_report('2026-10-01')", as_user=pai, one=True)['closed'] is True)

# ---------- recompensas ----------
opt = q("select id::text from reward_options where title='Noite de pizza'", one=True)
check('Pais não votam no lugar das meninas', fails("select vote_reward('2026-10-01', %s)", (opt,), as_user=pai))
for k in (K, L):
    q("select vote_reward('2026-10-01', %s)", (opt,), as_user=k['uid'])
check('Com 2 votos ainda não há consenso', q("select status from monthly_rewards where month='2026-10-01'", one=True) == 'voting')
q("select vote_reward('2026-10-01', %s)", (opt,), as_user=V['uid'])
check('3 votos iguais = consenso, aguarda aprovação dos pais', q("select status from monthly_rewards where month='2026-10-01'", one=True) == 'awaiting_approval')
check('Criança não aprova prêmio', fails("select decide_reward('2026-10-01','approve')", as_user=K['uid']))
q("select decide_reward('2026-10-01','approve','Combinado!')", as_user=pai)
check('Pais aprovam o prêmio', q("select status from monthly_rewards where month='2026-10-01'", one=True) == 'approved')

# ---------- mural ----------
check('Criança escreve no mural em seu nome', fails("insert into gratitude(from_member,to_member,message) values (%s,%s,'Obrigada pela ajuda!')", (K['mid'], L['mid']), as_user=K['uid']) is None)
check('Criança não escreve em nome de outra', fails("insert into gratitude(from_member,to_member,message) values (%s,%s,'falso')", (L['mid'], V['mid']), as_user=K['uid']))
check('Mensagem dos pais chega como aviso', q("select count(*) from notifications where member_id=%s and kind='gratitude'", (L['mid'],), one=True) == 1)

# ---------- resumo ----------
s = q("select family_summary()", as_user=K['uid'], one=True)
check('Resumo da família funciona para criança', len(s['children']) == 3 and s['individual_goal'] == 80)

total = len(results); ok = sum(1 for r in results if r[1])
print(f'\n{ok}/{total} testes aprovados')
json.dump([{'teste': n, 'ok': o, 'detalhe': str(d)} for n, o, d in results], open('/home/claude/missoes/test/resultado.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if ok == total else 1)
