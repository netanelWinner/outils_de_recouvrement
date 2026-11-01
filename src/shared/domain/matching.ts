// Rapprochement bancaire : propose, pour une ligne de relevé, les factures (ou le paiement déjà saisi)
// qui correspondent le mieux. Logique pure, testée unitairement.
import type { Currency } from '../constants'
import { diffDays } from '../dates'
import { autoAllocate } from './allocation'

export interface BankLine {
  date: string
  label: string
  reference: string | null
  amount: number
  currency: Currency
}

export interface MatchInvoice {
  id: number
  number: string
  company_id: number
  company_name: string
  company_short: string | null
  balance: number
  currency: Currency
  due_date: string
  issue_date: string
}

export interface MatchPayment {
  id: number
  company_id: number
  company_name: string
  amount: number
  currency: Currency
  received_at: string
}

export interface Suggestion {
  kind: 'factures' | 'paiement'
  score: number
  reason: string
  company_id: number
  company_name: string
  /** Pour « factures » : imputations proposées. */
  allocations: { invoice_id: number; number: string; amount: number }[]
  /** Pour « paiement » : paiement déjà saisi à associer à la ligne. */
  payment_id?: number
}

const GENERIC = new Set(['SA', 'SAS', 'SARL', 'SASU', 'CONGO', 'LTD', 'LIMITED', 'GROUP', 'GROUPE', 'SOCIETE', 'STE', 'CIE', 'COMPANY', 'DEMO', 'THE', 'AND', 'ET', 'DES', 'DU', 'DE', 'LA', 'LE', 'LES'])

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}
const compact = (s: string) => normalize(s).replace(/ /g, '')

/** Mots significatifs d'un nom d'entreprise (≥ 4 lettres, hors mots génériques). */
export function nameTokens(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter((t) => t.length >= 4 && !GENERIC.has(t) && !/^\d+$/.test(t))
}

/** Part des mots du nom présents dans le libellé (0 à 1). Le sigle compte comme un nom complet. */
export function companyScore(label: string, name: string, short: string | null): number {
  const words = new Set(normalize(label).split(' '))
  if (short && short.length >= 2 && words.has(normalize(short))) return 1
  const tokens = nameTokens(name)
  if (!tokens.length) return 0
  return tokens.filter((t) => words.has(t)).length / tokens.length
}

/** Numéros de facture cités dans le libellé ou la référence (comparaison sans séparateurs). */
export function invoicesCited(text: string, invoices: MatchInvoice[]): MatchInvoice[] {
  const hay = compact(text)
  return invoices.filter((i) => {
    const n = compact(i.number)
    return n.length >= 4 && hay.includes(n)
  })
}

