// Scénario de relance : détermine, chaque jour, les relances à envoyer.
import type { InvoiceStatus } from '../constants'
import { diffDays } from '../dates'

export interface ScenarioStep {
  id: number
  /** Jours après l'échéance (négatif = rappel avant échéance). */
  offsetDays: number
}

export interface ReminderCandidate {
  invoiceId: number
  companyId: number
  /** Scénario propre à l'entreprise (null = scénario par défaut). */
  scenarioId: number | null
  dueDate: string
  balance: number
  status: InvoiceStatus
  /** Étapes déjà traitées (envoyées, ignorées ou en attente) pour cette facture. */
  handledStepIds: number[]
  /** Facture faisant l'objet d'une promesse de paiement en cours (relances suspendues). */
  hasPendingPromise?: boolean
}

export interface PlannedReminder {
  companyId: number
  stepId: number
  invoiceIds: number[]
}

/** Seules ces factures sont relancées automatiquement (pas les brouillons, rejets ou contentieux). */
export const REMINDABLE_STATUSES: InvoiceStatus[] = ['envoyee', 'acceptee', 'partiellement_payee']

/**
 * Pour chaque facture, on retient l'étape la plus avancée atteinte (offset ≤ retard).
 * Si cette étape — ou une étape plus avancée — a déjà été traitée, rien à faire :
 * on n'envoie jamais deux fois la même étape, et on ne revient jamais en arrière.
 * Une facture découverte tardivement (ex. J+40) saute directement à l'étape la plus forte.
 * Les factures sont regroupées par entreprise et par étape (une relance groupée).
 */
export function planReminders(
  candidates: ReminderCandidate[],
  stepsByScenario: Map<number | null, ScenarioStep[]>,
  today: string
): PlannedReminder[] {
  const groups = new Map<string, PlannedReminder>()
  for (const c of candidates) {
    if (!REMINDABLE_STATUSES.includes(c.status) || c.balance <= 0 || c.hasPendingPromise) continue
    const steps = stepsByScenario.get(c.scenarioId) ?? stepsByScenario.get(null) ?? []
    if (steps.length === 0) continue
    const late = diffDays(today, c.dueDate)
    const reached = steps.filter((s) => s.offsetDays <= late).sort((a, b) => b.offsetDays - a.offsetDays)[0]
    if (!reached) continue
    const handled = steps.filter((s) => c.handledStepIds.includes(s.id))
    if (handled.some((s) => s.offsetDays >= reached.offsetDays)) continue
    const key = `${c.companyId}:${reached.id}`
    const g = groups.get(key) ?? { companyId: c.companyId, stepId: reached.id, invoiceIds: [] }
    g.invoiceIds.push(c.invoiceId)
    groups.set(key, g)
  }
  return [...groups.values()]
}
