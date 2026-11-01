// Documents PDF à la demande : relevé de compte, lettre libre.
import { db } from '../db/connection'
import { audit } from '../db/util'
import { AppError } from '../errors'
import { AGING_BUCKETS, OPEN_STATUSES } from '@shared/constants'
import { todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { invoices } from './invoices'
import { dashboard } from './dashboard'
import { renderPdf, savePdf, statementHtml } from './pdf'

export const documents = {
  /** Relevé de compte d'une entreprise : factures restant dues + balance âgée, avec signature. */
  async statement(companyId: number) {
    const c = db().prepare('SELECT id, name, address, city FROM companies WHERE id = ? AND deleted_at IS NULL').get(companyId) as
      | { id: number; name: string; address: string | null; city: string | null }
      | undefined
    if (!c) throw new AppError('Entreprise introuvable.')
    const rows = invoices
      .listAll({ company_id: companyId, statuses: OPEN_STATUSES, sort: 'due_date', dir: 'asc' })
      .filter((r) => r.balance_minor > 0)
    const aging = dashboard.aging(companyId)
    const html = statementHtml({
      company: c,
      invoices: rows.map((r) => ({
        number: r.number,
        issue_date: r.issue_date,
        due_date: r.due_date,
        patient: r.patient_name || r.patient_matricule || '',
        voucher: r.voucher_number,
        amount_minor: r.amount_minor - r.credited_minor,
        paid_minor: r.paid_minor,
        balance_minor: r.balance_minor,
        currency: r.currency,
        days_late: r.days_late,
        status: r.status
      })),
      aging: [
        { label: 'Total dû (équiv. FCFA)', amount: formatMoney(aging.total, 'XAF') },
        ...AGING_BUCKETS.filter((b) => b.key !== 'non_echu').map((b) => ({ label: `Retard ${b.label}`, amount: formatMoney(aging.totals[b.key], 'XAF') }))
      ]
    })
    const path = await savePdf(await renderPdf(html), `Relevé de compte ${c.name} ${todayISO()}`)
    if (path) audit('document', 'entreprise', companyId, `Relevé de compte PDF généré pour ${c.name}`)
    return path
  }
}
