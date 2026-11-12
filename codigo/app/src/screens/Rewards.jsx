import { useEffect, useState } from 'react'
import { useApp, Section, Loading, Progress, AskModal, Modal, Avatar, Empty } from '../components'
import { rpc, sel, supabase, pct, monthName } from '../lib'

const ST = { locked: ['🔒', 'Bloqueado — metas ainda não atingidas'], voting: ['🗳️', 'Desbloqueado! Escolham juntas'], awaiting_approval: ['⏳', 'Escolhido — aguardando aprovação dos pais'], approved: ['✅', 'Aprovado'], done: ['🎉', 'Realizado'] }

export default function Rewards() {
  const { me, members, kids, version, isParent, toast, refresh, settings } = useApp()
  const [sum, setSum] = useState(null)
  const [opts, setOpts] = useState([])
  const [rewards, setRewards] = useState([])
  const [votes, setVotes] = useState([])
  const [closures, setClosures] = useState([])
  const [ask, setAsk] = useState(null)
  const [suggest, setSuggest] = useState(false)

  useEffect(() => {
    Promise.all([
      rpc('family_summary'),
      sel(supabase.from('reward_options').select('*').order('created_at')),
      sel(supabase.from('monthly_rewards').select('*').order('month', { ascending: false })),
      sel(supabase.from('reward_votes').select('*')),
      sel(supabase.from('month_closures').select('month, unlocked, summary').order('month', { ascending: false })),
    ]).then(([s, o, r, v, c]) => { setSum(s); setOpts(o); setRewards(r); setVotes(v); setClosures(c) }).catch((e) => toast(e.message, 'err'))
  }, [version])
  if (!sum) return <Loading />

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); refresh() } catch (e) { toast(e.message, 'err') } }
  const active = rewards.find((r) => ['voting', 'awaiting_approval', 'approved'].includes(r.status))
  const voteMonth = active?.month || sum.month_start
  const current = rewards.find((r) => r.month === voteMonth)
  const status = current?.status || 'locked'
  const budget = current?.budget ?? settings?.reward_budget
  const monthVotes = votes.filter((v) => v.month === voteMonth)
  const myVote = monthVotes.find((v) => v.member_id === me.id)?.option_id
  const canVote = me.role === 'child' && ['locked', 'voting'].includes(status)
  const groupPct = pct(sum.group.earned, sum.group.possible)
  const chosen = opts.find((o) => o.id === current?.chosen_option)
  const nameOf = (id) => members.find((m) => m.id === id)

  return (
    <div className="stack">
      <h1>Prêmios 🎁</h1>
      <Section title={`Progresso de ${monthName(sum.month_start)}`}>
        <Progress value={groupPct} goal={sum.group_goal} color="linear-gradient(90deg,#f472b6,#a78bfa)" label="Meta coletiva" />
        {sum.children.map((k) => <Progress key={k.id} small value={pct(k.month.earned, k.month.possible)} goal={sum.individual_goal} color={k.color} label={k.name} />)}
        <p className="muted small">O prêmio especial desbloqueia no fim do mês se as três chegarem a {sum.individual_goal}% e o grupo a {sum.group_goal}%. Pontos não são dinheiro. 💜</p>
      </Section>

      <Section title={`${ST[status][0]} Prêmio de ${monthName(voteMonth)}`}>
        <p><b>{ST[status][1]}</b>{budget ? ` · Orçamento: até R$ ${Number(budget).toLocaleString('pt-BR')}` : ''}</p>
        {current?.unlocked_manually && <p className="muted small">Nova oportunidade dada pelos pais: “{current.unlock_reason}”</p>}
        {chosen && <div className="chosen"><span>{chosen.emoji}</span><b>{chosen.title}</b></div>}
        {status === 'locked' && <p className="muted small">Vocês já podem ir votando no sonho do mês! A escolha vale quando o prêmio for desbloqueado.</p>}
        {status === 'voting' && <p className="muted small">As três precisam votar na <b>mesma opção</b>. Conversem e decidam juntas! 🗣️</p>}

        {isParent && <div className="actions">
          {status === 'locked' && <button className="btn ghost small" onClick={() => setAsk({ title: 'Dar nova oportunidade', label: 'Motivo', placeholder: 'Ex.: mês com muitas viagens, esforço reconhecido', okText: 'Desbloquear', onOk: (t) => act(() => rpc('unlock_reward', { p_month: voteMonth, p_reason: t }), 'Prêmio desbloqueado') })}>Desbloquear manualmente</button>}
          {status === 'awaiting_approval' && <>
            <button className="btn ok small" onClick={() => act(() => rpc('decide_reward', { p_month: voteMonth, p_action: 'approve', p_note: null }), 'Prêmio aprovado 🎉')}>Aprovar escolha</button>
            <button className="btn ghost small" onClick={() => setAsk({ title: 'Pedir nova votação', label: 'Explique com carinho', okText: 'Nova votação', onOk: (t) => act(() => rpc('decide_reward', { p_month: voteMonth, p_action: 'revote', p_note: t })) })}>Pedir nova votação</button>
          </>}
          {status === 'approved' && <button className="btn ok small" onClick={() => act(() => rpc('decide_reward', { p_month: voteMonth, p_action: 'done', p_note: null }), 'Registrado como realizado 🎉')}>Marcar como realizado</button>}
          {current && <button className="btn ghost small" onClick={() => setAsk({ title: 'Orçamento do prêmio', label: 'Valor máximo em reais', minLen: 1, okText: 'Salvar', onOk: (t) => act(() => rpc('decide_reward', { p_month: voteMonth, p_action: 'budget', p_note: t.replace(',', '.').replace(/[^0-9.]/g, '') }), 'Orçamento salvo') })}>Orçamento</button>}
        </div>}
      </Section>

      <Section title="Opções de prêmio" right={<button className="btn small" onClick={() => setSuggest(true)}>+ Sugerir</button>}>
        <div className="options">
          {opts.filter((o) => o.active).map((o) => {
            const vs = monthVotes.filter((v) => v.option_id === o.id)
            const over = budget && o.est_cost && Number(o.est_cost) > Number(budget)
            return (
              <div key={o.id} className={'option' + (myVote === o.id ? ' mine' : '') + (over ? ' over' : '')}>
                <span className="opt-emoji">{o.emoji}</span>
                <div className="grow"><b>{o.title}</b>
                  <div className="muted small">{o.est_cost ? `~R$ ${Number(o.est_cost).toLocaleString('pt-BR')}` : ''}{o.suggested_by ? ` · ideia de ${nameOf(o.suggested_by)?.name || ''}` : ''}{over ? ' · acima do orçamento' : ''}</div>
                  <div className="voters">{vs.map((v) => <Avatar key={v.member_id} member={nameOf(v.member_id)} size={24} />)}</div>
                </div>
                {canVote && !over && <button className={'btn small ' + (myVote === o.id ? 'primary' : '')} onClick={() => act(() => rpc('vote_reward', { p_month: voteMonth, p_option: o.id }), 'Voto registrado!')}>{myVote === o.id ? 'Meu voto ✓' : 'Votar'}</button>}
                {isParent && <button className="icon-btn" title="Esconder opção" onClick={() => act(() => sel(supabase.from('reward_options').update({ active: false }).eq('id', o.id)), 'Opção escondida')}>🙈</button>}
              </div>
            )
          })}
        </div>
        <p className="muted small">{monthVotes.length} de {kids.length} votos.</p>
      </Section>

      <Section title="📜 Histórico">
        {rewards.length === 0 && closures.length === 0 ? <Empty icon="📜">O histórico aparece depois do primeiro fechamento de mês.</Empty> : (
          <ul className="history">{Array.from(new Set([...rewards.map((r) => r.month), ...closures.map((c) => c.month)])).sort().reverse().map((m) => {
            const r = rewards.find((x) => x.month === m), c = closures.find((x) => x.month === m)
            const o = opts.find((x) => x.id === r?.chosen_option)
            return <li key={m}><b>{monthName(m)}</b><span>{c ? `Grupo: ${c.summary.group_pct ?? 0}% ${c.unlocked ? '· metas atingidas 🎉' : '· metas não atingidas'}` : 'Mês em andamento'}</span>
              <span>{r ? `${ST[r.status][0]} ${o ? o.emoji + ' ' + o.title : ST[r.status][1]}` : ''}</span></li>
          })}</ul>
        )}
      </Section>

      {suggest && <SuggestModal onClose={() => setSuggest(false)} me={me} act={act} />}
      {ask && <AskModal {...ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function SuggestModal({ onClose, me, act }) {
  const [title, setTitle] = useState(''); const [emoji, setEmoji] = useState('🎁'); const [cost, setCost] = useState('')
  return (
    <Modal title="Sugerir um prêmio" onClose={onClose}>
      <label className="field"><span>Ideia</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Tarde de sorvete" maxLength={80} /></label>
      <div className="emoji-row">{['🎁', '🍦', '🎬', '🍕', '🎡', '🧺', '🎮', '📚', '🏖️', '🎨'].map((e) => <button key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>)}</div>
      <label className="field"><span>Custo aproximado (R$, opcional)</span><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <div className="row end"><button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={title.trim().length < 2} onClick={async () => { await act(() => sel(supabase.from('reward_options').insert({ title: title.trim(), emoji, est_cost: cost ? Number(cost.replace(',', '.')) : null, suggested_by: me.id })), 'Ideia enviada!'); onClose() }}>Enviar ideia</button></div>
    </Modal>
  )
}
