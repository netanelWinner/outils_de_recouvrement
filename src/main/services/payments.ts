// Paiements reçus et imputation sur une ou plusieurs factures.
import { db } from '../db/connection'
import { audit, invoiceEvent, nowLocal, tx } from '../db/util'
import { likeParam } from '../db/sql'
import { AppError } from '../errors'
import { paymentSchema, type PaymentInput } from '@shared/schemas'
import { PAYMENT_METHODS, type Currency, type PaymentMethod } from '@shared/constants'
import { formatDate } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { autoAllocate, validateAllocations } from '@shared/domain/allocation'
import { invoices } from './invoices'

export interface PaymentRow {
  id: number
  company_id: number
  company_name: string
  received_at: string
  method: PaymentMethod
  reference: string | null
  bank_name: string | null
  amount_minor: number
  currency: Currency
  notes: string | null
  allocated_minor: number
  unallocated_minor: number
  invoice_numbers: string | null
  is_demo: number
}

export interface PaymentQuery {
  search?: string
  company_id?: number | null
  method?: PaymentMethod | null
  currency?: Currency | null
  from?: string | null
  to?: string | null
  unallocated_only?: boolean
  page?: number
  page_size?: number
}

const SELECT = `SELECT p.*, c.name AS company_name,
  COALESCE((SELECT SUM(amount_minor) FROM payment_allocations WHERE payment_id = p.id), 0) AS allocated_minor,
  p.amount_minor - COALESCE((SELECT SUM(amount_minor) FROM payment_allocations WHERE payment_id = p.id), 0) AS unallocated_minor,
  (SELECT group_concat(i.number, ', ') FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id) AS invoice_numbers
  FROM payments p JOIN companies c ON c.id = p.company_id`

function where(q: PaymentQuery) {
  const w = ['p.deleted_at IS NULL']
  const params: Record<string, unknown> = {}
  if (q.search?.trim()) {
    w.push(`(p.reference LIKE @s ESCAPE '\\' OR c.name LIKE @s ESCAPE '\\' OR p.bank_name LIKE @s ESCAPE '\\'
      OR p.id IN (SELECT pa.payment_id FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE i.number LIKE @s ESCAPE '\\'))`)
    params.s = likeParam(q.search)
  }
  if (q.company_id) {
    w.push('p.company_id = @company')
    params.company = q.company_id
  }
  if (q.method) {
    w.push('p.method = @method')
    params.method = q.method
  }
  if (q.currency) {
    w.push('p.currency = @currency')
    params.currency = q.currency
  }
  if (q.from) {
    w.push('p.received_at >= @from')
    params.from = q.from
  }
  if (q.to) {
    w.push('p.received_at <= @to')
    params.to = q.to
  }
  if (q.unallocated_only) w.push('p.amount_minor > COALESCE((SELECT SUM(amount_minor) FROM payment_allocations WHERE payment_id = p.id), 0)')
  return { w: w.join(' AND '), params }
}

function getRow(id: number): PaymentRow {
  const row = db().prepare(`${SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`).get(id) as PaymentRow | undefined
  if (!row) throw new AppError('Paiement introuvable.')
  return row
}

/** Contrôle et enregistre les imputations d'un paiement, puis met à jour les factures. */
function writeAllocations(paymentId: number, d: ReturnType<typeof paymentSchema.parse>, previousInvoiceIds: number[]): void {
  const open = invoices.openForPayment(d.company_id, d.currency, paymentId)
  const balances = new Map(open.map((o) => [o.id, o.balance_minor]))
  const allocs = d.allocations.filter((a) => a.amount_minor !== 0).map((a) => ({ invoiceId: a.invoice_id, amount: a.amount_minor }))
  const errors = validateAllocations(d.amount_minor, allocs, balances)
  if (errors.length) throw new AppError(errors.join(' '))
  db().prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(paymentId)
  const ins = db().prepare('INSERT INTO payment_allocations (payment_id, invoice_id, amount_minor) VALUES (?,?,?)')
  for (const a of allocs) {
    ins.run(paymentId, a.invoiceId, a.amount)
    invoiceEvent(
      a.invoiceId,
      'paiement',
      `Paiement reçu le ${formatDate(d.received_at)} (${PAYMENT_METHODS[d.method]}${d.reference ? ' ' + d.reference : ''}) : ${formatMoney(a.amount, d.currency)} imputé`
    )
  }
  for (const id of new Set([...previousInvoiceIds, ...allocs.map((a) => a.invoiceId)])) invoices.recompute(id)
}

