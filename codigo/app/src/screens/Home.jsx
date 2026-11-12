import { useEffect, useState } from 'react'
import { useApp, Avatar, Progress, Section, Loading } from '../components'
import { rpc, sel, supabase, prettyDate, pct, MOTIVATION, hourSP, dow, timeStr, parseD } from '../lib'

export default function Home() {
  const { me, version, isParent, go, settings, live } = useApp()
  const [s, setS] = useState(null)
  const [dream, setDream] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    rpc('family_summary').then(setS).catch((e) => setErr(e.message))
  }, [version])
  useEffect(() => {
    if (!s) return
    const month = s.month_start
    Promise.all([
      sel(supabase.from('monthly_rewards').select('*').eq('month', month)),
      sel(supabase.from('reward_votes').select('option_id').eq('month', month)),
      sel(supabase.from('reward_options').select('*').eq('active', true)),
    ]).then(([mr, votes, opts]) => {
      const count = {}; votes.forEach((v) => (count[v.option_id] = (count[v.option_id] || 0) + 1))
      const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
      setDream({ status: mr[0]?.status || 'locked', option: (mr[0]?.chosen_option && opts.find((o) => o.id === mr[0].chosen_option)) || (top && opts.find((o) => o.id === top[0])) || null, votes: votes.length })
    }).catch(() => {})
  }, [s?.month_start, version])

  if (err) return <p className="error">{err}</p>
  if (!s) return <Loading />

  const h = parseInt(hourSP())
  const hello = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  const wd = dow(s.today)
  const groupPct = pct(s.group.earned, s.group.possible)
  const needGroup = Math.max(0, Math.ceil((s.group_goal / 100) * s.group.projected_possible - s.group.earned))
  const msg = MOTIVATION[parseD(s.today).getUTCDate() % MOTIVATION.length]

  return (
    <div className="stack">
      <div className="hello">
        <h1>{hello}, {me.name}! {isParent ? '👋' : me.avatar}</h1>
        <p>{prettyDate(s.today)}</p>
      </div>

      {settings && wd === settings.family_day_weekday && <div className="banner family">🎉 Hoje é <b>Dia da Família</b> às {timeStr(settings.family_day_time)}! <button className="link" onClick={() => go('familia')}>Ver programação</button></div>}
      {settings && wd === settings.culto_weekday && <div className="banner culto">⛪ Hoje tem culto às {timeStr(settings.culto_time)}. Vamos adiantar jantar, banho e roupas? 💜</div>}

      <div className="kid-cards">
        {s.children.map((k) => {
          const t = k.today, mp = pct(k.month.earned, k.month.possible)
          const done = t.count_approved + t.count_awaiting
          return (
            <button key={k.id} className="kid-card" style={{ '--kc': k.color }} onClick={() => (isParent ? go('menina/' + k.id) : k.id === me.id ? go('') : null)}>
              <div className="kid-card-top"><Avatar member={k} size={52} /><div><b>{k.name}</b><small>{done} feitas · {t.count_pending} pendentes</small></div></div>
              <div className="kid-points"><span>Hoje</span><b>{t.earned}{t.provisional ? <em> +{t.provisional}</em> : null}</b><small>de {t.possible} pts</small></div>
              <Progress value={mp} goal={s.individual_goal} color={k.color} label="Mês" small />
              {t.count_awaiting > 0 && isParent && <span className="pill warn">{t.count_awaiting} para aprovar</span>}
            </button>
          )
        })}
      </div>

      <Section title="🤝 Meta da família" right={<span className="muted small">{s.days_left} dias restantes</span>}>
        <Progress value={groupPct} goal={s.group_goal} color="linear-gradient(90deg,#f472b6,#a78bfa,#34d399)" label={`Juntas: ${s.group.earned} de ${s.group.possible} pts até hoje`} />
        <p className="muted small">Meta do grupo: {s.group_goal}% · Faltam cerca de <b>{needGroup}</b> pontos no mês para chegar lá.</p>
      </Section>

      <Section title="🐷 Cofrinho dos sonhos" className="dream">
        <div className="dream-row">
          <div className="dream-jar" style={{ '--fill': Math.min(100, (groupPct / s.group_goal) * 100) + '%' }}><span>{dream?.option?.emoji || '🎁'}</span></div>
          <div>
            <b>{dream?.option ? dream.option.title : 'Escolham juntas o sonho do mês!'}</b>
            <p className="muted small">{Math.min(100, Math.round((groupPct / s.group_goal) * 100))}% do caminho até o prêmio coletivo.{dream?.status === 'approved' ? ' Prêmio aprovado! 🎉' : ''}</p>
            <button className="btn small" onClick={() => go('premios')}>Ver prêmios</button>
          </div>
        </div>
      </Section>

      <div className="motivation">{msg}</div>
      {isParent && <button className="btn primary full" onClick={() => go('painel')}>{live ? '🟢' : '⚪'} Acompanhar em tempo real</button>}
    </div>
  )
}
