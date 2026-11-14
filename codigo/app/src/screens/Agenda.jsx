import { useEffect, useMemo, useState } from 'react'
import { useApp, Section, Loading, Tabs, Avatar } from '../components'
import { sel, supabase, todaySP, addDays, weekStart, monthStart, monthEnd, addMonths, dow, prettyDate, monthName, WD_SHORT, statusOf, fmtTime, shortDate, timeStr } from '../lib'

export default function Agenda() {
  const { kids, version, me, isParent, settings } = useApp()
  const today = todaySP()
  const [view, setView] = useState('dia')
  const [date, setDate] = useState(today)
  const [rot, setRot] = useState(null)
  const [types, setTypes] = useState({})
  const [asg, setAsg] = useState([])
  const [ovs, setOvs] = useState([])

  const range = useMemo(() => {
    if (view === 'dia') return [date, date]
    if (view === 'semana') { const s = weekStart(date); return [s, addDays(s, 6)] }
    const s = monthStart(date); return [weekStart(s), addDays(weekStart(monthEnd(date)), 6)]
  }, [view, date])

  useEffect(() => {
    Promise.all([
      sel(supabase.from('rotation').select('*').eq('active', true)),
      sel(supabase.from('task_types').select('*')),
      sel(supabase.from('schedule_overrides').select('*').eq('active', true)),
    ]).then(([r, t, o]) => { setRot(r); setTypes(Object.fromEntries(t.map((x) => [x.id, x]))); setOvs(o) }).catch(() => {})
  }, [version])
  useEffect(() => {
    sel(supabase.from('assignments').select('*').gte('date', range[0]).lte('date', range[1]).order('due_at')).then(setAsg).catch(() => {})
  }, [range[0], range[1], version])

  if (!rot) return <Loading />

  // tarefas de um dia: reais (passado/hoje) ou projetadas pelo rodízio (futuro)
  const dayTasks = (d) => {
    if (d <= today) return asg.filter((a) => a.date === d)
    const start = settings?.start_date || today
    if (d < start) return []
    const planned = asg.filter((a) => a.date === d)
    return planned.concat(rot.filter((r) => r.weekday === dow(d) && types[r.task_type_id]?.active).map((r) => {
      const t = types[r.task_type_id]
      const hit = (o) => d >= o.date_from && d <= o.date_to && (!o.member_id || o.member_id === r.member_id) && (o.scope === 'todas' || o.scope === t.category || o.scope === t.id)
      const away = ovs.find((o) => o.kind === 'ausencia' && hit(o))
      const hr = [...ovs].reverse().find((o) => o.kind === 'horario' && hit(o))
      return { id: r.id + d, date: d, member_id: r.member_id, task_type_id: r.task_type_id, task_name: t.name, icon: t.icon, points_max: t.points, optional: t.optional, status: away ? 'away' : 'future', note: away ? 'Ausência: ' + away.reason : null, due: hr ? hr.new_due : r.due_time || t.default_due }
    }))
  }
  const visibleKids = isParent ? kids : kids
  const move = (n) => setDate(view === 'dia' ? addDays(date, n) : view === 'semana' ? addDays(date, 7 * n) : addMonths(date, n))
  const title = view === 'dia' ? prettyDate(date) : view === 'semana' ? `Semana de ${shortDate(range[0])} a ${shortDate(range[1])}` : monthName(date)

  return (
    <div className="stack">
      <h1>Agenda</h1>
      <Tabs value={view} onChange={setView} options={[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']]} />
      <div className="nav-row">
        <button className="icon-btn" onClick={() => move(-1)} aria-label="Anterior">◀</button>
        <div className="grow center"><b>{title}</b>{date !== today && <button className="link small" onClick={() => setDate(today)}>hoje</button>}</div>
        <button className="icon-btn" onClick={() => move(1)} aria-label="Próximo">▶</button>
      </div>
      <input className="date-pick" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Escolher data" />

      {view === 'dia' && (
        <>
          {visibleKids.map((k) => {
            const list = dayTasks(date).filter((t) => t.member_id === k.id)
            const hidden = !isParent && k.id !== me.id && date <= today
            return (
              <Section key={k.id} title={<span className="row"><Avatar member={k} size={30} /> {k.name}</span>}>
                {hidden ? <p className="muted small">As tarefas das irmãs aparecem para elas mesmas. 💜</p> :
                  list.length === 0 ? <p className="muted small">Sem missões neste dia.</p> :
                    <ul className="day-list">{list.map((t) => {
                      const st = t.status === 'pending' && t.date > today ? { label: 'Agendada (extra)', cls: 'st-future' } : t.status === 'future' ? { label: 'Agendada', cls: 'st-future' } : t.status === 'away' ? { label: 'Ausente (dispensada)', cls: 'st-excused' } : statusOf(t, today)
                      return <li key={t.id}><span>{t.icon} {t.task_name}{t.optional ? ' (opcional)' : ''}</span><span className="muted small">até {t.due_at ? fmtTime(t.due_at) : timeStr(t.due)}</span><span className={'badge ' + st.cls}>{st.label}</span></li>
                    })}</ul>}
              </Section>
            )
          })}
          {ovs.filter((o) => date >= o.date_from && date <= o.date_to).map((o) => <div key={o.id} className="banner culto">{o.kind === 'ausencia' ? '🏠' : '🕐'} {o.member_id ? kids.find((k) => k.id === o.member_id)?.name : 'Todas'}: {o.kind === 'ausencia' ? 'ausente' : 'prazo especial ' + timeStr(o.new_due)} — {o.reason}</div>)}
          {settings && dow(date) === settings.family_day_weekday && <div className="banner family">🎉 Dia da Família às {timeStr(settings.family_day_time)}</div>}
          {settings && dow(date) === settings.culto_weekday && <div className="banner culto">⛪ Culto às {timeStr(settings.culto_time)}</div>}
        </>
      )}

      {view === 'semana' && (
        <div className="week">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(range[0], i); const list = dayTasks(d)
            return (
              <button key={d} className={'week-day' + (d === today ? ' today' : '')} onClick={() => { setDate(d); setView('dia') }}>
                <b>{WD_SHORT[dow(d)]} {shortDate(d)}</b>
                {visibleKids.map((k) => {
                  const mine = list.filter((t) => t.member_id === k.id && !t.optional && t.status !== 'away' && t.status !== 'excused')
                  if (!mine.length) return null
                  const hidden = !isParent && k.id !== me.id && d <= today
                  return <div key={k.id} className="wk-kid"><span className="dot" style={{ background: k.color }} />{k.name}: {hidden ? '…' : (mine.filter((t) => types[t.task_type_id]?.category === 'casa' && t.task_type_id !== 'organizar').map((t) => t.icon).join(' ') || '📚')}</div>
                })}
              </button>
            )
          })}
        </div>
      )}

      {view === 'mes' && (
        <div className="month">
          {WD_SHORT.slice(1).concat(WD_SHORT[0]).map((w) => <div key={w} className="month-h">{w}</div>)}
          {Array.from({ length: Math.round((new Date(range[1]) - new Date(range[0])) / 864e5) + 1 }).map((_, i) => {
            const d = addDays(range[0], i); const list = dayTasks(d).filter((t) => !t.optional)
            const inMonth = d.slice(0, 7) === date.slice(0, 7)
            const done = list.filter((t) => t.status === 'approved').length
            const wait = list.filter((t) => t.status === 'awaiting').length
            return (
              <button key={d} className={'month-d' + (inMonth ? '' : ' out') + (d === today ? ' today' : '')} onClick={() => { setDate(d); setView('dia') }}>
                <b>{Number(d.slice(8))}</b>
                {list.length > 0 && <small>{d <= today ? `${done}/${list.length}` : list.length}</small>}
                {wait > 0 && <i className="wait-dot" />}
              </button>
            )
          })}
        </div>
      )}
      {view === 'mes' && <p className="muted small">Em dias passados: missões aprovadas / total. Em dias futuros: quantidade de missões agendadas pelo rodízio.</p>}
    </div>
  )
}
