// Suivi : promesses de paiement, validité des bons, prescription des créances.
import type { PromiseStatus, VoucherState } from '../constants'
import { addMonths, diffDays } from '../dates'

/**
 * Évalue une promesse de paiement à partir de ce que l'entreprise a payé depuis la promesse.
 * Tant que la date promise n'est pas dépassée, la promesse reste « en attente » (sauf si déjà honorée).
 * Le lendemain de la date promise : tenue, partiellement tenue ou non tenue.
 */
export function evaluatePromise(p: { amount: number; promisedDate: string; paidSince: number; today: string }): PromiseStatus {
  if (p.paidSince >= p.amount) return 'tenue'
  if (p.today <= p.promisedDate) return 'en_attente'
  return p.paidSince > 0 ? 'partielle' : 'non_tenue'
}

/** État affiché d'un bon de prise en charge. */
export function voucherState(v: {
  status: string
  validUntil: string | null
  ceiling: number | null
  used: number
  today: string
  warnDays: number
}): VoucherState {
  if (v.status === 'annule') return 'annule'
  if (v.validUntil && v.validUntil < v.today) return 'expire'
  if (v.ceiling !== null && v.ceiling > 0 && v.used >= v.ceiling) return 'consomme'
  if (v.validUntil && diffDays(v.validUntil, v.today) <= v.warnDays) return 'expire_bientot'
  return 'actif'
}

export type PrescriptionLevel = 'prescrite' | 'critique' | 'alerte' | null

/**
 * Prescription : la créance ne peut plus être réclamée en justice `years` ans après son exigibilité
 * (date d'échéance). Alerte à 6 mois, critique à 3 mois. Durée à confirmer par le service juridique.
 */
export function prescription(dueDate: string, years: number, today: string): { date: string; daysLeft: number; level: PrescriptionLevel } {
  const date = addMonths(dueDate, years * 12)
  const daysLeft = diffDays(date, today)
  const level: PrescriptionLevel = daysLeft <= 0 ? 'prescrite' : daysLeft <= 90 ? 'critique' : daysLeft <= 180 ? 'alerte' : null
  return { date, daysLeft, level }
}
