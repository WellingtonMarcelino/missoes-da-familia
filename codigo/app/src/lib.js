import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON)

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'missoes-auth' } })
  : null

// Cliente separado, usado só pelos pais para criar o acesso das meninas (não troca a sessão atual).
export function tempClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'missoes-temp' } })
}

export const kidPassword = (pin) => `mf.${pin}.missoes`

export function friendly(error) {
  const m = (error && (error.message || String(error))) || 'Erro desconhecido'
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.'
  if (/Invalid login credentials/i.test(m)) return 'E-mail, senha ou PIN incorretos.'
  if (/User already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".'
  if (/Password should be/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.'
  return m
}

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(friendly(error))
  return data
}

export async function sel(query) {
  const { data, error } = await query
  if (error) throw new Error(friendly(error))
  return data
}

// ---------- datas (sempre no fuso de Brasília) ----------
const TZ = 'America/Sao_Paulo'
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const WD_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function todaySP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function hourSP() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  return p
}
export function fmtTime(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ts)).replace(':', 'h')
}
export function fmtDateTime(ts) {
  if (!ts) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}
export const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
export const fmtD = (dt) => dt.toISOString().slice(0, 10)
export const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d) }
export const dow = (s) => parseD(s).getUTCDay()
export const monthStart = (s) => s.slice(0, 8) + '01'
export const monthEnd = (s) => { const d = parseD(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return fmtD(d) }
export const addMonths = (s, n) => { const d = parseD(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return fmtD(d) }
export const weekStart = (s) => addDays(s, -((dow(s) + 6) % 7))
export const prettyDate = (s) => { const d = parseD(s); return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}` }
export const shortDate = (s) => s.slice(8, 10) + '/' + s.slice(5, 7)
export const monthName = (s) => { const d = parseD(s); return `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}` }
export const timeStr = (t) => (t ? t.slice(0, 5).replace(':', 'h') : '')

export function pct(earned, possible) {
  if (!possible) return 0
  return Math.round((1000 * earned) / possible) / 10
}

export const STATUS = {
  pending: { label: 'Pendente', cls: 'st-pending', icon: '⏳' },
  awaiting: { label: 'Aguardando aprovação', cls: 'st-awaiting', icon: '🕓' },
  approved_on: { label: 'Concluída no horário', cls: 'st-ok', icon: '✅' },
  approved_late: { label: 'Concluída com atraso', cls: 'st-late', icon: '⏰' },
  rejected: { label: 'Recusada', cls: 'st-bad', icon: '↩️' },
  excused: { label: 'Dispensada', cls: 'st-excused', icon: '🕊️' },
  missed: { label: 'Não realizada', cls: 'st-bad', icon: '➖' },
}
export function statusOf(a, today) {
  if (a.status === 'approved') return STATUS[a.on_time ? 'approved_on' : 'approved_late']
  if (a.status === 'pending' && a.date < today) return { ...STATUS.missed, label: 'Não realizada (ainda pode marcar com atraso)' }
  return STATUS[a.status]
}

const PHOTO_CACHE = {}
export async function photoUrl(path) {
  if (!path) return null
  const hit = PHOTO_CACHE[path]
  if (hit && hit.exp > Date.now()) return hit.url
  const { data } = await supabase.storage.from('fotos').createSignedUrl(path, 3600)
  if (data?.signedUrl) PHOTO_CACHE[path] = { url: data.signedUrl, exp: Date.now() + 3000 * 1000 }
  return data?.signedUrl || null
}

export async function resizeImage(file, max = 512) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85))
}

export const MOTIVATION = [
  'Cada missão cumprida deixa nossa casa mais feliz! 🌈',
  'Juntas vocês vão mais longe. 💜',
  'Pequenos passos todos os dias fazem grandes conquistas. 🌱',
  'Família que coopera, brilha! ✨',
  'Hoje é um ótimo dia para fazer o seu melhor. 🌻',
  'Obrigado por cuidar da nossa casa com tanto carinho. 🏡',
  'Errar faz parte. O importante é tentar de novo! 🦋',
]
export const AVATARS = ['🦋', '🌻', '🐬', '🦄', '🐱', '🐼', '🦊', '🐰', '🌸', '⭐', '🌈', '🍓', '🐢', '🦜', '🎀', '👑', '🐝', '🌙']
