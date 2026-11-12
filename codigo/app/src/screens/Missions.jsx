import { useEffect, useState } from 'react'
import { useApp, Avatar, Progress, Section, Loading, Empty, Confetti, AskModal, Modal } from '../components'
import { rpc, sel, supabase, fmtTime, statusOf, pct, prettyDate, shortDate, timeStr, dow, monthStart, AVATARS, addDays } from '../lib'

export default function Missions({ memberId }) {
  const { me, members, version, isParent, toast, refresh, go } = useApp()
  const member = members.find((m) => m.id === memberId) || (memberId === me.id ? me : null)
  const [sum, setSum] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [monthTasks, setMonthTasks] = useState([])
  const [extra, setExtra] = useState({ closures: [], sent: 0 })
  const [confetti, setConfetti] = useState(false)
  const [busy, setBusy] = useState(null)
  const [ask, setAsk] = useState(null)
  const [pickAvatar, setPickAvatar] = useState(false)
  const [adjs, setAdjs] = useState([])

  useEffect(() => {
    if (!memberId) return
    rpc('family_summary').then(async (s) => {
      setSum(s)
      const [all, bl, cl, gr, adj] = await Promise.all([
        sel(supabase.from('assignments').select('*').eq('member_id', memberId).gte('date', s.month_start).lte('date', s.today).order('due_at')),
        sel(supabase.from('schedule_blocks').select('*').order('sort')),
        sel(supabase.from('month_closures').select('month, summary').order('month', { ascending: false }).limit(12)),
        sel(supabase.from('gratitude').select('id').eq('from_member', memberId)),
        sel(supabase.from('point_adjustments').select('*').eq('member_id', memberId).gte('date', s.month_start).order('created_at', { ascending: false })),
      ])
      setAdjs(adj)
      setMonthTasks(all)
      setTasks(all.filter((a) => a.date === s.today || (a.status === 'pending' && a.date < s.today && !a.optional)))
      setBlocks(bl.filter((b) => b.weekdays.includes(dow(s.today))))
      setExtra({ closures: cl, sent: gr.length })
    }).catch((e) => toast(e.message, 'err'))
  }, [memberId, version])

  if (!member) return <Empty icon="🔎">Perfil não encontrado.</Empty>
  if (!sum || !tasks) return <Loading />

  const k = sum.children.find((c) => c.id === memberId)
  const today = sum.today
  const isMine = memberId === me.id
  const todayTasks = tasks.filter((t) => t.date === today)
  const late = tasks.filter((t) => t.date < today)
  const monthPct = k ? pct(k.month.earned, k.month.possible) : 0
  const needed = k ? Math.max(0, Math.ceil((sum.individual_goal / 100) * k.month.projected_possible - k.month.earned)) : 0

  const act = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg); refresh() } catch (e) { toast(e.message, 'err') }
  }
  const complete = async (a) => {
    setBusy(a.id)
    try {
      await rpc('complete_task', { p_id: a.id })
      setConfetti(true); setTimeout(() => setConfetti(false), 1800)
      toast(isMine ? 'Muito bem! Agora é só esperar a aprovação 💜' : 'Marcado.')
      refresh()
    } catch (e) { toast(e.message, 'err') }
    setBusy(null)
  }

  const medals = computeMedals({ monthTasks, k, sum, closures: extra.closures, sent: extra.sent, memberId })

  return (
    <div className="stack">
      <Confetti show={confetti} />
      {isParent && <button className="link" onClick={() => go('')}>← voltar</button>}
      <div className="profile-head" style={{ '--kc': member.color }}>
        <button className="avatar-btn" onClick={() => isMine && member.role === 'child' && setPickAvatar(true)} aria-label="Trocar avatar"><Avatar member={member} size={76} /></button>
        <div>
          <h1>{isMine ? `Suas missões, ${member.name}!` : `Missões de ${member.name}`}</h1>
          <p>{prettyDate(today)}</p>
        </div>
      </div>

      {k && (
        <div className="score-row">
          <div className="score"><small>Hoje</small><b>{k.today.earned}</b><span>de {k.today.possible}{k.today.provisional ? ` · +${k.today.provisional} aguardando` : ''}</span></div>
          <div className="score"><small>Semana</small><b>{pct(k.week.earned, k.week.possible)}%</b><span>{k.week.earned} de {k.week.possible}</span></div>
          <div className="score"><small>Mês</small><b>{monthPct}%</b><span>meta {sum.individual_goal}%</span></div>
        </div>
      )}
      {k && <Section><Progress value={monthPct} goal={sum.individual_goal} color={member.color} label="Progresso do mês" />
        <p className="muted small">{needed > 0 ? `Faltam cerca de ${needed} pontos para a meta do mês · ${sum.days_left} dias restantes.` : 'Meta do mês no caminho certo! 🌟'}</p></Section>}

      {late.length > 0 && (
        <Section title="⏰ De dias anteriores">
          <p className="muted small">Ainda dá para marcar. Vai contar como atrasada (60% dos pontos).</p>
          {late.map((a) => <TaskCard key={a.id} a={a} today={today} busy={busy} canMark={isMine || isParent} onMark={complete} isParent={isParent} setAsk={setAsk} act={act} />)}
        </Section>
      )}

      <Section title="📋 Missões de hoje">
        {todayTasks.length === 0 ? <Empty icon="🌈">Nenhuma missão hoje. Aproveite o dia!</Empty> :
          todayTasks.map((a) => <TaskCard key={a.id} a={a} today={today} busy={busy} canMark={isMine || isParent} onMark={complete} isParent={isParent} setAsk={setAsk} act={act} />)}
      </Section>

      {blocks.length > 0 && (
        <Section title="🕐 Horários de hoje">
          <ul className="timeline">{blocks.map((b) => <li key={b.id}><span className="tl-time">{timeStr(b.start_time)}{b.end_time ? '–' + timeStr(b.end_time) : '+'}</span><span>{b.icon} {b.label}</span></li>)}</ul>
        </Section>
      )}

      {adjs.length > 0 && (
        <Section title="💬 Combinados do mês">
          <ul className="feed">{adjs.map((x) => <li key={x.id}><span><b className={x.delta < 0 ? 'neg' : 'pos'}>{x.delta > 0 ? '+' : ''}{x.delta} pts</b> · {{ briga: 'Convivência entre irmãs', escola: 'Comportamento na escola', comportamento: 'Comportamento', bonus: 'Bônus especial 🌟' }[x.category] || 'Ajuste'}</span><small>{shortDate(x.date)} · {x.reason}</small></li>)}</ul>
          {adjs.some((x) => x.delta < 0) && <p className="muted small">Todo mundo erra às vezes. O importante é conversar e tentar de novo. 💜</p>}
        </Section>
      )}

      <Section title="🏅 Conquistas">
        <div className="medals">{medals.map((m) => (
          <div key={m.id} className={'medal ' + (m.got ? 'got' : '')} title={m.desc}><span>{m.icon}</span><b>{m.name}</b><small>{m.desc}</small></div>
        ))}</div>
      </Section>

      {pickAvatar && (
        <Modal title="Escolha seu personagem" onClose={() => setPickAvatar(false)}>
          <div className="avatar-grid">{AVATARS.map((a) => <button key={a} onClick={async () => { await act(() => rpc('set_my_avatar', { p_avatar: a }), 'Personagem trocado!'); setPickAvatar(false) }}>{a}</button>)}</div>
        </Modal>
      )}
      {ask && <AskModal {...ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function TaskCard({ a, today, busy, canMark, onMark, isParent, setAsk, act }) {
  const st = statusOf(a, today)
  const markable = a.status === 'pending' && canMark
  const [open, setOpen] = useState(false)
  const [tt, setTt] = useState(null)
  useEffect(() => { if (open && !tt) sel(supabase.from('task_types').select('guidance').eq('id', a.task_type_id).single()).then(setTt).catch(() => {}) }, [open])
  return (
    <div className={'task ' + st.cls + (a.optional ? ' optional' : '')}>
      <button className={'check ' + (a.status !== 'pending' ? 'done' : '')} disabled={!markable || busy === a.id} onClick={() => onMark(a)} aria-label={'Marcar ' + a.task_name}>
        {a.status === 'pending' ? '' : a.status === 'awaiting' ? '🕓' : st.icon}
      </button>
      <div className="task-body" onClick={() => setOpen(!open)}>
        <div className="task-title"><span className="task-icon">{a.icon}</span><b>{a.task_name}</b></div>
        <div className="task-meta">
          {a.date !== today && <span>{shortDate(a.date)} · </span>}
          <span>até {fmtTime(a.due_at)}</span>
          {!a.optional ? <span> · {a.points_max} pts</span> : <span> · opcional, sem pontos</span>}
        </div>
        <div className="task-status"><span className={'badge ' + st.cls}>{st.label}</span>
          {a.completed_at && <span className="muted small"> marcada às {fmtTime(a.completed_at)}</span>}
          {a.status === 'approved' && <span className="pts">+{a.points_awarded}</span>}
        </div>
        {a.note && <div className="muted small">📝 {a.note}</div>}
        {open && tt?.guidance && <div className="guidance">💡 {tt.guidance}</div>}
        {open && isParent && <ParentActions a={a} setAsk={setAsk} act={act} />}
      </div>
    </div>
  )
}

export function ParentActions({ a, setAsk, act, compact }) {
  return (
    <div className={'actions' + (compact ? ' compact' : '')} onClick={(e) => e.stopPropagation()}>
      {a.status === 'awaiting' && <>
        <button className="btn ok small" onClick={() => act(() => rpc('review_task', { p_id: a.id, p_approve: true, p_reason: null }), 'Aprovada ✅')}>Aprovar</button>
        <button className="btn danger small" onClick={() => setAsk({ title: 'Recusar tarefa', label: 'Motivo (a criança verá com carinho)', placeholder: 'Ex.: a louça ficou com sabão, vamos refazer juntas?', okText: 'Recusar', danger: true, onOk: (t) => act(() => rpc('review_task', { p_id: a.id, p_approve: false, p_reason: t }), 'Recusada') })}>Recusar</button>
      </>}
      {['pending', 'missed', 'rejected', 'awaiting'].includes(a.status) &&
        <button className="btn ghost small" onClick={() => setAsk({ title: 'Dispensar tarefa', label: 'Justificativa', placeholder: 'Ex.: doença, imprevisto, mudança de rotina…', okText: 'Dispensar', onOk: (t) => act(() => rpc('excuse_task', { p_id: a.id, p_reason: t }), 'Dispensada — não conta na meta') })}>Dispensar</button>}
      {['pending', 'missed'].includes(a.status) &&
        <button className="btn ghost small" onClick={() => setAsk({ title: 'Remarcar tarefa', label: 'Justificativa', okText: 'Remarcar', extra: <label className="field"><span>Nova data</span><input type="date" id="nova-data" defaultValue={addDays(a.date, 1)} /></label>, onOk: (t) => act(() => rpc('reschedule_task', { p_id: a.id, p_new_date: document.getElementById('nova-data').value, p_reason: t }), 'Remarcada') })}>Remarcar</button>}
      {a.status === 'pending' &&
        <button className="btn ghost small" onClick={() => act(() => rpc('mark_missed', { p_id: a.id, p_reason: 'Não realizada' }), 'Registrada como não realizada')}>Não realizada</button>}
      {['approved', 'rejected', 'excused', 'missed'].includes(a.status) &&
        <button className="btn ghost small" onClick={() => setAsk({ title: 'Desfazer revisão', label: 'Justificativa', placeholder: 'Ex.: aprovei por engano', okText: 'Desfazer', onOk: (t) => act(() => rpc('reopen_task', { p_id: a.id, p_reason: t }), 'Revisão desfeita') })}>Desfazer</button>}
    </div>
  )
}

function computeMedals({ monthTasks, k, sum, closures, sent, memberId }) {
  const ok = monthTasks.filter((t) => t.status === 'approved')
  const reading = ok.filter((t) => t.task_type_id === 'leitura').length
  const onTime = ok.filter((t) => t.on_time).length
  const byWeek = {}
  monthTasks.forEach((t) => {
    if (t.optional || t.status === 'excused') return
    const d = new Date(t.date + 'T12:00:00Z'); const w = new Date(d); w.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const key = w.toISOString().slice(0, 10)
    byWeek[key] = byWeek[key] || { all: 0, ok: 0, past: true }
    byWeek[key].all++; if (t.status === 'approved') byWeek[key].ok++
  })
  const thisWeek = monthStart(sum.today) && (() => { const d = new Date(sum.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
  const orgWeek = Object.entries(byWeek).some(([w, v]) => w !== thisWeek && v.all > 0 && v.ok === v.all)
  const goalMonths = closures.filter((c) => (c.summary?.children || []).some((x) => x.id === memberId && x.goal_met)).length
  const teamMonths = closures.filter((c) => c.summary?.group_goal_met).length
  const groupNow = pct(sum.group.earned, sum.group.possible) >= sum.group_goal && sum.group.possible > 0
  return [
    { id: 'first', icon: '🌟', name: 'Primeira missão', desc: 'Ter uma missão aprovada no mês', got: ok.length >= 1 },
    { id: 'read', icon: '📖', name: 'Leitora', desc: '5 leituras aprovadas no mês', got: reading >= 5 },
    { id: 'time', icon: '⏰', name: 'Pontualidade', desc: '10 missões no horário no mês', got: onTime >= 10 },
    { id: 'week', icon: '🧹', name: 'Semana organizada', desc: 'Todas as missões de uma semana aprovadas', got: orgWeek },
    { id: 'heart', icon: '💌', name: 'Coração grato', desc: 'Enviar 3 mensagens no mural', got: sent >= 3 },
    { id: 'goal', icon: '🎯', name: 'Meta do mês', desc: 'Alcançar a meta individual de um mês', got: goalMonths > 0 },
    { id: 'team', icon: '🤝', name: 'Família unida', desc: 'Grupo acima da meta coletiva', got: groupNow || teamMonths > 0 },
  ]
}