export function suggestMatches(line: BankLine, invoices: MatchInvoice[], payments: MatchPayment[], limit = 5): Suggestion[] {
  if (line.amount <= 0) return []
  const text = `${line.label} ${line.reference ?? ''}`
  const open = invoices.filter((i) => i.currency === line.currency && i.balance > 0)
  const out: Suggestion[] = []
  const byCompany = new Map<number, MatchInvoice[]>()
  for (const i of open) byCompany.set(i.company_id, [...(byCompany.get(i.company_id) ?? []), i])

  // 1. Paiement déjà saisi à la main : même montant, même devise, ±10 jours
  for (const p of payments) {
    if (p.currency !== line.currency || p.amount !== line.amount) continue
    const gap = Math.abs(diffDays(p.received_at, line.date))
    if (gap > 10) continue
    const nameBonus = companyScore(text, p.company_name, null) * 20
    out.push({
      kind: 'paiement',
      score: 70 - gap + nameBonus,
      reason: `Paiement déjà enregistré le ${p.received_at.split('-').reverse().join('/')} pour le même montant`,
      company_id: p.company_id,
      company_name: p.company_name,
      allocations: [],
      payment_id: p.id
    })
  }

  // 2. Numéros de facture cités dans le libellé
  const cited = invoicesCited(text, open)
  if (cited.length) {
    const companyId = cited[0].company_id
    const sameCompany = cited.filter((c) => c.company_id === companyId)
    const { allocations } = autoAllocate(
      line.amount,
      sameCompany.map((c) => ({ id: c.id, dueDate: c.due_date, issueDate: c.issue_date, balance: c.balance }))
    )
    const total = sameCompany.reduce((s, c) => s + c.balance, 0)
    out.push({
      kind: 'factures',
      score: 95 + (total === line.amount ? 5 : 0),
      reason: `N° de facture cité dans le libellé : ${sameCompany.map((c) => c.number).join(', ')}`,
      company_id: companyId,
      company_name: cited[0].company_name,
      allocations: allocations.map((a) => ({ invoice_id: a.invoiceId, number: sameCompany.find((c) => c.id === a.invoiceId)!.number, amount: a.amount }))
    })
  }

  for (const [companyId, list] of byCompany) {
    const cs = companyScore(text, list[0].company_name, list[0].company_short)
    // 3. Montant exact d'une facture
    for (const i of list) {
      if (i.balance === line.amount && !cited.some((c) => c.id === i.id)) {
        out.push({
          kind: 'factures',
          score: 55 + cs * 35,
          reason: `Montant identique au reste dû de la facture ${i.number}${cs > 0 ? ' et nom de l’entreprise reconnu' : ''}`,
          company_id: companyId,
          company_name: i.company_name,
          allocations: [{ invoice_id: i.id, number: i.number, amount: i.balance }]
        })
      }
    }
    // 4. Montant égal au total dû par l'entreprise (paiement groupé)
    const total = list.reduce((s, i) => s + i.balance, 0)
    if (list.length > 1 && total === line.amount) {
      out.push({
        kind: 'factures',
        score: 50 + cs * 40,
        reason: `Montant égal au total dû par l’entreprise (${list.length} factures)`,
        company_id: companyId,
        company_name: list[0].company_name,
        allocations: list.map((i) => ({ invoice_id: i.id, number: i.number, amount: i.balance }))
      })
    }
    // 5. Nom reconnu : imputation sur les plus anciennes
    if (cs >= 0.5) {
      const { allocations } = autoAllocate(
        line.amount,
        list.map((i) => ({ id: i.id, dueDate: i.due_date, issueDate: i.issue_date, balance: i.balance }))
      )
      out.push({
        kind: 'factures',
        score: 25 + cs * 30,
        reason: 'Nom de l’entreprise reconnu dans le libellé (imputation sur les factures les plus anciennes)',
        company_id: companyId,
        company_name: list[0].company_name,
        allocations: allocations.map((a) => ({ invoice_id: a.invoiceId, number: list.find((i) => i.id === a.invoiceId)!.number, amount: a.amount }))
      })
    }
  }

  // Dédoublonnage (même entreprise + mêmes factures), tri par score
  const seen = new Set<string>()
  return out
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const key = `${s.kind}:${s.company_id}:${s.payment_id ?? ''}:${s.allocations.map((a) => a.invoice_id).join(',')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((s) => ({ ...s, score: Math.min(100, Math.round(s.score)) }))
}

/** Colonnes d'un relevé bancaire, devinées depuis les en-têtes. */
export const BANK_FIELDS = [
  { key: 'date', label: 'Date de l’opération', required: true, aliases: ['date', 'date operation', 'date op', 'date valeur', 'date comptable', 'value date'] },
  { key: 'label', label: 'Libellé', required: true, aliases: ['libelle', 'libelle operation', 'description', 'operation', 'motif', 'details', 'narration'] },
  { key: 'credit', label: 'Crédit (encaissement)', required: false, aliases: ['credit', 'credits', 'montant credit', 'encaissement', 'entree'] },
  { key: 'debit', label: 'Débit', required: false, aliases: ['debit', 'debits', 'montant debit', 'sortie'] },
  { key: 'amount', label: 'Montant (signé)', required: false, aliases: ['montant', 'amount', 'somme'] },
  { key: 'reference', label: 'Référence', required: false, aliases: ['reference', 'ref', 'n operation', 'numero', 'piece'] }
] as const
export type BankFieldKey = (typeof BANK_FIELDS)[number]['key']
