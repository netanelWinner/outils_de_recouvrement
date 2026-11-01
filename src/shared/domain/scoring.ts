// Score de fiabilité d'une entreprise (0 à 100, note A à E) à partir de son historique de paiement.

export interface ReliabilityInput {
  /** Délai moyen réel entre le dépôt (ou l'émission) et le paiement complet, pondéré par les montants. */
  avgDelayDays: number | null
  /** Délai contractuel moyen (jours). */
  avgTermsDays: number | null
  /** Part (0..1, pondérée par les montants) des factures payées au plus tard à l'échéance. */
  onTimeRate: number | null
  /** Part (0..1) des factures déposées qui ont subi au moins un rejet. */
  rejectionRate: number | null
  /** Part (0..1) des promesses tenues parmi les promesses arrivées à terme. */
  promiseKeptRate: number | null
  /** Nombre de factures entièrement payées dans l'historique. */
  paidCount: number
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

export interface Reliability {
  score: number | null
  grade: Grade | null
  /** Retard moyen au-delà de l'échéance (jours). */
  avgLatenessDays: number | null
  components: { label: string; value: number | null; weight: number }[]
  /** Pas assez d'historique pour un score fiable. */
  insufficient: boolean
}

/** Nombre minimal de factures payées pour calculer un score. */
export const MIN_PAID_FOR_SCORE = 3

export const GRADE_INFO: Record<Grade, { label: string; color: string }> = {
  A: { label: 'Très fiable', color: 'bg-emerald-600 text-white' },
  B: { label: 'Fiable', color: 'bg-emerald-100 text-emerald-800' },
  C: { label: 'Moyen', color: 'bg-amber-100 text-amber-800' },
  D: { label: 'Peu fiable', color: 'bg-orange-100 text-orange-800' },
  E: { label: 'À risque', color: 'bg-red-600 text-white' }
}

export function gradeFor(score: number): Grade {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'E'
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/**
 * Pondérations : ponctualité réelle (retard moyen) 40 %, part payée à l'heure 25 %,
 * rejets 20 %, promesses tenues 15 %. Une composante inconnue est neutralisée (poids redistribué).
 * Le retard est pénalisé de 1,5 point par jour (60 jours de retard moyen ≈ 10/100).
 */
export function computeReliability(i: ReliabilityInput): Reliability {
  const lateness = i.avgDelayDays !== null && i.avgTermsDays !== null ? Math.max(0, i.avgDelayDays - i.avgTermsDays) : null
  const components = [
    { label: 'Ponctualité (retard moyen)', value: lateness === null ? null : clamp(100 - lateness * 1.5), weight: 40 },
    { label: 'Factures payées à l’échéance', value: i.onTimeRate === null ? null : clamp(i.onTimeRate * 100), weight: 25 },
    { label: 'Factures sans rejet', value: i.rejectionRate === null ? null : clamp(100 - i.rejectionRate * 200), weight: 20 },
    { label: 'Promesses tenues', value: i.promiseKeptRate === null ? null : clamp(i.promiseKeptRate * 100), weight: 15 }
  ]
  const insufficient = i.paidCount < MIN_PAID_FOR_SCORE
  const known = components.filter((c) => c.value !== null)
  if (insufficient || !known.length) return { score: null, grade: null, avgLatenessDays: lateness === null ? null : Math.round(lateness), components, insufficient: true }
  const totalWeight = known.reduce((s, c) => s + c.weight, 0)
  const score = Math.round(known.reduce((s, c) => s + c.value! * c.weight, 0) / totalWeight)
  return { score, grade: gradeFor(score), avgLatenessDays: lateness === null ? null : Math.round(lateness), components, insufficient: false }
}
