// Imputation des paiements sur les factures et calcul du statut affiché.
import type { InvoiceStatus, WorkflowStatus } from '../constants'

export interface OpenInvoice {
  id: number
  dueDate: string
  issueDate: string
  /** Reste dû (unité mineure). */
  balance: number
}

export interface Allocation {
  invoiceId: number
  amount: number
}

/**
 * Imputation automatique « plus anciennes d'abord » : échéance la plus ancienne,
 * puis date d'émission, puis id. Retourne les imputations et le reliquat non imputé.
 */
export function autoAllocate(amount: number, invoices: OpenInvoice[]): { allocations: Allocation[]; remaining: number } {
  const sorted = [...invoices]
    .filter((i) => i.balance > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate) || a.id - b.id)
  let remaining = Math.max(0, amount)
  const allocations: Allocation[] = []
  for (const inv of sorted) {
    if (remaining <= 0) break
    const part = Math.min(remaining, inv.balance)
    allocations.push({ invoiceId: inv.id, amount: part })
    remaining -= part
  }
  return { allocations, remaining }
}

/**
 * Vérifie une imputation saisie. `balances` = reste dû de chaque facture AVANT ce paiement
 * (en réintégrant les imputations existantes de ce même paiement en cas de modification).
 * Retourne la liste des erreurs en français (vide si tout est correct).
 */
export function validateAllocations(paymentAmount: number, allocations: Allocation[], balances: Map<number, number>): string[] {
  const errors: string[] = []
  const seen = new Set<number>()
  let total = 0
  for (const a of allocations) {
    if (!Number.isInteger(a.amount) || a.amount <= 0) errors.push('Chaque montant imputé doit être supérieur à zéro.')
    if (seen.has(a.invoiceId)) errors.push('Une même facture apparaît deux fois dans l’imputation.')
    seen.add(a.invoiceId)
    const bal = balances.get(a.invoiceId)
    if (bal === undefined) errors.push('Une des factures choisies est introuvable ou ne peut pas recevoir ce paiement.')
    else if (a.amount > bal) errors.push('Le montant imputé dépasse le reste dû d’une facture.')
    total += a.amount
  }
  if (total > paymentAmount) errors.push('Le total imputé dépasse le montant du paiement.')
  return [...new Set(errors)]
}

/** Statut affiché, déduit du statut métier et des montants encaissés / crédités. */
export function deriveStatus(workflow: WorkflowStatus, amount: number, paid: number, credited: number): InvoiceStatus {
  if (workflow === 'annulee') return 'annulee'
  const balance = amount - paid - credited
  if (amount > 0 && balance <= 0) {
    // Entièrement couverte par des avoirs, sans aucun encaissement : c'est une annulation.
    return paid === 0 ? 'annulee' : 'soldee'
  }
  if (workflow === 'brouillon' || workflow === 'contentieux' || workflow === 'rejetee') return workflow
  if (paid > 0) return 'partiellement_payee'
  return workflow
}
