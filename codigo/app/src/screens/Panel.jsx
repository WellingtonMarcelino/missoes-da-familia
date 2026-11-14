import { useEffect, useState } from 'react'
import { useApp, Avatar, Section, Loading, Empty, AskModal, Modal } from '../components'
import { rpc, sel, supabase, fmtTime, fmtDateTime, shortDate, todaySP, addDays } from '../lib'
import { ParentActions } from './Missions'

export function describeAudit(e, members) {
  const name = (id) => members.find((m) => m.id === id)?.name || ''
  const a = e.after || {}, b = e.before || {}
  if (e.table_name === 'assignments') {
    const who = name(a.member_id || b.member_id), task = a.task_name || b.task_name
    if (e.action === 'DELETE') return `🗑️ ${task} de ${who} removida do dia`
    if (a.status !== b.status) {
      const map = { awaiting: `🕓 ${who} marcou “${task}” às ${fmtTime(a.completed_at)}${a.on_time ? ' (no horário)' : ' (com atraso)'}`,
        approved: `✅ “${task}” de ${who} aprovada: +${a.points_awarded} pts`, rejected: `↩️ “${task}” de ${who} recusada`,
        excused: `🕊️ “${task}” de ${who} dispensada`, missed: `➖ “${task}” de ${who} não realizada`,
        pending: `↺ “${task}” de ${who} voltou para pendente` }
      return map[a.status] || `${task}: ${a.status}`
    }
    if (a.points_awarded !== b.points_awarded) return `✏️ Pontos de “${task}” (${who}): ${b.points_awarded} → ${a.points_awarded}`
    return `✏️ “${task}” de ${who} alterada`
  }
  if (e.table_name === 'point_adjustments') { const c = { briga: '⚠️ Desconto (briga)', escola: '🏫 Desconto (escola)', comportamento: '⚠️ Desconto (comportamento)', bonus: '🌟 Bônus' }[a.category] || '± Ajuste'; return `${c}: ${a.delta > 0 ? '+' : ''}${a.delta} pts para ${name(a.member_id)}` }
  if (e.table_name === 'month_closures') return e.action === 'INSERT' ? `🔒 Mês ${a.month?.slice(5, 7)}/${a.month?.slice(0, 4)} fechado` : '🔒 Fechamento revisado'
  if (e.table_name === 'rotation') return '🔁 Rodízio alterado'
  if (e.table_name === 'task_types') return `⚙️ Tarefa “${a.name || b.name}” alterada`
  if (e.table_name === 'settings') return '⚙️ Configurações alteradas'
  if (e.table_name === 'members') return `👤 Membro ${a.name || b.name} ${e.action === 'INSERT' ? 'cadastrado' : e.action === 'DELETE' ? 'removido' : 'atualizado'}`
  if (e.table_name === 'monthly_rewards') return `🎁 Prêmio do mês: ${a.status}`
  if (e.table_name === 'schedule_blocks') return '🕐 Horários alterados'
  return `${e.table_name} ${e.action}`
}