export const payments = {
  list(q: PaymentQuery = {}) {
    const { w, params } = where(q)
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const rows = db()
      .prepare(`${SELECT} WHERE ${w} ORDER BY p.received_at DESC, p.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as PaymentRow[]
    const total = (db().prepare(`SELECT count(*) AS n FROM payments p JOIN companies c ON c.id = p.company_id WHERE ${w}`).get(params) as { n: number }).n
    const totals = db()
      .prepare(`SELECT p.currency, SUM(p.amount_minor) AS amount FROM payments p JOIN companies c ON c.id = p.company_id WHERE ${w} GROUP BY p.currency`)
      .all(params) as { currency: Currency; amount: number }[]
    return { rows, total, totals, page, page_size: pageSize }
  },

  listAll(q: PaymentQuery = {}): PaymentRow[] {
    const { w, params } = where(q)
    return db().prepare(`${SELECT} WHERE ${w} ORDER BY p.received_at DESC, p.id DESC`).all(params) as PaymentRow[]
  },

  get(id: number) {
    const payment = getRow(id)
    const allocations = db()
      .prepare(`SELECT pa.invoice_id, pa.amount_minor, i.number, i.issue_date, i.due_date, i.amount_minor AS invoice_amount, i.status
        FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = ? ORDER BY i.due_date`)
      .all(id) as { invoice_id: number; amount_minor: number; number: string; issue_date: string; due_date: string; invoice_amount: number; status: string }[]
    return { payment, allocations }
  },

  /** Factures ouvertes + proposition d'imputation « plus anciennes d'abord ». */
  suggest(p: { company_id: number; currency: Currency; amount_minor: number; payment_id?: number | null }) {
    const open = invoices.openForPayment(p.company_id, p.currency, p.payment_id ?? null)
    const { allocations, remaining } = autoAllocate(
      p.amount_minor,
      open.map((o) => ({ id: o.id, dueDate: o.due_date, issueDate: o.issue_date, balance: o.balance_minor }))
    )
    return { open, allocations: allocations.map((a) => ({ invoice_id: a.invoiceId, amount_minor: a.amount })), remaining }
  },

  create(input: PaymentInput) {
    const d = paymentSchema.parse(input)
    const company = db().prepare('SELECT name FROM companies WHERE id = ? AND deleted_at IS NULL').get(d.company_id) as { name: string } | undefined
    if (!company) throw new AppError('Entreprise introuvable.')
    return tx(() => {
      const r = db()
        .prepare(`INSERT INTO payments (company_id, received_at, method, reference, bank_name, amount_minor, currency, notes)
          VALUES (@company_id, @received_at, @method, @reference, @bank_name, @amount_minor, @currency, @notes)`)
        .run({ ...d, allocations: undefined })
      const id = Number(r.lastInsertRowid)
      writeAllocations(id, d, [])
      audit('creation', 'paiement', id, `Paiement de ${formatMoney(d.amount_minor, d.currency)} reçu de ${company.name}`, undefined, d)
      return { id }
    })
  },

  update(id: number, input: PaymentInput) {
    const d = paymentSchema.parse(input)
    const before = payments.get(id)
    if (before.payment.company_id !== d.company_id && before.allocations.length) {
      // Changement d'entreprise : les anciennes imputations sont forcément invalides
      d.allocations = d.allocations.filter((a) => !before.allocations.some((b) => b.invoice_id === a.invoice_id))
    }
    return tx(() => {
      db()
        .prepare(`UPDATE payments SET company_id=@company_id, received_at=@received_at, method=@method, reference=@reference,
          bank_name=@bank_name, amount_minor=@amount_minor, currency=@currency, notes=@notes, updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({ ...d, allocations: undefined, id })
      writeAllocations(id, d, before.allocations.map((a) => a.invoice_id))
      audit('modification', 'paiement', id, `Paiement n° ${id} modifié`, before, d)
      return { id }
    })
  },

  remove(id: number) {
    const { payment, allocations } = payments.get(id)
    tx(() => {
      db().prepare('UPDATE payments SET deleted_at = ?, bank_line_id = NULL WHERE id = ?').run(nowLocal(), id)
      // La ligne du relevé bancaire redevient « à rapprocher »
      db().prepare(`UPDATE bank_statement_lines SET status = 'non_rapproche', payment_id = NULL WHERE payment_id = ?`).run(id)
      for (const a of allocations) {
        invoiceEvent(a.invoice_id, 'paiement', `Paiement du ${formatDate(payment.received_at)} (${formatMoney(a.amount_minor, payment.currency)}) supprimé`)
        invoices.recompute(a.invoice_id)
      }
      audit('corbeille', 'paiement', id, `Paiement de ${formatMoney(payment.amount_minor, payment.currency)} (${payment.company_name}) mis à la corbeille`)
    })
    return true
  }
}
