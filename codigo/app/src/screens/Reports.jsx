import { useEffect, useState } from 'react'
import { useApp, Section, Loading, Tabs, AskModal, Modal, Avatar, Progress } from '../components'
import { rpc, sel, supabase, todaySP, monthStart, addMonths, monthName, monthEnd, shortDate, fmtTime, fmtDateTime, statusOf } from '../lib'
import { describeAudit, PenaltyModal } from './Panel'
import { ParentActions } from './Missions'

export default function Reports() {
  const { members, kids, version, toast, refresh, go, settings } = useApp()
  const [tab, setTab] = useState('mes')
  const [month, setMonth] = useState(monthStart(todaySP()))
  const [rep, setRep] = useState(null)
  const [closure, setClosure] = useState(null)
  const [detail, setDetail] = useState(null)
  const [log, setLog] = useState(null)
  const [ask, setAsk] = useState(null)
  const [adj, setAdj] = useState(false)
  const [pen, setPen] = useState(false)

  useEffect(() => {
    setRep(null)
    Promise.all([rpc('month_report', { p_month: month }), sel(supabase.from('month_closures').select('*').eq('month', month))])
      .then(([r, c]) => { setRep(r); setClosure(c[0] || null) }).catch((e) => toast(e.message, 'err'))
  }, [month, version])
  useEffect(() => { if (tab === 'historico') sel(supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200)).then(setLog).catch(() => {}) }, [tab, version])

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); refresh() } catch (e) { toast(e.message, 'err') } }
  const ended = monthEnd(month) < todaySP()

  return (
    <div className="stack">
      <button className="link" onClick={() => go('mais')}>← voltar</button>
      <h1>Relatórios</h1>
      <Tabs value={tab} onChange={setTab} options={[['mes', '📊 Mês'], ['historico', '🕓 Histórico de alterações']]} />
      {tab === 'mes' && <>
        <div className="nav-row">
          <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))}>◀</button>
          <b className="grow center">{monthName(month)}</b>
          <button className="icon-btn" disabled={month >= monthStart(todaySP())} onClick={() => setMonth(addMonths(month, 1))}>▶</button>
        </div>
        {!rep ? <Loading /> : <>
          <Section title={closure ? '🔒 Mês fechado' : ended ? '⚠️ Mês terminado — falta fechar' : '📈 Mês em andamento'}>
            <Progress value={rep.group_pct || 0} goal={rep.group_goal} color="linear-gradient(90deg,#f472b6,#a78bfa)" label={`Grupo: ${rep.group_earned} de ${rep.group_possible} pts`} />
            <p>{rep.unlocked ? '🎉 Metas atingidas — prêmio coletivo desbloqueado!' : `Meta individual ${rep.individual_goal}% · meta do grupo ${rep.group_goal}%`}</p>
            {closure && <p className="muted small">Fechado em {fmtDateTime(closure.closed_at)} por {members.find((m) => m.id === closure.closed_by)?.name}. Os números ficaram congelados.</p>}
            {!closure && ended && <button className="btn primary" onClick={() => setAsk({ title: 'Fechar o mês', label: 'Digite FECHAR para confirmar', placeholder: 'FECHAR', okText: 'Fechar mês', minLen: 6, extra: <p className="muted small">Tarefas pendentes viram “não realizadas”, os números ficam congelados e o prêmio é desbloqueado se as metas foram atingidas. Correções depois disso exigem justificativa.</p>, onOk: async (t) => { if (t.toUpperCase() !== 'FECHAR') throw new Error('Digite FECHAR'); await act(() => rpc('close_month', { p_month: month }), 'Mês fechado 🔒') } })}>🔒 Fechar o mês</button>}
            {closure?.revisions?.length > 0 && <details><summary>Correções após o fechamento ({closure.revisions.length})</summary><ul className="feed">{closure.revisions.map((r, i) => <li key={i}><span>{r.child} · {r.task} ({shortDate(r.date)})</span><small>{fmtDateTime(r.at)} · {r.by} · “{r.reason}”</small></li>)}</ul></details>}
          </Section>
          <div className="report-cards">{rep.children.map((c) => (
            <Section key={c.id} className="report">
              <div className="row"><Avatar member={members.find((m) => m.id === c.id)} size={40} /><div className="grow"><b>{c.name}</b><div className={c.goal_met ? 'ok small' : 'muted small'}>{c.pct ?? 0}% {c.goal_met ? '· meta atingida 🏅' : `· meta ${rep.individual_goal}%`}</div></div></div>
              <Progress small value={c.pct || 0} goal={rep.individual_goal} color={c.color} />
              <table className="mini"><tbody>
                <tr><td>Pontos</td><td><b>{c.earned}</b> de {c.possible}</td></tr>
                <tr><td>✅ No horário</td><td>{c.count_on_time}</td></tr>
                <tr><td>⏰ Com atraso</td><td>{c.count_late}</td></tr>
                <tr><td>➖ Não realizadas</td><td>{c.count_missed}</td></tr>
                <tr><td>↩️ Recusadas</td><td>{c.count_rejected}</td></tr>
                <tr><td>🕊️ Dispensadas</td><td>{c.count_excused} ({c.excused_points} pts fora da meta)</td></tr>
                <tr><td>🕓 Aguardando</td><td>{c.count_awaiting}</td></tr>
                <tr><td>⚠️ Descontos</td><td>{c.penalties} ({c.count_penalties}x)</td></tr>
                <tr><td>🌟 Bônus/ajustes +</td><td>{c.bonus}</td></tr>
              </tbody></table>
              <button className="btn small ghost" onClick={() => setDetail(c)}>Ver tarefas do mês</button>
            </Section>
          ))}</div>
          <button className="btn ghost" onClick={() => setAdj(true)}>± Corrigir pontuação com justificativa</button>
          <button className="btn ghost" onClick={() => setPen(true)}>⚠️ Registrar desconto ou bônus</button>
        </>}
      </>}
      {tab === 'historico' && (!log ? <Loading /> : (
        <Section title="Todas as alterações e aprovações">
          <ul className="feed">{log.map((e) => <li key={e.id}><span>{describeAudit(e, members)}</span><small>{fmtDateTime(e.at)}{e.actor_name ? ' · ' + e.actor_name : ''}{e.reason ? ' · “' + e.reason + '”' : ''}</small></li>)}</ul>
        </Section>
      ))}
      {detail && <MonthTasks child={detail} month={month} closed={!!closure} onClose={() => setDetail(null)} setAsk={setAsk} act={act} />}
      {pen && <PenaltyModal kids={kids} settings={settings} act={act} onClose={() => setPen(false)} />}
      {adj && <AdjustModal kids={kids} onClose={() => setAdj(false)} act={act} />}
      {ask && <AskModal {...ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function MonthTasks({ child, month, closed, onClose, setAsk, act }) {
  const { version } = useApp()
  const [list, setList] = useState(null)
  useEffect(() => { sel(supabase.from('assignments').select('*').eq('member_id', child.id).gte('date', month).lte('date', monthEnd(month)).order('date').order('due_at')).then(setList) }, [version])
  const today = todaySP()
  return (
    <Modal title={`Tarefas de ${child.name}`} onClose={onClose}>
      {!list ? <Loading /> : <ul className="day-list tall">{list.map((a) => {
        const st = statusOf(a, today)
        return <li key={a.id} className="col">
          <div className="row"><b>{shortDate(a.date)}</b><span className="grow">{a.icon} {a.task_name}</span><span className={'badge ' + st.cls}>{st.label}</span></div>
          <small className="muted">{a.completed_at ? `marcada às ${fmtTime(a.completed_at)} · ` : ''}prazo {fmtTime(a.due_at)} · {a.points_awarded}/{a.points_max} pts{a.note ? ' · ' + a.note : ''}</small>
          {closed ? <button className="btn ghost small" onClick={() => setAsk({ title: 'Corrigir após fechamento', label: 'Justificativa (fica no histórico)', minLen: 5, okText: 'Corrigir',
            extra: <div className="row"><label className="field"><span>Situação</span><select id="c-st" defaultValue={a.status === 'pending' ? 'missed' : a.status}><option value="approved">Aprovada</option><option value="excused">Dispensada</option><option value="missed">Não realizada</option><option value="rejected">Recusada</option></select></label><label className="field"><span>Pontos</span><input id="c-pt" type="number" min="0" max={a.points_max} defaultValue={a.points_awarded} /></label></div>,
            onOk: (t) => act(() => rpc('correct_closed_task', { p_id: a.id, p_status: document.getElementById('c-st').value, p_points: Number(document.getElementById('c-pt').value || 0), p_reason: t }), 'Correção registrada') })}>Corrigir</button>
            : <ParentActions a={a} setAsk={setAsk} act={act} compact />}
        </li>
      })}</ul>}
    </Modal>
  )
}

function AdjustModal({ kids, onClose, act }) {
  const [who, setWho] = useState(kids[0]?.id); const [delta, setDelta] = useState(''); const [reason, setReason] = useState('')
  return (
    <Modal title="Corrigir pontuação" onClose={onClose}>
      <label className="field"><span>Para quem</span><select value={who} onChange={(e) => setWho(e.target.value)}>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
      <label className="field"><span>Pontos (use – para tirar)</span><input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="Ex.: 5 ou -5" /></label>
      <label className="field"><span>Justificativa</span><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="row end"><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!delta || Number(delta) === 0 || reason.trim().length < 3} onClick={async () => { await act(() => rpc('adjust_points', { p_member: who, p_delta: Number(delta), p_reason: reason, p_date: null }), 'Ajuste registrado'); onClose() }}>Salvar ajuste</button></div>
    </Modal>
  )
}