export default function Panel() {
  const { members, kids, version, toast, refresh, go, settings } = useApp()
  const [queue, setQueue] = useState(null)
  const [overdue, setOverdue] = useState([])
  const [feed, setFeed] = useState([])
  const [ask, setAsk] = useState(null)
  const [penalty, setPenalty] = useState(false)
  const [extra, setExtra] = useState(false)

  useEffect(() => {
    const today = todaySP()
    Promise.all([
      sel(supabase.from('assignments').select('*').eq('status', 'awaiting').order('completed_at')),
      sel(supabase.from('assignments').select('*').eq('status', 'pending').eq('optional', false).lte('date', today).lt('due_at', new Date().toISOString()).order('due_at', { ascending: false }).limit(60)),
      sel(supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(30)),
    ]).then(([q, o, f]) => { setQueue(q); setOverdue(o); setFeed(f) }).catch((e) => toast(e.message, 'err'))
  }, [version])

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); refresh() } catch (e) { toast(e.message, 'err') } }
  const kid = (id) => members.find((m) => m.id === id)
  if (!queue) return <Loading />

  return (
    <div className="stack">
      <h1>Painel dos responsáveis</h1>
      <div className="kid-chips">{kids.map((k) => <button key={k.id} className="chip" style={{ borderColor: k.color }} onClick={() => go('menina/' + k.id)}><Avatar member={k} size={28} />{k.name}</button>)}</div>

      <div className="row wrap"><button className="btn ghost grow" onClick={() => setExtra(true)}>➕ Tarefa extra</button><button className="btn ghost grow" onClick={() => setPenalty(true)}>⚠️ Desconto ou bônus</button></div>

      <Section title={`✅ Fila de aprovação (${queue.length})`} right={queue.length > 1 && <button className="btn ok small" onClick={() => act(async () => { for (const a of queue) await rpc('review_task', { p_id: a.id, p_approve: true, p_reason: null }) }, 'Todas aprovadas ✅')}>Aprovar todas</button>}>
        {queue.length === 0 ? <Empty icon="🎉">Nada aguardando aprovação.</Empty> : queue.map((a) => (
          <div key={a.id} className="queue-item" style={{ '--kc': kid(a.member_id)?.color }}>
            <Avatar member={kid(a.member_id)} size={44} />
            <div className="grow">
              <b>{a.icon} {a.task_name}</b>
              <div className="muted small">{kid(a.member_id)?.name} · {a.date !== todaySP() ? shortDate(a.date) + ' · ' : ''}marcou às <b>{fmtTime(a.completed_at)}</b> (prazo {fmtTime(a.due_at)})</div>
              <span className={'badge ' + (a.on_time ? 'st-ok' : 'st-late')}>{a.on_time ? `No horário · ${a.points_max} pts` : `Com atraso · ${Math.round(a.points_max * (settings?.late_factor ?? 0.6))} pts`}</span>
              <ParentActions a={a} setAsk={setAsk} act={act} compact />
            </div>
          </div>
        ))}
      </Section>

      <Section title={`⏰ Atrasadas ou pendentes (${overdue.length})`}>
        {overdue.length === 0 ? <Empty icon="👍">Nenhuma tarefa atrasada.</Empty> : overdue.map((a) => (
          <details key={a.id} className="overdue">
            <summary><span className="dot" style={{ background: kid(a.member_id)?.color }} /> <b>{kid(a.member_id)?.name}</b> · {a.icon} {a.task_name} <span className="muted small">{shortDate(a.date)} até {fmtTime(a.due_at)}</span></summary>
            <div className="actions"><button className="btn ghost small" onClick={() => act(() => rpc('complete_task', { p_id: a.id }), 'Marcada pela criança (horário real registrado)')}>Marcar por ela</button></div>
            <ParentActions a={a} setAsk={setAsk} act={act} compact />
          </details>
        ))}
      </Section>

      <Section title="🟢 Novidades em tempo real">
        {feed.length === 0 ? <Empty>Sem novidades ainda.</Empty> : (
          <ul className="feed">{feed.map((e) => <li key={e.id}><span>{describeAudit(e, members)}</span><small>{fmtDateTime(e.at)}{e.actor_name ? ' · ' + e.actor_name : ''}{e.reason ? ' · “' + e.reason + '”' : ''}</small></li>)}</ul>
        )}
        <button className="link" onClick={() => go('relatorios')}>Ver histórico completo e relatórios →</button>
      </Section>
      {extra && <ExtraTaskModal kids={kids} act={act} onClose={() => setExtra(false)} />}
      {penalty && <PenaltyModal kids={kids} settings={settings} act={act} onClose={() => setPenalty(false)} />}
      {ask && <AskModal {...ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

const KINDS = [
  ['briga', '⚠️ Briga entre irmãs', 'penalty_fight'],
  ['escola', '🏫 Mau comportamento na escola', 'penalty_school'],
  ['comportamento', '🙊 Outro comportamento', 'penalty_fight'],
  ['bonus', '🌟 Bônus especial', null],
]
export function PenaltyModal({ kids, settings, act, onClose }) {
  const [who, setWho] = useState([])
  const [kind, setKind] = useState('briga')
  const [pts, setPts] = useState(settings?.penalty_fight ?? 5)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = (k) => { setKind(k[0]); setPts(k[2] ? settings?.[k[2]] ?? 5 : 5) }
  const toggle = (id) => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id])
  const save = async () => {
    setBusy(true)
    const delta = kind === 'bonus' ? Math.abs(Number(pts)) : -Math.abs(Number(pts))
    await act(async () => { for (const id of who) await rpc('adjust_points', { p_member: id, p_delta: delta, p_reason: reason.trim(), p_date: null, p_category: kind }) },
      kind === 'bonus' ? 'Bônus registrado 🌟' : 'Desconto registrado')
    setBusy(false); onClose()
  }
  return (
    <Modal title="Desconto ou bônus de pontos" onClose={onClose}>
      <p className="muted small">O desconto abate dos pontos ganhos no mês. Só a própria menina e os responsáveis veem o motivo — as irmãs não.</p>
      <div className="options">{KINDS.map((k) => <button key={k[0]} className={'option' + (kind === k[0] ? ' mine' : '')} onClick={() => pick(k)}><b>{k[1]}</b></button>)}</div>
      <p className="field"><span><b>Quem</b> (em briga, marque as envolvidas)</span></p>
      <div className="to-row">{kids.map((k) => <button key={k.id} className={'to-pick' + (who.includes(k.id) ? ' on' : '')} onClick={() => toggle(k.id)}><Avatar member={k} size={40} /><small>{k.name}</small></button>)}</div>
      <label className="field"><span>Pontos {kind === 'bonus' ? 'a somar' : 'a descontar'}</span><input type="number" min="1" max="50" value={pts} onChange={(e) => setPts(e.target.value)} /></label>
      <label className="field"><span>O que aconteceu (ela verá esta mensagem)</span><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'escola' ? 'Ex.: bilhete da professora sobre conversa na aula' : 'Ex.: discussão na hora da louça. Vamos conversar sobre isso.'} /></label>
      <button className={'btn full ' + (kind === 'bonus' ? 'ok' : 'danger')} disabled={busy || !who.length || !Number(pts) || reason.trim().length < 3} onClick={save}>{busy ? 'Salvando…' : kind === 'bonus' ? 'Dar bônus' : 'Registrar desconto'}</button>
    </Modal>
  )
}

