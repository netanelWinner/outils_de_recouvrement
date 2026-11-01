// Toutes les dates métier sont des chaînes ISO « AAAA-MM-JJ » (sans heure, sans fuseau).

const DAY_MS = 86_400_000
const pad = (n: number) => n.toString().padStart(2, '0')

export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Nombre de jours de b à a (a − b). */
export function diffDays(a: string, b: string): number {
  return Math.round((utc(a) - utc(b)) / DAY_MS)
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(utc(iso) + days * DAY_MS)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}

/** « 2026-11-02 » → « 02/11/2026 ». */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** « 2026-11-02 » → « 2 novembre 2026 ». */
export function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`
}

/** « 2026-11 » → « nov. 2026 ». */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${y}`
}

/** « 2026-11 » → « nov. 26 » (axes de graphiques). */
export function formatMonthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** Lit « 02/11/2026 », « 2/11/26 », « 2026-11-02 » ou un objet Date (Excel). */
export function parseDateFlexible(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Excel stocke les dates en UTC minuit
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Numéro de série Excel (jours depuis 1899-12-30)
    return addDays('1899-12-30', Math.floor(v))
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (isISODate(s.slice(0, 10))) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (!m) return null
  let y = Number(m[3])
  if (y < 100) y += 2000
  const iso = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`
  return isISODate(iso) ? iso : null
}
