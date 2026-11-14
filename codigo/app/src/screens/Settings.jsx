import { useEffect, useState } from 'react'
import { useApp, Section, Loading, Avatar, Modal, Tabs } from '../components'
import { rpc, sel, supabase, kidPassword, resizeImage, WEEKDAYS, WD_SHORT, AVATARS, timeStr, todaySP, dow, addDays, shortDate } from '../lib'

export default function Settings() {
  const { go, isParent } = useApp()
  const [page, setPage] = useState(null)
  if (!isParent) return null
  const pages = { ausencias: Overrides, convite: Invite, membros: Members, rodizio: Rotation, tarefas: TaskTypes, horarios: Blocks, metas: Goals, avisos: Alerts }
  if (page) { const P = pages[page]; return <div className="stack"><button className="link" onClick={() => setPage(null)}>← voltar</button><P /></div> }
  const items = [['relatorios', '📊', 'Relatórios e fechamento do mês'], ['convite', '📲', 'Convidar a família / instalar no celular'], ['membros', '👨‍👩‍👧‍👧', 'Membros, fotos e PINs'],
    ['ausencias', '🗓️', 'Ausências e horários especiais'], ['rodizio', '🔁', 'Editar rodízio'], ['tarefas', '📝', 'Tarefas, pontos e prazos'], ['horarios', '🕐', 'Horários da tarde'], ['metas', '🎯', 'Metas, prêmios e datas'], ['avisos', '🔔', 'Avisos neste aparelho']]
  return (
    <div className="stack">
      <h1>Mais opções</h1>
      <div className="menu">{items.map(([k, i, l]) => <button key={k} className="menu-item" onClick={() => (k === 'relatorios' ? go('relatorios') : setPage(k))}><span>{i}</span>{l}<em>›</em></button>)}</div>
      <button className="btn ghost full" onClick={() => supabase.auth.signOut()}>Sair desta conta</button>
    </div>
  )
}

function Invite() {
  const { settings, toast } = useApp()
  if (!settings) return <Loading />
  const link = window.location.origin + window.location.pathname + '?f=' + settings.family_code
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Link copiado!') } catch { toast('Copie o link manualmente', 'err') } }
  const share = async () => { try { await navigator.share({ title: 'Missões da Nossa Família', text: 'Entre no nosso app da família:', url: link }) } catch { copy() } }
  return (
    <>
      <h1>Convidar a família</h1>
      <Section title="1. Envie este link pelo WhatsApp">
        <div className="link-box">{link}</div>
        <p className="muted small">Código da família: <b>{settings.family_code}</b></p>
        <div className="row"><button className="btn primary" onClick={share}>📤 Compartilhar</button><button className="btn ghost" onClick={copy}>Copiar</button></div>
      </Section>
      <Section title="2. Adicionar o ícone na tela inicial">
        <p><b>Android (Chrome):</b> abra o link → toque nos <b>⋮ três pontinhos</b> → <b>“Adicionar à tela inicial”</b> (ou “Instalar app”) → <b>Adicionar</b>.</p>
        <p><b>iPhone (Safari):</b> abra o link no <b>Safari</b> → toque em <b>Compartilhar ⬆️</b> → <b>“Adicionar à Tela de Início”</b> → <b>Adicionar</b>.</p>
      </Section>
      <Section title="3. Como cada um entra">
        <p>👧 <b>Meninas:</b> tocam em “Sou filha”, escolhem o nome e digitam o PIN de 4 números (crie em <b>Membros</b>).</p>
        <p>🧑 <b>Esposa:</b> cadastre o e-mail dela em <b>Membros → Convidar responsável</b>. Depois ela abre o link, toca em “Sou responsável” → “Criar conta” com esse mesmo e-mail.</p>
      </Section>
    </>
  )
}