const EXTRA_ICONS = ['⭐', '🌿', '🧽', '🛒', '🐶', '🧺', '🪴', '🎉', '📦', '🚗', '🍽️', '🧹']
export function ExtraTaskModal({ kids, act, onClose }) {
  const today = todaySP()
  const [who, setWho] = useState([])
  const [date, setDate] = useState(today)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⭐')
  const [pts, setPts] = useState(5)
  const [optional, setOptional] = useState(false)
  const [due, setDue] = useState('18:00')
  const [guide, setGuide] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id) => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id])
  const save = async () => {
    setBusy(true)
    await act(() => rpc('add_extra_task', { p_members: who, p_date: date, p_name: name.trim(), p_icon: icon, p_points: optional ? 0 : Number(pts), p_due: due, p_guidance: guide || null, p_optional: optional }), 'Tarefa extra criada ⭐')
    setBusy(false); onClose()
  }
  return (
    <Modal title="Tarefa extra (só neste dia)" onClose={onClose}>
      <p className="muted small">Para algo que não está na rotina. Ela aparece na lista de missões do dia escolhido, com pontos e aprovação como as outras.</p>
      <label className="field"><span>O que fazer</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: arrumar o quintal, ajudar a guardar as compras" /></label>
      <div className="emoji-row">{EXTRA_ICONS.map((e) => <button key={e} className={icon === e ? 'on' : ''} onClick={() => setIcon(e)}>{e}</button>)}</div>
      <p className="field"><span><b>Para quem</b></span></p>
      <div className="to-row">{kids.map((k) => <button key={k.id} className={'to-pick' + (who.includes(k.id) ? ' on' : '')} onClick={() => toggle(k.id)}><Avatar member={k} size={40} /><small>{k.name}</small></button>)}</div>
      <div className="chips"><button className="chip" onClick={() => setDate(today)}>Hoje</button><button className="chip" onClick={() => setDate(addDays(today, 1))}>Amanhã</button></div>
      <div className="row wrap">
        <label className="field sm"><span>Dia</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field sm"><span>Prazo</span><input type="time" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className="field sm"><span>Pontos</span><input type="number" min="0" max="50" value={optional ? 0 : pts} disabled={optional} onChange={(e) => setPts(e.target.value)} /></label>
      </div>
      <label className="switch"><input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> Opcional, sem pontos (não conta na meta)</label>
      <label className="field"><span>Orientação (opcional)</span><input value={guide} onChange={(e) => setGuide(e.target.value)} placeholder="Ex.: usar luvas, chamar um adulto para…" /></label>
      <button className="btn primary full" disabled={busy || name.trim().length < 2 || !who.length || !date || !due} onClick={save}>{busy ? 'Salvando…' : 'Criar tarefa extra'}</button>
    </Modal>
  )
}
