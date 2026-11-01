// Rejets et litiges de facturation : motif, pièce manquante, action corrective, re-dépôt, interlocuteur.
import { db } from '../db/connection'
import { audit, invoiceEvent } from '../db/util'
import { AppError } from '../errors'
import { rejectionUpdateSchema, type RejectionUpdateInput } from '@shared/schemas'
import { REJECTION_REASONS, type Currency, type RejectionReason, type RejectionStatus } from '@shared/constants'
import { todayISO } from '@shared/dates'

export interface RejectionRow {
  id: number
  invoice_id: number
  invoice_number: string
  company_id: number
  company_name: string
  amount_minor: number
  currency: Currency
  rejected_at: string
  reason_code: RejectionReason
  reason_text: string | null
  missing_document: string | null
  corrective_action: string | null
  client_contact_id: number | null
  contact_name: string | null
  redeposit_due: string | null
  redeposited_at: string | null
  status: RejectionStatus
  days_open: number
}

const SELECT = `SELECT r.*, i.number AS invoice_number, i.company_id, c.name AS company_name, i.amount_minor, i.currency,
  ct.full_name AS contact_name,
  CAST(julianday(COALESCE(r.redeposited_at, @today)) - julianday(r.rejected_at) AS INTEGER) AS days_open
  FROM rejections r JOIN invoices i ON i.id = r.invoice_id JOIN companies c ON c.id = i.company_id
  LEFT JOIN contacts ct ON ct.id = r.client_contact_id`

export const rejections = {
  list(q: { status?: RejectionStatus | null; company_id?: number | null; page?: number; page_size?: number } = {}) {
    const w = ['i.deleted_at IS NULL']
    const p: Record<string, unknown> = { today: todayISO() }
    if (q.status) {
      w.push('r.status = @status')
      p.status = q.status
    }
    if (q.company_id) {
      w.push('i.company_id = @company')
      p.company = q.company_id
    }
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const rows = db()
      .prepare(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY r.status = 'ouvert' DESC, COALESCE(r.redeposit_due, '9999') ASC, r.rejected_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...p, limit: pageSize, offset: (page - 1) * pageSize }) as RejectionRow[]
    const total = (db().prepare(`SELECT count(*) AS n FROM rejections r JOIN invoices i ON i.id = r.invoice_id WHERE ${w.join(' AND ')}`).get(p) as { n: number }).n
    return { rows, total, page, page_size: pageSize }
  },

  /** Statistiques par motif (pour comprendre et prévenir les rejets). */
  stats() {
    return db()
      .prepare(`SELECT r.reason_code, count(*) AS n, SUM(CASE WHEN r.status = 'ouvert' THEN 1 ELSE 0 END) AS open
        FROM rejections r JOIN invoices i ON i.id = r.invoice_id WHERE i.deleted_at IS NULL GROUP BY r.reason_code ORDER BY n DESC`)
      .all() as { reason_code: RejectionReason; n: number; open: number }[]
  },

  /** Rejets ouverts dont le re-dépôt est prévu aujourd'hui ou en retard (ou sans date). */
  dueForRedeposit(): RejectionRow[] {
    const today = todayISO()
    return db()
      .prepare(`${SELECT} WHERE i.deleted_at IS NULL AND r.status = 'ouvert' AND i.workflow_status = 'rejetee'
        AND (r.redeposit_due IS NULL OR r.redeposit_due <= @today) ORDER BY COALESCE(r.redeposit_due, r.rejected_at)`)
      .all({ today }) as RejectionRow[]
  },

  update(id: number, input: RejectionUpdateInput) {
    const d = rejectionUpdateSchema.parse(input)
    const before = db().prepare('SELECT * FROM rejections WHERE id = ?').get(id) as { invoice_id: number } | undefined
    if (!before) throw new AppError('Rejet introuvable.')
    db()
      .prepare(`UPDATE rejections SET reason_code=@reason_code, reason_text=@reason_text, missing_document=@missing_document,
        corrective_action=@corrective_action, client_contact_id=@client_contact_id, redeposit_due=@redeposit_due, status=@status,
        updated_at=datetime('now','localtime') WHERE id=@id`)
      .run({ ...d, id })
    invoiceEvent(before.invoice_id, 'rejet', `Suivi du rejet mis à jour (${REJECTION_REASONS[d.reason_code]})${d.corrective_action ? ' – action : ' + d.corrective_action : ''}`)
    audit('modification', 'rejet', id, 'Suivi de rejet modifié', before, d)
    return true
  }
}
