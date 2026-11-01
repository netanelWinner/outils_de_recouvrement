// Pénalités de retard prévues par la convention (intérêts simples, au prorata des jours).
import type { PenaltyType } from '../constants'

export interface PenaltyRule {
  type: PenaltyType
  /** Taux en % (annuel ou mensuel selon le type). */
  rate: number
  /** Montant fixe (unité mineure) pour le type « forfait ». */
  fixed: number
  /** Jours de tolérance après l'échéance avant d'appliquer une pénalité. */
  graceDays: number
}

/** Pénalité due (unité mineure, arrondie) sur un reste dû pour un retard donné. */
export function computePenalty(balance: number, daysLate: number, rule: PenaltyRule | null | undefined): number {
  if (!rule || rule.type === 'aucune' || balance <= 0) return 0
  const days = Math.max(0, daysLate - Math.max(0, rule.graceDays || 0))
  if (days === 0) return 0
  switch (rule.type) {
    case 'taux_annuel':
      return Math.round((balance * (rule.rate / 100) * days) / 365)
    case 'taux_mensuel':
      return Math.round((balance * (rule.rate / 100) * days) / 30)
    case 'forfait':
      return Math.max(0, Math.round(rule.fixed || 0))
    default:
      return 0
  }
}
