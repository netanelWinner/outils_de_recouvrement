// Calcul de l'échéance d'une facture selon la convention.
import type { TermsStart } from '../constants'
import { addDays } from '../dates'

export interface DueDateInput {
  issueDate: string
  depositDate: string | null
  termsDays: number
  termsStart: TermsStart
}

/**
 * Échéance = date de départ + délai contractuel.
 * Si le délai court à partir du dépôt et que la facture n'est pas encore déposée,
 * on prend la date d'émission comme estimation provisoire.
 * Après un rejet puis un re-dépôt, la nouvelle date de dépôt fait donc repartir le délai.
 */
export function computeDueDate({ issueDate, depositDate, termsDays, termsStart }: DueDateInput): string {
  const start = termsStart === 'depot' && depositDate ? depositDate : issueDate
  return addDays(start, Math.max(0, Math.round(termsDays)))
}
