import { createContext, useContext, useEffect, useState } from 'react'
import { photoUrl } from './lib'

export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

export function Avatar({ member, size = 56 }) {
  const [url, setUrl] = useState(null)
  useEffect(() => { let on = true; if (member?.photo_path) photoUrl(member.photo_path).then((u) => on && setUrl(u)); else setUrl(null); return () => { on = false } }, [member?.photo_path])
  const style = { width: size, height: size, fontSize: size * 0.55, borderColor: member?.color || '#c084fc', background: (member?.color || '#c084fc') + '22' }
  return (
    <div className="avatar" style={style} aria-label={member?.name}>
      {url ? <img src={url} alt={member?.name} /> : <span>{member?.avatar || '🙂'}</span>}
    </div>
  )
}

export function Progress({ value, goal, color = 'var(--lilac)', label, small }) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <div className={'progress' + (small ? ' small' : '')}>
      {label && <div className="progress-label"><span>{label}</span><b>{(value || 0).toLocaleString('pt-BR')}%</b></div>}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: v + '%', background: color }} />
        {goal ? <div className="progress-goal" style={{ left: goal + '%' }} title={'Meta ' + goal + '%'} /> : null}
      </div>
    </div>
  )
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button></div>
        {children}
      </div>
    </div>
  )
}

// Pergunta um texto (motivo/justificativa) sem usar janelas do navegador.
export function AskModal({ title, label, placeholder, okText = 'Confirmar', minLen = 3, extra, onOk, onClose, danger }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      {extra}
      <label className="field"><span>{label}</span>
        <textarea rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      {err && <p className="error">{err}</p>}
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy || text.trim().length < minLen}
          onClick={async () => { setBusy(true); setErr(''); try { await onOk(text.trim()); onClose() } catch (e) { setErr(e.message) } setBusy(false) }}>
          {busy ? 'Salvando…' : okText}
        </button>
      </div>
    </Modal>
  )
}

export function Confetti({ show }) {
  if (!show) return null
  const colors = ['#f472b6', '#c084fc', '#34d399', '#fbbf24', '#60a5fa']
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 36 }).map((_, i) => (
        <i key={i} style={{ left: (i * 37) % 100 + '%', background: colors[i % 5], animationDelay: (i % 9) * 0.05 + 's', transform: `rotate(${i * 23}deg)` }} />
      ))}
    </div>
  )
}

export function Loading({ text = 'Carregando…' }) {
  return <div className="loading"><div className="spinner" /><span>{text}</span></div>
}

export function Empty({ icon = '🌤️', children }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><div>{children}</div></div>
}

export function Section({ title, right, children, className = '' }) {
  return (
    <section className={'card ' + className}>
      {(title || right) && <div className="section-head"><h2>{title}</h2>{right}</div>}
      {children}
    </section>
  )
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}
