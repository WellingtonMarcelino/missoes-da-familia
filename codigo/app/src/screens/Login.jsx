import { useEffect, useState } from 'react'
import { supabase, kidPassword, friendly, rpc } from '../lib'

export default function Login() {
  const urlCode = new URLSearchParams(window.location.search).get('f')
  const [code, setCode] = useState(() => { const c = urlCode || localStorage.getItem('missoes-familia') || ''; if (urlCode) localStorage.setItem('missoes-familia', urlCode); return c })
  const [mode, setMode] = useState(code ? 'kid' : 'parent')
  return (
    <div className="login">
      <div className="login-hero">
        <div className="hero-emoji">🏡</div>
        <h1>Missões da Nossa Família</h1>
        <p>Tarefas, estudos e conquistas — juntos!</p>
      </div>
      <div className="tabs big">
        <button className={mode === 'kid' ? 'on' : ''} onClick={() => setMode('kid')}>👧 Sou filha</button>
        <button className={mode === 'parent' ? 'on' : ''} onClick={() => setMode('parent')}>🧑 Sou responsável</button>
      </div>
      {mode === 'kid' ? <KidLogin code={code} setCode={setCode} /> : <ParentLogin />}
    </div>
  )
}

function KidLogin({ code, setCode }) {
  const [tiles, setTiles] = useState(null)
  const [input, setInput] = useState('')
  const [pick, setPick] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!code) return
    rpc('login_tiles', { p_code: code }).then((t) => {
      if (t === null) { setErr('Código da família inválido.'); localStorage.removeItem('missoes-familia'); setCode('') }
      else setTiles(t)
    }).catch((e) => setErr(e.message))
  }, [code])

  const tryLogin = async (p) => {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: pick.login_email, password: kidPassword(p) })
    if (error) { setErr(friendly(error).replace('E-mail, senha ou PIN', 'PIN')); setPin('') }
    setBusy(false)
  }
  const press = (d) => {
    if (busy) return
    const p = (pin + d).slice(0, 4); setPin(p)
    if (p.length === 4) tryLogin(p)
  }

  if (!code) return (
    <div className="card narrow">
      <p>Peça para o papai ou a mamãe o <b>código da família</b> (ou abra o link que eles enviaram).</p>
      <label className="field"><span>Código da família</span><input value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="Ex.: A1B2C3D4" /></label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary full" disabled={input.length < 4} onClick={() => { setErr(''); localStorage.setItem('missoes-familia', input.trim()); setCode(input.trim()) }}>Continuar</button>
    </div>
  )
  if (!tiles) return <div className="card narrow">{err ? <p className="error">{err}</p> : <p>Carregando…</p>}</div>
  if (!pick) return (
    <div className="card narrow">
      <h2 className="center">Quem é você?</h2>
      {tiles.length === 0 && <p className="muted center">Os responsáveis ainda não criaram os PINs das meninas.</p>}
      <div className="kid-tiles">
        {tiles.map((t) => (
          <button key={t.id} className="kid-tile" style={{ borderColor: t.color, background: t.color + '18' }} onClick={() => { setPick(t); setPin(''); setErr('') }}>
            <span className="kid-emoji">{t.avatar}</span><b>{t.name}</b>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="card narrow center">
      <button className="link" onClick={() => setPick(null)}>← trocar</button>
      <div className="kid-emoji big">{pick.avatar}</div>
      <h2>Oi, {pick.name}!</h2>
      <p>Digite seu PIN secreto</p>
      <div className="pin-dots">{[0, 1, 2, 3].map((i) => <i key={i} className={pin.length > i ? 'on' : ''} />)}</div>
      {err && <p className="error">{err}</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === '' ? <span key={i} /> : (
          <button key={i} disabled={busy} onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : press(k))}>{k}</button>
        ))}
      </div>
    </div>
  )
}

function ParentLogin() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [name, setName] = useState('')
  const [signup, setSignup] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(''); setInfo('')
    if (signup) {
      localStorage.setItem('missoes-pending-name', name)
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pass, options: { emailRedirectTo: window.location.origin + window.location.pathname } })
      if (error) setErr(friendly(error))
      else if (!data.session) setInfo('Conta criada! Abra seu e-mail, clique no link de confirmação do Supabase e depois volte aqui para entrar.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass })
      if (error) setErr(friendly(error))
    }
    setBusy(false)
  }
  return (
    <form className="card narrow" onSubmit={submit}>
      {signup && <label className="field"><span>Seu nome</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Wellington" required /></label>}
      <label className="field"><span>E-mail</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label className="field"><span>Senha</span><input type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={pass} onChange={(e) => setPass(e.target.value)} minLength={6} required /></label>
      {err && <p className="error">{err}</p>}
      {info && <p className="ok">{info}</p>}
      <button className="btn primary full" disabled={busy}>{busy ? 'Aguarde…' : signup ? 'Criar minha conta' : 'Entrar'}</button>
      <button type="button" className="link center" onClick={() => setSignup(!signup)}>
        {signup ? 'Já tenho conta — entrar' : 'Primeiro acesso? Criar conta de responsável'}
      </button>
      {signup && <p className="muted small">A primeira pessoa a criar conta vira administradora. As demais precisam ser convidadas por e-mail.</p>}
    </form>
  )
}
