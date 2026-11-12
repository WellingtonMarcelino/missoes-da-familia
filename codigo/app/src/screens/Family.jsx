import { useEffect, useState } from 'react'
import { useApp, Section, Loading, Avatar, Tabs, Empty } from '../components'
import { rpc, sel, supabase, fmtDateTime, prettyDate, timeStr, dow, todaySP } from '../lib'

export default function Family() {
  const { isParent } = useApp()
  const [tab, setTab] = useState('mural')
  return (
    <div className="stack">
      <h1>Nossa família 💜</h1>
      <Tabs value={tab} onChange={setTab} options={[['mural', '💌 Mural'], ['dia', '🎉 Dia da Família'], ['missoes', '🤝 Missões juntas']]} />
      {tab === 'mural' && <Mural />}
      {tab === 'dia' && <FamilyDay />}
      {tab === 'missoes' && <Missions isParent={isParent} />}
    </div>
  )
}

function Mural() {
  const { me, members, version, toast, refresh, isParent } = useApp()
  const [list, setList] = useState(null)
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState('gratidao')
  useEffect(() => { sel(supabase.from('gratitude').select('*').order('created_at', { ascending: false }).limit(80)).then(setList).catch((e) => toast(e.message, 'err')) }, [version])
  const others = members.filter((m) => m.id !== me.id && m.active)
  const m = (id) => members.find((x) => x.id === id)
  const send = async () => {
    try { await sel(supabase.from('gratitude').insert({ from_member: me.id, to_member: to, message: text.trim(), kind })); setText(''); toast('Mensagem enviada 💌'); refresh() } catch (e) { toast(e.message, 'err') }
  }
  return (
    <>
      <Section title="Escrever um agradecimento ou elogio">
        <div className="to-row">{others.map((o) => <button key={o.id} className={'to-pick' + (to === o.id ? ' on' : '')} onClick={() => setTo(o.id)}><Avatar member={o} size={40} /><small>{o.name}</small></button>)}</div>
        {isParent && <div className="tabs small"><button className={kind === 'gratidao' ? 'on' : ''} onClick={() => setKind('gratidao')}>🙏 Gratidão</button><button className={kind === 'incentivo' ? 'on' : ''} onClick={() => setKind('incentivo')}>🌟 Incentivo dos pais</button></div>}
        <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: Obrigada por me ajudar a guardar a louça hoje! 💜" />
        <button className="btn primary full" disabled={!to || !text.trim()} onClick={send}>Enviar 💌</button>
      </Section>
      {!list ? <Loading /> : list.length === 0 ? <Empty icon="💌">O mural está esperando a primeira mensagem!</Empty> : (
        <div className="mural">{list.map((g) => (
          <div key={g.id} className={'note-card ' + g.kind} style={{ '--kc': m(g.to_member)?.color }}>
            <div className="note-head"><Avatar member={m(g.from_member)} size={30} /><span><b>{m(g.from_member)?.name}</b> para <b>{m(g.to_member)?.name}</b></span></div>
            <p>{g.message}</p>
            <small>{g.kind === 'incentivo' ? '🌟 Incentivo · ' : ''}{fmtDateTime(g.created_at)}</small>
            {(isParent || g.from_member === me.id) && <button className="icon-btn del" title="Apagar" onClick={async () => { try { await sel(supabase.from('gratitude').delete().eq('id', g.id)); refresh() } catch (e) { toast(e.message, 'err') } }}>🗑️</button>}
          </div>
        ))}</div>
      )}
    </>
  )
}