function Members() {
  const { members, toast, refresh, me } = useApp()
  const [pinFor, setPinFor] = useState(null)
  const [edit, setEdit] = useState(null)
  const [inv, setInv] = useState({ name: '', email: '' })
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); refresh() } catch (e) { toast(e.message, 'err') } }
  const upload = async (m, file) => {
    if (!file) return
    await act(async () => {
      const blob = await resizeImage(file)
      const path = `membros/${m.id}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw new Error(error.message)
      if (m.photo_path) supabase.storage.from('fotos').remove([m.photo_path])
      await sel(supabase.from('members').update({ photo_path: path }).eq('id', m.id))
    }, 'Foto salva 📸')
  }
  return (
    <>
      <h1>Membros</h1>
      {members.filter((m) => m.active).map((m) => (
        <Section key={m.id}>
          <div className="row">
            <Avatar member={m} size={64} />
            <div className="grow"><b>{m.name}</b><div className="muted small">{m.role === 'parent' ? 'Responsável' + (m.user_id ? '' : ' · convite pendente: ' + m.invite_email) : m.user_id ? 'Acesso com PIN ativo ✅' : 'PIN ainda não criado'}</div></div>
          </div>
          <div className="actions">
            <label className="btn small ghost">📸 Foto<input type="file" accept="image/*" hidden onChange={(e) => upload(m, e.target.files[0])} /></label>
            {m.photo_path && <button className="btn small ghost" onClick={() => act(async () => { await supabase.storage.from('fotos').remove([m.photo_path]); await sel(supabase.from('members').update({ photo_path: null }).eq('id', m.id)) }, 'Foto removida')}>Tirar foto</button>}
            <button className="btn small ghost" onClick={() => setEdit(m)}>🎨 Cor e personagem</button>
            {m.role === 'child' && <button className="btn small primary" onClick={() => setPinFor(m)}>{m.user_id ? '🔑 Trocar PIN' : '🔑 Criar PIN'}</button>}
            {m.role === 'parent' && !m.user_id && <a className="btn small ok" target="_blank" rel="noreferrer" href={'https://wa.me/?text=' + encodeURIComponent('Oi! Crie sua conta no app Missões da Nossa Família: abra ' + window.location.origin + window.location.pathname + ' → "Sou responsável" → "Criar conta", usando este e-mail: ' + m.invite_email)}>📲 Enviar convite pelo WhatsApp</a>}
            {m.role === 'parent' && m.id !== me.id && <button className="btn small danger" onClick={() => act(() => sel(supabase.from('members').update({ active: false }).eq('id', m.id)), 'Acesso removido')}>Remover acesso</button>}
          </div>
        </Section>
      ))}
      <Section title="Convidar responsável (ex.: esposa)">
        <p className="muted small">O app não manda e-mail de convite. Cadastre o e-mail dela aqui e depois envie o link pelo WhatsApp.</p>
        <label className="field"><span>Nome</span><input value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></label>
        <label className="field"><span>E-mail</span><input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></label>
        <button className="btn primary" disabled={!inv.name || !inv.email.includes('@')} onClick={() => act(() => sel(supabase.from('members').insert({ name: inv.name.trim(), role: 'parent', invite_email: inv.email.trim().toLowerCase(), avatar: '👩', color: '#db2777', sort: 0 })).then(() => setInv({ name: '', email: '' })), 'Convite registrado! O app não envia e-mail: toque em “Enviar convite pelo WhatsApp”.')}>Convidar</button>
      </Section>
      {pinFor && <PinModal kid={pinFor} onClose={() => setPinFor(null)} act={act} />}
      {edit && <EditModal m={edit} onClose={() => setEdit(null)} act={act} />}
    </>
  )
}

function PinModal({ kid, onClose, act }) {
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try {
      await rpc('set_child_pin', { p_member: kid.id, p_password: kidPassword(pin) })
      await act(async () => {}, `PIN de ${kid.name} salvo! Anote: ${pin}`); onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Modal title={`PIN de ${kid.name}`} onClose={onClose}>
      <p className="muted small">4 números que só ela e vocês saibam. Evite datas de aniversário.</p>
      <input className="pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
      {err && <p className="error">{err}</p>}
      <button className="btn primary full" disabled={pin.length !== 4 || busy || /^(\d)\1{3}$/.test(pin) || pin === '1234'} onClick={save}>{busy ? 'Salvando…' : 'Salvar PIN'}</button>
      {(/^(\d)\1{3}$/.test(pin) || pin === '1234') && <p className="muted small">Escolha um PIN menos óbvio.</p>}
    </Modal>
  )
}

function EditModal({ m, onClose, act }) {
  const [color, setColor] = useState(m.color); const [avatar, setAvatar] = useState(m.avatar); const [name, setName] = useState(m.name)
  return (
    <Modal title={`Editar ${m.name}`} onClose={onClose}>
      <label className="field"><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="emoji-row">{['#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#db2777', '#7c3aed', '#14b8a6'].map((c) => <button key={c} className={'swatch' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
      <div className="avatar-grid">{[...AVATARS, '👨', '👩'].map((a) => <button key={a} className={avatar === a ? 'on' : ''} onClick={() => setAvatar(a)}>{a}</button>)}</div>
      <button className="btn primary full" onClick={async () => { await act(() => sel(supabase.from('members').update({ color, avatar, name: name.trim() || m.name }).eq('id', m.id)), 'Salvo'); onClose() }}>Salvar</button>
    </Modal>
  )
}

function Rotation() {
  const { kids, version, toast, refresh } = useApp()
  const [wd, setWd] = useState(String(dow(todaySP())))
  const [rot, setRot] = useState(null); const [types, setTypes] = useState([])
  useEffect(() => { Promise.all([sel(supabase.from('rotation').select('*')), sel(supabase.from('task_types').select('*').order('sort'))]).then(([r, t]) => { setRot(r); setTypes(t) }) }, [version])
  if (!rot) return <Loading />
  const has = (k, t) => rot.find((r) => r.weekday === Number(wd) && r.member_id === k && r.task_type_id === t)
  const toggle = async (k, t) => {
    const r = has(k, t)
    try {
      if (r) await sel(supabase.from('rotation').update({ active: !r.active }).eq('id', r.id))
      else await sel(supabase.from('rotation').insert({ weekday: Number(wd), member_id: k, task_type_id: t, due_time: [0, 6].includes(Number(wd)) ? '18:00' : null }))
      refresh()
    } catch (e) { toast(e.message, 'err') }
  }
  return (
    <>
      <h1>Rodízio semanal</h1>
      <p className="muted small">Toque para ligar ou desligar uma tarefa. O rodízio se repete toda semana. Mudanças valem a partir de amanhã — ou toque em “Aplicar hoje”.</p>
      <div className="tabs scroll">{WD_SHORT.map((w, i) => <button key={i} className={wd === String(i) ? 'on' : ''} onClick={() => setWd(String(i))}>{w}</button>)}</div>
      {kids.map((k) => (
        <Section key={k.id} title={<span className="row"><Avatar member={k} size={28} />{k.name} — {WEEKDAYS[wd]}</span>}>
          <div className="chips">{types.filter((t) => t.active).map((t) => { const r = has(k.id, t.id); const on = r && r.active
            return <button key={t.id} className={'chip' + (on ? ' on' : '')} style={on ? { background: k.color, borderColor: k.color, color: '#fff' } : {}} onClick={() => toggle(k.id, t.id)}>{t.icon} {t.name}</button> })}</div>
        </Section>
      ))}
      <button className="btn primary full" onClick={async () => { try { await rpc('refresh_today'); toast('Rodízio de hoje atualizado'); refresh() } catch (e) { toast(e.message, 'err') } }}>Aplicar mudanças também hoje</button>
    </>
  )
}

function TaskTypes() {
  const { version, toast, refresh } = useApp()
  const [types, setTypes] = useState(null)
  useEffect(() => { sel(supabase.from('task_types').select('*').order('sort')).then(setTypes) }, [version])
  if (!types) return <Loading />
  const save = async (t, patch) => { try { await sel(supabase.from('task_types').update(patch).eq('id', t.id)); toast('Salvo'); refresh() } catch (e) { toast(e.message, 'err') } }
  return (
    <>
      <h1>Tarefas, pontos e prazos</h1>
      <p className="muted small">Mudanças valem para as tarefas criadas a partir de agora. O histórico não muda.</p>
      {types.map((t) => (
        <Section key={t.id} className={t.active ? '' : 'faded'}>
          <div className="row"><span className="task-icon big">{t.icon}</span><b className="grow">{t.name}</b>
            <label className="switch"><input type="checkbox" checked={t.active} onChange={(e) => save(t, { active: e.target.checked })} /> ativa</label></div>
          <div className="row wrap">
            <label className="field sm"><span>Pontos</span><input type="number" min="0" max="50" defaultValue={t.points} disabled={t.optional} onBlur={(e) => Number(e.target.value) !== t.points && save(t, { points: Number(e.target.value) })} /></label>
            <label className="field sm"><span>Prazo</span><input type="time" defaultValue={t.default_due?.slice(0, 5)} onBlur={(e) => e.target.value && e.target.value !== t.default_due?.slice(0, 5) && save(t, { default_due: e.target.value })} /></label>
          </div>
          <label className="field"><span>Orientação de segurança</span><input defaultValue={t.guidance || ''} onBlur={(e) => e.target.value !== (t.guidance || '') && save(t, { guidance: e.target.value || null })} /></label>
        </Section>
      ))}
    </>
  )
}

function Blocks() {
  const { version, toast, refresh } = useApp()
  const [list, setList] = useState(null)
  useEffect(() => { sel(supabase.from('schedule_blocks').select('*').order('sort')).then(setList) }, [version])
  if (!list) return <Loading />
  const save = async (b, patch) => { try { await sel(supabase.from('schedule_blocks').update(patch).eq('id', b.id)); toast('Salvo'); refresh() } catch (e) { toast(e.message, 'err') } }
  return (
    <>
      <h1>Horários da tarde</h1>
      {list.map((b) => (
        <Section key={b.id}>
          <label className="field"><span>{b.icon} Atividade ({b.weekdays.map((d) => WD_SHORT[d]).join(', ')})</span><input defaultValue={b.label} onBlur={(e) => e.target.value !== b.label && save(b, { label: e.target.value })} /></label>
          <div className="row">
            <label className="field sm"><span>Início</span><input type="time" defaultValue={b.start_time.slice(0, 5)} onBlur={(e) => e.target.value && save(b, { start_time: e.target.value })} /></label>
            <label className="field sm"><span>Fim</span><input type="time" defaultValue={b.end_time?.slice(0, 5) || ''} onBlur={(e) => save(b, { end_time: e.target.value || null })} /></label>
          </div>
        </Section>
      ))}
      <p className="muted small">Os prazos que contam para a pontuação ficam em “Tarefas, pontos e prazos”.</p>
    </>
  )
}

function Goals() {
  const { settings, toast, refresh } = useApp()
  const [s, setS] = useState(settings)
  if (!s) return <Loading />
  const f = (k) => (e) => setS({ ...s, [k]: e.target.value })
  const save = async () => {
    try {
      await sel(supabase.from('settings').update({ family_name: s.family_name, individual_goal: Number(s.individual_goal), group_goal: Number(s.group_goal), late_factor: Number(s.late_factor), reward_budget: Number(s.reward_budget), family_day_weekday: Number(s.family_day_weekday), family_day_time: s.family_day_time, culto_weekday: Number(s.culto_weekday), culto_time: s.culto_time, penalty_fight: Number(s.penalty_fight), penalty_school: Number(s.penalty_school), updated_at: new Date().toISOString() }).eq('id', 1))
      toast('Configurações salvas'); refresh()
    } catch (e) { toast(e.message, 'err') }
  }
  return (
    <>
      <h1>Metas, prêmios e datas</h1>
      <Section>
        <label className="field"><span>Nome da família</span><input value={s.family_name} onChange={f('family_name')} /></label>
        <div className="row wrap">
          <label className="field sm"><span>Meta individual (%)</span><input type="number" value={s.individual_goal} onChange={f('individual_goal')} /></label>
          <label className="field sm"><span>Meta do grupo (%)</span><input type="number" value={s.group_goal} onChange={f('group_goal')} /></label>
          <label className="field sm"><span>Atraso vale (0 a 1)</span><input type="number" step="0.05" min="0" max="1" value={s.late_factor} onChange={f('late_factor')} /></label>
          <label className="field sm"><span>Orçamento do prêmio (R$)</span><input type="number" value={s.reward_budget} onChange={f('reward_budget')} /></label>
          <label className="field sm"><span>Desconto por briga (pts)</span><input type="number" min="0" value={s.penalty_fight} onChange={f('penalty_fight')} /></label>
          <label className="field sm"><span>Desconto por escola (pts)</span><input type="number" min="0" value={s.penalty_school} onChange={f('penalty_school')} /></label>
        </div>
        <div className="row wrap">
          <label className="field sm"><span>Dia da Família</span><select value={s.family_day_weekday} onChange={f('family_day_weekday')}>{WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}</select></label>
          <label className="field sm"><span>Horário</span><input type="time" value={timeStr(s.family_day_time).replace('h', ':')} onChange={f('family_day_time')} /></label>
          <label className="field sm"><span>Culto</span><select value={s.culto_weekday} onChange={f('culto_weekday')}>{WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}</select></label>
          <label className="field sm"><span>Horário</span><input type="time" value={timeStr(s.culto_time).replace('h', ':')} onChange={f('culto_time')} /></label>
        </div>
        <button className="btn primary full" onClick={save}>Salvar</button>
      </Section>
    </>
  )
}

function Alerts() {
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported')
  return (
    <>
      <h1>Avisos neste aparelho</h1>
      <Section>
        <p>Os avisos dentro do app (🔔) já funcionam em todos os aparelhos, em tempo real.</p>
        <p className="muted small">Você também pode permitir que o celular mostre um aviso do sistema enquanto o app estiver aberto ou em segundo plano. No iPhone, isso só funciona com o app adicionado à Tela de Início.</p>
        {perm === 'unsupported' ? <p className="muted">Este navegador não oferece avisos do sistema.</p>
          : perm === 'granted' ? <p className="ok">✅ Avisos permitidos neste aparelho.</p>
            : <button className="btn primary" onClick={async () => setPerm(await Notification.requestPermission())}>Permitir avisos</button>}
      </Section>
    </>
  )
}

export const SCOPES = [['todas', 'Todas as tarefas'], ['casa', 'Tarefas da casa'], ['estudo', 'Estudos e leitura'], ['rotina', 'Celular e mochila']]
function nextWeekend(from) { const d = dow(from); const sat = addDays(from, d === 0 ? -1 : (6 - d)); return [sat, addDays(sat, 1)] }

function Overrides() {
  const { kids, members, version, toast, refresh } = useApp()
  const today = todaySP()
  const [list, setList] = useState(null)
  const [types, setTypes] = useState([])
  const [kind, setKind] = useState('ausencia')
  const [who, setWho] = useState(null)
  const [from, setFrom] = useState(nextWeekend(today)[0])
  const [to, setTo] = useState(nextWeekend(today)[1])
  const [scope, setScope] = useState('todas')
  const [due, setDue] = useState('15:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([sel(supabase.from('schedule_overrides').select('*').eq('active', true).gte('date_to', addDays(today, -31)).order('date_from')),
      sel(supabase.from('task_types').select('id,name,icon').eq('active', true).order('sort'))]).then(([l, t]) => { setList(l); setTypes(t) }).catch((e) => toast(e.message, 'err'))
  }, [version])
  const name = (id) => (id ? members.find((m) => m.id === id)?.name : 'Todas')
  const scopeName = (sc) => SCOPES.find((x) => x[0] === sc)?.[1] || types.find((t) => t.id === sc)?.name || sc
  const save = async () => {
    setBusy(true)
    try {
      const r = await rpc('add_override', { p_kind: kind, p_from: from, p_to: to, p_member: who, p_scope: kind === 'ausencia' ? 'todas' : scope, p_new_due: kind === 'horario' ? due : null, p_reason: reason.trim() })
      toast(kind === 'ausencia' ? `Ausência registrada (${r.tarefas_alteradas} tarefas já dispensadas)` : 'Horário especial salvo'); setReason(''); refresh()
    } catch (e) { toast(e.message, 'err') }
    setBusy(false)
  }
  const wk = nextWeekend(today), wk2 = [addDays(wk[0], 7), addDays(wk[1], 7)]
  return (
    <>
      <h1>Ausências e horários especiais</h1>
      <p className="muted small">Para dias diferentes da rotina. As tarefas de quem está ausente ficam <b>dispensadas</b> e não prejudicam a meta. Horários especiais mudam o prazo só naqueles dias.</p>
      <Section>
        <div className="tabs"><button className={kind === 'ausencia' ? 'on' : ''} onClick={() => setKind('ausencia')}>🏠 Ausência</button><button className={kind === 'horario' ? 'on' : ''} onClick={() => setKind('horario')}>🕐 Mudar horário</button></div>
        <p className="field"><span>Quem</span></p>
        <div className="to-row">
          {kids.map((k) => <button key={k.id} className={'to-pick' + (who === k.id ? ' on' : '')} onClick={() => setWho(k.id)}><Avatar member={k} size={40} /><small>{k.name}</small></button>)}
          <button className={'to-pick' + (who === null ? ' on' : '')} onClick={() => setWho(null)}><span style={{ fontSize: 30 }}>👨‍👩‍👧‍👧</span><small>Todas</small></button>
        </div>
        <div className="chips">
          <button className="chip" onClick={() => { setFrom(today); setTo(today) }}>Hoje</button>
          <button className="chip" onClick={() => { setFrom(addDays(today, 1)); setTo(addDays(today, 1)) }}>Amanhã</button>
          <button className="chip" onClick={() => { setFrom(wk[0]); setTo(wk[1]) }}>Fim de semana {shortDate(wk[0])}</button>
          <button className="chip" onClick={() => { setFrom(wk2[0]); setTo(wk2[1]) }}>Fim de semana {shortDate(wk2[0])}</button>
        </div>
        <div className="row wrap">
          <label className="field sm"><span>De</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></label>
          <label className="field sm"><span>Até</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {kind === 'horario' && <div className="row wrap">
          <label className="field sm"><span>Quais tarefas</span><select value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <optgroup label="Uma tarefa">{types.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}</optgroup>
          </select></label>
          <label className="field sm"><span>Novo prazo</span><input type="time" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        </div>}
        <label className="field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'ausencia' ? 'Ex.: fim de semana na casa da mãe' : 'Ex.: consulta médica, reunião na escola'} /></label>
        {kind === 'ausencia' && <div className="chips">{['Fim de semana na casa da mãe', 'Viagem', 'Doente', 'Passeio da escola'].map((x) => <button key={x} className="chip" onClick={() => setReason(x)}>{x}</button>)}</div>}
        <button className="btn primary full" disabled={busy || reason.trim().length < 3 || !from || !to} onClick={save}>{busy ? 'Salvando…' : kind === 'ausencia' ? `Registrar ausência de ${name(who)}` : 'Salvar horário especial'}</button>
      </Section>
      <Section title="Registrados">
        {!list ? <Loading /> : list.length === 0 ? <p className="muted small">Nenhuma ausência ou horário especial registrado.</p> : (
          <ul className="feed">{list.map((o) => (
            <li key={o.id}><span>{o.kind === 'ausencia' ? '🏠' : '🕐'} <b>{name(o.member_id)}</b> · {shortDate(o.date_from)}{o.date_to !== o.date_from ? ' a ' + shortDate(o.date_to) : ''} · {o.kind === 'ausencia' ? 'ausente' : `${scopeName(o.scope)} até ${timeStr(o.new_due)}`}</span>
              <small>{o.reason}{o.date_to < today ? ' · já passou' : ''}</small>
              {o.date_to >= today && <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={async () => { try { await rpc('cancel_override', { p_id: o.id }); toast('Cancelado — tarefas voltaram ao normal'); refresh() } catch (e) { toast(e.message, 'err') } }}>Cancelar</button>}
            </li>))}</ul>
        )}
      </Section>
    </>
  )
}
