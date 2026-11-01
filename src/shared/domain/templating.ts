// Fusion des modèles de relance avec les variables {entreprise}, {montant}, etc.
import type { Currency } from '../constants'
import { formatDate, formatDateLong } from '../dates'
import { formatMoney } from '../money'

export interface TemplateInvoice {
  number: string
  issueDate: string
  dueDate: string
  balance: number
  currency: Currency
  daysLate: number
  penalty: number
  patient?: string | null
}

export interface TemplateContext {
  companyName: string
  contactName?: string | null
  invoices: TemplateInvoice[]
  hospital: { name: string; phone?: string; email?: string }
  signatory: { name: string; title: string }
  today: string
}

/** Somme par devise, formatée : « 1 250 000 FCFA + 3 000,00 USD ». */
export function sumByCurrency(items: { amount: number; currency: Currency }[]): string {
  const sums = new Map<Currency, number>()
  for (const it of items) sums.set(it.currency, (sums.get(it.currency) ?? 0) + it.amount)
  if (sums.size === 0) return formatMoney(0, 'XAF')
  return [...sums.entries()].map(([c, v]) => formatMoney(v, c)).join(' + ')
}

export function invoiceListText(invoices: TemplateInvoice[]): string {
  return invoices
    .map((i) => {
      const late = i.daysLate > 0 ? `, ${i.daysLate} jour${i.daysLate > 1 ? 's' : ''} de retard` : ''
      return `- Facture n° ${i.number} du ${formatDate(i.issueDate)} : ${formatMoney(i.balance, i.currency)} (échéance ${formatDate(i.dueDate)}${late})`
    })
    .join('\n')
}

export function buildVariables(ctx: TemplateContext): Record<string, string> {
  const inv = ctx.invoices
  const total = sumByCurrency(inv.map((i) => ({ amount: i.balance, currency: i.currency })))
  const oldestDue = inv.map((i) => i.dueDate).sort()[0]
  const maxLate = inv.reduce((m, i) => Math.max(m, i.daysLate), 0)
  const penalties = inv.filter((i) => i.penalty > 0)
  return {
    entreprise: ctx.companyName,
    contact: ctx.contactName?.trim() || 'Madame, Monsieur',
    n_facture: inv.map((i) => i.number).join(', '),
    montant: total,
    total_du: total,
    echeance: oldestDue ? formatDate(oldestDue) : '',
    jours_retard: String(maxLate),
    nb_factures: String(inv.length),
    liste_factures: invoiceListText(inv),
    penalites: penalties.length ? sumByCurrency(penalties.map((i) => ({ amount: i.penalty, currency: i.currency }))) : 'aucune',
    hopital: ctx.hospital.name,
    telephone_hopital: ctx.hospital.phone ?? '',
    email_hopital: ctx.hospital.email ?? '',
    signataire: ctx.signatory.name,
    fonction: ctx.signatory.title,
    date: formatDateLong(ctx.today)
  }
}

/** Remplace chaque {variable} connue ; les accolades inconnues sont laissées telles quelles. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole))
}

/** Variables inconnues présentes dans un modèle (pour avertir lors de l'édition). */
export function unknownVariables(text: string, known: string[]): string[] {
  const found = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1])
  return [...new Set(found.filter((k) => !known.includes(k)))]
}