function FamilyDay() {
  const { me, members, version, toast, refresh, settings } = useApp()
  const [day, setDay] = useState(null)
  const [opts, setOpts] = useState([])
  const [votes, setVotes] = useState([])
  useEffect(() => {
    rpc('next_family_day').then(async (d) => {
      setDay(d)
      const [o, v] = await Promise.all([sel(supabase.from('family_day_options').select('*').eq('active', true)), sel(supabase.from('family_day_votes').select('*').eq('date', d))])
      setOpts(o); setVotes(v)
    }).catch((e) => toast(e.message, 'err'))
  }, [version])
  if (!day) return <Loading />
  const mine = votes.find((v) => v.member_id === me.id)?.option_id
  const counts = Object.fromEntries(opts.map((o) => [o.id, votes.filter((v) => v.option_id === o.id).length]))
  const top = Math.max(0, ...Object.values(counts))
  const today = todaySP()
  return (
    <>
      <Section title={`🎉 Dia da Família — ${day === today ? 'hoje' : prettyDate(day)} às ${timeStr(settings?.family_day_time)}`}>
        <p className="muted small">Votem no que querem fazer juntos! Participar não vale pontos — vale momentos. 💜</p>
        <div className="options">{opts.map((o) => (
          <button key={o.id} className={'option vote' + (mine === o.id ? ' mine' : '') + (top > 0 && counts[o.id] === top ? ' leader' : '')}
            onClick={async () => { try { await rpc('vote_family_day', { p_option: o.id }); toast('Voto registrado!'); refresh() } catch (e) { toast(e.message, 'err') } }}>
            <span className="opt-emoji">{o.emoji}</span><b className="grow">{o.title}</b>
            <span className="voters">{votes.filter((v) => v.option_id === o.id).map((v) => <Avatar key={v.member_id} member={members.find((m) => m.id === v.member_id)} size={22} />)}</span>
          </button>
        ))}</div>
        {top > 0 && <p className="ok">Até agora vence: <b>{opts.filter((o) => counts[o.id] === top).map((o) => o.emoji + ' ' + o.title).join(' ou ')}</b></p>}
      </Section>
      <Section title={`⛪ Quinta-feira: culto às ${timeStr(settings?.culto_time)}`}>
        <ul className="timeline">
          <li><span className="tl-time">17h30</span><span>🛁 Banho e roupas separadas</span></li>
          <li><span className="tl-time">18h30</span><span>🍲 Jantar adiantado</span></li>
          <li><span className="tl-time">19h30</span><span>👟 Tudo pronto para sair</span></li>
        </ul>
        <p className="muted small">{dow(today) === settings?.culto_weekday ? 'É hoje! ' : ''}Apenas um lembrete carinhoso — não vale pontos nem é condição para prêmios.</p>
      </Section>
    </>
  )
}

function Missions({ isParent }) {
  const { members, version, toast, refresh } = useApp()
  const [list, setList] = useState(null)
  const [title, setTitle] = useState('')
  useEffect(() => { sel(supabase.from('family_missions').select('*').eq('active', true).order('created_at')).then(setList).catch(() => {}) }, [version])
  const act = async (fn, msg) => { try { await fn(); toast(msg); refresh() } catch (e) { toast(e.message, 'err') } }
  if (!list) return <Loading />
  return (
    <Section title="🤝 Desafios opcionais para fazer juntas">
      <p className="muted small">Sem pontos e sem competição: só pelo prazer de fazer junto!</p>
      {list.map((m) => (
        <div key={m.id} className={'mission' + (m.done_at ? ' done' : '')}>
          <span className="opt-emoji">{m.emoji}</span>
          <div className="grow"><b>{m.title}</b><div className="muted small">{m.description}</div>
            {m.done_at && <div className="ok small">Concluída em {fmtDateTime(m.done_at)} · marcada por {members.find((x) => x.id === m.done_by)?.name}</div>}</div>
          {!m.done_at ? <button className="btn small ok" onClick={() => act(() => rpc('complete_family_mission', { p_id: m.id }), 'Missão em família concluída! 🎉')}>Concluímos!</button>
            : isParent && <button className="btn small ghost" onClick={() => act(() => sel(supabase.from('family_missions').update({ done_at: null, done_by: null }).eq('id', m.id)), 'Missão reaberta')}>Repetir</button>}
        </div>
      ))}
      {isParent && <div className="row"><input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nova missão em família…" />
        <button className="btn" disabled={title.trim().length < 3} onClick={() => act(() => sel(supabase.from('family_missions').insert({ title: title.trim() })).then(() => setTitle('')), 'Missão criada')}>Criar</button></div>}
    </Section>
  )
}
