// Prévisions d'encaissement : date probable et probabilité de paiement de chaque facture ouverte,
// agrégées par mois. Montants en FCFA (déjà convertis).
import type { InvoiceStatus } from '../constants'
import type { Grade } from './scoring'
import { addDays, diffDays } from '../dates'

export interface ForecastItem {
  invoiceId: number
  companyId: number
  balanceXaf: number
  dueDate: string
  status: InvoiceStatus
  /** Retard moyen habituel de l'entreprise au-delà de l'échéance (jours). */
  companyLatenessDays: number | null
  companyGrade: Grade | null
  /** Promesse de paiement en cours sur cette facture (ou sur l'entreprise). */
  promise?: { date: string } | null
}

export interface ForecastResult {
  date: string
  probability: number
  reason: string
}

const GRADE_PROBABILITY: Record<Grade, number> = { A: 0.95, B: 0.85, C: 0.7, D: 0.55, E: 0.4 }
const DEFAULT_PROBABILITY = 0.7

/** Date et probabilité d'encaissement d'une facture. */
export function forecastInvoice(it: ForecastItem, today: string): ForecastResult {
  let p = it.companyGrade ? GRADE_PROBABILITY[it.companyGrade] : DEFAULT_PROBABILITY
  const late = diffDays(today, it.dueDate)
  if (it.promise && it.promise.date >= today) {
    return { date: it.promise.date, probability: Math.min(0.9, p + 0.1), reason: 'Promesse de paiement' }
  }
  if (it.status === 'contentieux') return { date: addDays(today, 90), probability: 0.25, reason: 'Dossier en contentieux' }
  let date = addDays(it.dueDate, Math.max(0, it.companyLatenessDays ?? 15))
  let reason = it.companyLatenessDays !== null ? 'Échéance + retard habituel de l’entreprise' : 'Échéance + 15 jours'
  if (it.status === 'rejetee') {
    // Il faut d'abord corriger et redéposer : le délai repart
    date = addDays(today, 45)
    p *= 0.6
    reason = 'Facture rejetée : à redéposer'
  }
  if (late > 180) p *= 0.3
  else if (late > 90) p *= 0.6
  if (date < today) {
    // Déjà au-delà du retard habituel : paiement attendu dans les prochaines semaines, avec moins de certitude
    date = addDays(today, 21)
    p *= 0.85
    reason = 'En retard au-delà des habitudes de l’entreprise'
  }
  return { date, probability: Math.round(p * 100) / 100, reason }
}

export interface ForecastBucket {
  key: string
  label: string
  /** Montant pondéré par la probabilité (prévision réaliste). */
  expected: number
  /** Montant total dû sur la période (si tout est payé). */
  potential: number
  count: number
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** Agrège les prévisions par mois sur `months` mois, plus une colonne « au-delà ». */
export function buildForecast(items: ForecastItem[], today: string, months = 3): { buckets: ForecastBucket[]; details: (ForecastItem & ForecastResult)[] } {
  const [y, m] = today.split('-').map(Number)
  const keys: string[] = []
  const buckets: ForecastBucket[] = []
  for (let k = 0; k < months; k++) {
    const d = new Date(Date.UTC(y, m - 1 + k, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    keys.push(key)
    buckets.push({ key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, expected: 0, potential: 0, count: 0 })
  }
  buckets.push({ key: 'later', label: 'Au-delà', expected: 0, potential: 0, count: 0 })
  const details = items
    .filter((i) => i.balanceXaf > 0)
    .map((i) => ({ ...i, ...forecastInvoice(i, today) }))
  for (const d of details) {
    const idx = keys.indexOf(d.date.slice(0, 7))
    const b = buckets[idx >= 0 ? idx : buckets.length - 1]
    b.expected += Math.round(d.balanceXaf * d.probability)
    b.potential += d.balanceXaf
    b.count++
  }
  return { buckets, details: details.sort((a, b) => a.date.localeCompare(b.date)) }
}
