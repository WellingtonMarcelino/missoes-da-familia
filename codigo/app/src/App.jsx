import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, configured, rpc, sel, todaySP } from './lib'
import { AppCtx, Avatar, Loading, Modal } from './components'
import Login from './screens/Login'
import Home from './screens/Home'
import Missions from './screens/Missions'
import Panel from './screens/Panel'
import Agenda from './screens/Agenda'
import Rewards from './screens/Rewards'
import Family from './screens/Family'
import Reports from './screens/Reports'
import Settings from './screens/Settings'

const useHash = () => {
  const [h, setH] = useState(window.location.hash.slice(1) || '')
  useEffect(() => { const f = () => setH(window.location.hash.slice(1) || ''); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return [h, (v) => { window.location.hash = v }]
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(undefined)
  const [members, setMembers] = useState([])
  const [settings, setSettings] = useState(null)
  const [version, setVersion] = useState(0)
  const [live, setLive] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [notes, setNotes] = useState([])
  const [showNotes, setShowNotes] = useState(false)
  const [toast, setToastS] = useState(null)
  const [route, go] = useHash()
  const timer = useRef(null)

  const showToast = useCallback((msg, kind = 'ok') => { setToastS({ msg, kind }); clearTimeout(timer.current); timer.current = setTimeout(() => setToastS(null), 3500) }, [])

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // identifica o membro logado
  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return }
    const name = localStorage.getItem('missoes-pending-name')
    rpc('claim_membership', { p_name: name }).then((m) => { localStorage.removeItem('missoes-pending-name'); setMe(m || false) })
      .catch((e) => { showToast(e.message, 'err'); setMe(false) })
  }, [session?.user?.id])

  // carrega membros/configurações e gera as tarefas do dia
  useEffect(() => {
    if (!me) return
    sel(supabase.from('members').select('*').order('sort')).then((ms) => {
      setMembers(ms)
      const mine = ms.find((x) => x.id === me.id); if (mine && JSON.stringify(mine) !== JSON.stringify(me)) setMe(mine)
    }).catch(() => {})
    sel(supabase.from('settings').select('*').single()).then(setSettings).catch(() => {})
    sel(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40)).then(setNotes).catch(() => {})
  }, [me?.id, version])

  useEffect(() => {
    if (!me) return
    let lastDay = ''
    const run = () => { const d = todaySP(); if (d !== lastDay) { lastDay = d; rpc('sync_assignments').then(() => setVersion((v) => v + 1)).catch(() => {}) } }
    run(); const iv = setInterval(run, 60 * 1000)
    return () => clearInterval(iv)
  }, [me?.id])

  // tempo real: todos os aparelhos atualizam sozinhos
  useEffect(() => {
    if (!me) return
    let deb
    const ch = supabase.channel('familia-' + me.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_pulse' }, () => { clearTimeout(deb); deb = setTimeout(() => setVersion((v) => v + 1), 250) })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'member_id=eq.' + me.id }, (p) => {
        setNotes((n) => [p.new, ...n].slice(0, 40))
        showToast(p.new.title, 'info')
        try {
          if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted')
            navigator.serviceWorker?.ready.then((r) => r.showNotification(p.new.title, { body: p.new.body || '', icon: 'icon-192.png', badge: 'icon-192.png' }))
        } catch { /* sem suporte */ }
      })
      .subscribe((st) => setLive(st === 'SUBSCRIBED'))
    const vis = () => { if (document.visibilityState === 'visible') setVersion((v) => v + 1) }
    document.addEventListener('visibilitychange', vis)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis) }
  }, [me?.id])

  if (!configured) return <div className="center-screen"><div className="card"><h2>Configuração pendente</h2><p>O aplicativo ainda não foi ligado ao banco de dados.</p></div></div>
  if (session === undefined || (session && me === undefined)) return <div className="center-screen"><Loading text="Abrindo Missões da Família…" /></div>
  if (!session) return <Login />
  if (me === false) return <NoAccess />

  const isParent = me.role === 'parent'
  const unread = notes.filter((n) => !n.read_at).length
  const ctx = { me, members, kids: members.filter((m) => m.role === 'child' && m.active), settings, version, refresh: () => setVersion((v) => v + 1), toast: showToast, go, isParent, live, online }

  const tabs = isParent
    ? [['', '🏠', 'Início'], ['painel', '✅', 'Aprovar'], ['agenda', '📅', 'Agenda'], ['premios', '🎁', 'Prêmios'], ['familia', '💜', 'Família'], ['mais', '⚙️', 'Mais']]
    : [['', '⭐', 'Missões'], ['casa', '🏠', 'Família'], ['agenda', '📅', 'Agenda'], ['premios', '🎁', 'Prêmios'], ['familia', '💌', 'Mural']]
  const [base, param] = route.split('/')

  let screen
  if (isParent) {
    if (base === 'painel') screen = <Panel />
    else if (base === 'agenda') screen = <Agenda />
    else if (base === 'premios') screen = <Rewards />
    else if (base === 'familia') screen = <Family />
    else if (base === 'menina') screen = <Missions memberId={param} />
    else if (base === 'relatorios') screen = <Reports />
    else if (base === 'mais' || base === 'config') screen = <Settings />
    else screen = <Home />
  } else {
    if (base === 'casa') screen = <Home />
    else if (base === 'agenda') screen = <Agenda />
    else if (base === 'premios') screen = <Rewards />
    else if (base === 'familia') screen = <Family />
    else screen = <Missions memberId={me.id} />
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app" style={{ '--me': me.color }}>
        <header className="topbar">
          <div className="brand" onClick={() => go('')}><span className="logo">🏡</span><div><b>Missões</b><small>da Nossa Família</small></div></div>
          <div className="top-actions">
            <span className={'live ' + (live && online ? 'on' : '')} title={live ? 'Atualização ao vivo ligada' : 'Reconectando…'}>{live && online ? 'ao vivo' : 'reconectando'}</span>
            <button className="icon-btn bell" aria-label="Avisos" onClick={() => { setShowNotes(true); if (unread) rpc('mark_notifications_read').then(() => setNotes((n) => n.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })))).catch(() => {}) }}>
              🔔{unread > 0 && <em>{unread}</em>}
            </button>
            <button className="me-btn" onClick={() => go(isParent ? 'mais' : '')} aria-label="Meu perfil"><Avatar member={me} size={36} /></button>
          </div>
        </header>
        {!online && <div className="offline">📡 Sem internet. As mudanças não serão salvas até a conexão voltar.</div>}
        <main>{screen}</main>
        <nav className="bottom-nav">
          {tabs.map(([r, i, l]) => (
            <button key={r} className={base === r || (r === 'mais' && ['relatorios', 'config'].includes(base)) ? 'on' : ''} onClick={() => go(r)}>
              <span>{i}</span><small>{l}</small>
            </button>
          ))}
        </nav>
        {toast && <div className={'toast ' + toast.kind} role="status">{toast.msg}</div>}
        {showNotes && (
          <Modal title="Avisos" onClose={() => setShowNotes(false)}>
            {notes.length === 0 ? <p className="muted">Nenhum aviso ainda.</p> : (
              <ul className="notes">{notes.map((n) => <li key={n.id} className={n.read_at ? '' : 'unread'}><b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{new Date(n.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></li>)}</ul>
            )}
          </Modal>
        )}
      </div>
    </AppCtx.Provider>
  )
}

function NoAccess() {
  return (
    <div className="center-screen">
      <div className="card narrow">
        <div className="big-emoji">🔒</div>
        <h2>Acesso somente para convidados</h2>
        <p>Esta conta ainda não foi convidada para a família. Peça a um responsável para cadastrar seu e-mail em <b>Mais → Membros</b> e entre de novo.</p>
        <button className="btn primary full" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    </div>
  )
}
