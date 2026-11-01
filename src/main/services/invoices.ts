// Factures et avoirs : liste paginée, création, cycle de vie (dépôt, rejet, re-dépôt…), avoirs.
import { db } from '../db/connection'
import { audit, invoiceEvent, nowLocal, tx } from '../db/util'
import { BALANCE, likeParam } from '../db/sql'
import { AppError } from '../errors'
import {
  creditNoteSchema,
  invoiceActionSchema,
  invoiceSchema,
  type CreditNoteInput,
  type InvoiceActionInput,
  type InvoiceInput
} from '@shared/schemas'
import {
  INVOICE_ACTIONS,
  REJECTION_REASONS,
  STATUS_INFO,
  type AgingBucket,
  type Currency,
  type InvoiceStatus,
  type PenaltyType,
  type TermsStart,
  type WorkflowStatus
} from '@shared/constants'
import { addDays, diffDays, formatDate, todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { computeDueDate } from '@shared/domain/dueDates'
import { deriveStatus } from '@shared/domain/allocation'
import { computePenalty } from '@shared/domain/penalties'

export interface InvoiceRow {
  id: number
  number: string
  kind: 'facture' | 'avoir'
  company_id: number
  company_name: string
  convention_id: number | null
  convention_reference: string | null
  voucher_id: number | null
  voucher_number: string | null
  po_number: string | null
  patient_name: string | null
  patient_matricule: string | null
  issue_date: string
  deposit_date: string | null
  due_date: string
  amount_minor: number
  currency: Currency
  workflow_status: WorkflowStatus
  status: InvoiceStatus
  paid_minor: number
  credited_minor: number
  balance_minor: number
  days_late: number
  last_reminder_at: string | null
  is_demo: number
}

export interface InvoiceQuery {
  search?: string
  company_id?: number | null
  statuses?: InvoiceStatus[]
  currency?: Currency | null
  kind?: 'facture' | 'avoir' | 'all'
  issue_from?: string | null
  issue_to?: string | null
  due_from?: string | null
  due_to?: string | null
  overdue_only?: boolean
  aging?: AgingBucket | null
  sort?: 'number' | 'company' | 'issue_date' | 'due_date' | 'amount' | 'balance' | 'status' | 'days_late'
  dir?: 'asc' | 'desc'
  page?: number
  page_size?: number
}

const SORTS: Record<NonNullable<InvoiceQuery['sort']>, string> = {
  number: 'i.number COLLATE NOCASE',
  company: 'c.name COLLATE NOCASE',
  issue_date: 'i.issue_date',
  due_date: 'i.due_date',
  amount: 'i.amount_minor',
  balance: 'balance_minor',
  status: 'i.status',
  days_late: 'days_late'
}

const ROW_SELECT = `SELECT i.id, i.number, i.kind, i.company_id, c.name AS company_name, i.convention_id, cv.reference AS convention_reference,
  i.voucher_id, v.number AS voucher_number, i.po_number, i.patient_name, i.patient_matricule, i.issue_date, i.deposit_date,
  i.due_date, i.amount_minor, i.currency, i.workflow_status, i.status, i.paid_minor, i.credited_minor,
  ${BALANCE} AS balance_minor,
  CASE WHEN i.kind = 'facture' AND ${BALANCE} > 0 AND i.status NOT IN ('brouillon','annulee')
       THEN MAX(0, CAST(julianday(@today) - julianday(i.due_date) AS INTEGER)) ELSE 0 END AS days_late,
  (SELECT MAX(r.sent_at) FROM reminder_invoices ri JOIN reminders r ON r.id = ri.reminder_id WHERE ri.invoice_id = i.id) AS last_reminder_at,
  i.is_demo
  FROM invoices i
  JOIN companies c ON c.id = i.company_id
  LEFT JOIN conventions cv ON cv.id = i.convention_id
  LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id`

function buildWhere(q: InvoiceQuery): { where: string; params: Record<string, unknown> } {
  const today = todayISO()
  const w = ['i.deleted_at IS NULL']
  const p: Record<string, unknown> = { today }
  const kind = q.kind ?? 'facture'
  if (kind !== 'all') {
    w.push('i.kind = @kind')
    p.kind = kind
  }
  if (q.search?.trim()) {
    w.push(`(i.number LIKE @s ESCAPE '\\' OR i.patient_name LIKE @s ESCAPE '\\' OR i.patient_matricule LIKE @s ESCAPE '\\'
      OR i.po_number LIKE @s ESCAPE '\\' OR v.number LIKE @s ESCAPE '\\' OR c.name LIKE @s ESCAPE '\\')`)
    p.s = likeParam(q.search)
  }
  if (q.company_id) {
    w.push('(i.company_id = @company OR c.parent_company_id = @company)')
    p.company = q.company_id
  }
  if (q.statuses?.length) {
    const keys = q.statuses.filter((s) => s in STATUS_INFO)
    w.push(`i.status IN (${keys.map((_, n) => `@st${n}`).join(',')})`)
    keys.forEach((s, n) => (p[`st${n}`] = s))
  }
  if (q.currency) {
    w.push('i.currency = @currency')
    p.currency = q.currency
  }
  for (const [field, col] of [
    ['issue_from', 'i.issue_date >='],
    ['issue_to', 'i.issue_date <='],
    ['due_from', 'i.due_date >='],
    ['due_to', 'i.due_date <=']
  ] as const) {
    if (q[field]) {
      w.push(`${col} @${field}`)
      p[field] = q[field]
    }
  }
  if (q.overdue_only || q.aging) {
    w.push(`${BALANCE} > 0 AND i.status IN ('envoyee','acceptee','rejetee','partiellement_payee','contentieux')`)
  }
  if (q.overdue_only) w.push('i.due_date < @today')
  if (q.aging) {
    // Tranche de retard → intervalle de dates d'échéance
    const ranges: Record<AgingBucket, [number | null, number | null]> = {
      non_echu: [null, 0],
      j0_30: [1, 30],
      j31_60: [31, 60],
      j61_90: [61, 90],
      j90_plus: [91, null]
    }
    const [minLate, maxLate] = ranges[q.aging]
    if (q.aging === 'non_echu') w.push('i.due_date >= @today')
    else {
      if (minLate !== null) {
        w.push('i.due_date <= @agMax')
        p.agMax = addDays(today, -minLate)
      }
      if (maxLate !== null) {
        w.push('i.due_date >= @agMin')
        p.agMin = addDays(today, -maxLate)
      }
    }
  }
  return { where: w.join(' AND '), params: p }
}

function getRaw(id: number) {
  const row = db().prepare('SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL').get(id) as
    | (Record<string, unknown> & {
        id: number
        number: string
        kind: 'facture' | 'avoir'
        company_id: number
        convention_id: number | null
        voucher_id: number | null
        issue_date: string
        deposit_date: string | null
        due_date: string
        due_date_manual: number
        amount_minor: number
        currency: Currency
        workflow_status: WorkflowStatus
        status: InvoiceStatus
        paid_minor: number
        credited_minor: number
        corrects_invoice_id: number | null
        beneficiary_type: string
        subcontractor_name: string | null
        service_date: string | null
        notes: string | null
        is_demo: number
      })
    | undefined
  if (!row) throw new AppError('Facture introuvable (elle a peut-être été supprimée).')
  return row
}

function termsFor(companyId: number, conventionId: number | null): { days: number; start: TermsStart } {
  if (conventionId) {
    const cv = db()
      .prepare('SELECT payment_terms_days, terms_start, company_id FROM conventions WHERE id = ? AND deleted_at IS NULL')
      .get(conventionId) as { payment_terms_days: number; terms_start: TermsStart; company_id: number } | undefined
    if (!cv) throw new AppError('Convention introuvable.')
    if (cv.company_id !== companyId) throw new AppError('Cette convention n’appartient pas à l’entreprise choisie.')
    return { days: cv.payment_terms_days, start: cv.terms_start }
  }
  const c = db().prepare('SELECT payment_terms_days FROM companies WHERE id = ? AND deleted_at IS NULL').get(companyId) as
    | { payment_terms_days: number }
    | undefined
  if (!c) throw new AppError('Entreprise introuvable.')
  return { days: c.payment_terms_days, start: 'emission' }
}

/** Trouve ou crée le bon de prise en charge, et vérifie que le plafond n'est pas dépassé. */
function resolveVoucher(
  d: ReturnType<typeof invoiceSchema.parse>,
  exceptInvoiceId: number | null
): number | null {
  if (!d.voucher_number) return null
  let v = db()
    .prepare('SELECT * FROM coverage_vouchers WHERE company_id = ? AND number = ? COLLATE NOCASE AND deleted_at IS NULL')
    .get(d.company_id, d.voucher_number) as { id: number; ceiling_minor: number | null; currency: Currency; number: string } | undefined
  if (!v) {
    const r = db()
      .prepare(`INSERT INTO coverage_vouchers (company_id, convention_id, number, patient_name, patient_matricule, beneficiary_type,
        subcontractor_name, po_number, issue_date, ceiling_minor, currency) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        d.company_id,
        d.convention_id,
        d.voucher_number,
        d.patient_name,
        d.patient_matricule,
        d.beneficiary_type,
        d.subcontractor_name,
        d.po_number,
        d.service_date ?? d.issue_date,
        d.voucher_ceiling_minor,
        d.currency
      )
    return Number(r.lastInsertRowid)
  }
  if (d.voucher_ceiling_minor && d.voucher_ceiling_minor !== v.ceiling_minor) {
    db().prepare(`UPDATE coverage_vouchers SET ceiling_minor = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(d.voucher_ceiling_minor, v.id)
    v = { ...v, ceiling_minor: d.voucher_ceiling_minor }
  }
  if (v.ceiling_minor) {
    if (v.currency !== d.currency) throw new AppError(`Le bon n° ${v.number} est en ${v.currency} : la facture doit être dans la même devise.`)
    const used = (
      db()
        .prepare(`SELECT COALESCE(SUM(amount_minor - credited_minor), 0) AS s FROM invoices
          WHERE voucher_id = ? AND deleted_at IS NULL AND kind = 'facture' AND status <> 'annulee' AND id IS NOT ?`)
        .get(v.id, exceptInvoiceId) as { s: number }
    ).s
    if (used + d.amount_minor > v.ceiling_minor) {
      const left = Math.max(0, v.ceiling_minor - used)
      throw new AppError(
        `Plafond du bon n° ${v.number} dépassé : plafond ${formatMoney(v.ceiling_minor, v.currency)}, déjà facturé ${formatMoney(used, v.currency)}, ` +
          `reste disponible ${formatMoney(left, v.currency)}.`
      )
    }
  }
  return v.id
}

export const invoices = {
  list(q: InvoiceQuery = {}) {
    const { where, params } = buildWhere(q)
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const order = `${SORTS[q.sort ?? 'issue_date'] ?? SORTS.issue_date} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, i.id DESC`
    const rows = db()
      .prepare(`${ROW_SELECT} WHERE ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as InvoiceRow[]
    const from = `FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id WHERE ${where}`
    const total = (db().prepare(`SELECT count(*) AS n ${from}`).get(params) as { n: number }).n
    const totals = db()
      .prepare(`SELECT i.currency, SUM(i.amount_minor) AS amount, SUM(${BALANCE}) AS balance, count(*) AS n ${from} GROUP BY i.currency`)
      .all(params) as { currency: Currency; amount: number; balance: number; n: number }[]
    return { rows, total, totals, page, page_size: pageSize }
  },

  /** Tous les identifiants correspondant aux filtres (pour « tout sélectionner »). */
  listIds(q: InvoiceQuery = {}): number[] {
    const { where, params } = buildWhere(q)
    return (
      db()
        .prepare(`SELECT i.id FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id WHERE ${where}`)
        .all(params) as { id: number }[]
    ).map((r) => r.id)
  },

  /** Lignes complètes, sans pagination (export Excel). */
  listAll(q: InvoiceQuery = {}): InvoiceRow[] {
    const { where, params } = buildWhere(q)
    const order = `${SORTS[q.sort ?? 'issue_date'] ?? SORTS.issue_date} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, i.id DESC`
    return db().prepare(`${ROW_SELECT} WHERE ${where} ORDER BY ${order}`).all(params) as InvoiceRow[]
  },

  rowsByIds(ids: number[]): InvoiceRow[] {
    if (!ids.length) return []
    const ph = ids.map((_, n) => `@id${n}`).join(',')
    const p: Record<string, unknown> = { today: todayISO() }
    ids.forEach((id, n) => (p[`id${n}`] = id))
    return db().prepare(`${ROW_SELECT} WHERE i.id IN (${ph}) AND i.deleted_at IS NULL ORDER BY i.due_date, i.number`).all(p) as InvoiceRow[]
  },

  get(id: number) {
    const today = todayISO()
    const row = db().prepare(`${ROW_SELECT} WHERE i.id = @id AND i.deleted_at IS NULL`).get({ id, today }) as InvoiceRow | undefined
    if (!row) throw new AppError('Facture introuvable (elle a peut-être été supprimée).')
    const raw = getRaw(id)
    const convention = row.convention_id
      ? (db().prepare('SELECT * FROM conventions WHERE id = ?').get(row.convention_id) as Record<string, unknown> & {
          penalty_type: PenaltyType
          penalty_rate: number
          penalty_fixed_minor: number
          penalty_grace_days: number
          required_documents: string
          reference: string
          payment_terms_days: number
          terms_start: TermsStart
        })
      : null
    const voucher = row.voucher_id ? (db().prepare('SELECT * FROM coverage_vouchers WHERE id = ?').get(row.voucher_id) as Record<string, unknown>) : null
    const allocations = db()
      .prepare(`SELECT pa.id, pa.amount_minor, p.id AS payment_id, p.received_at, p.method, p.reference, p.currency
        FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
        WHERE pa.invoice_id = ? AND p.deleted_at IS NULL ORDER BY p.received_at`)
      .all(id) as { id: number; amount_minor: number; payment_id: number; received_at: string; method: string; reference: string | null; currency: Currency }[]
    const creditNotes = db()
      .prepare(`SELECT id, number, issue_date, amount_minor, currency, notes FROM invoices
        WHERE corrects_invoice_id = ? AND kind = 'avoir' AND deleted_at IS NULL ORDER BY issue_date`)
      .all(id) as { id: number; number: string; issue_date: string; amount_minor: number; currency: Currency; notes: string | null }[]
    const correctsInvoice = raw.corrects_invoice_id
      ? (db().prepare('SELECT id, number FROM invoices WHERE id = ?').get(raw.corrects_invoice_id) as { id: number; number: string })
      : null
    const events = db().prepare('SELECT * FROM invoice_events WHERE invoice_id = ? ORDER BY at DESC, id DESC').all(id) as {
      id: number
      at: string
      type: string
      from_status: string | null
      to_status: string | null
      message: string
    }[]
    const reminders = db()
      .prepare(`SELECT r.id, r.channel, r.tone, r.delivery, r.recipient, r.subject, r.sent_at FROM reminder_invoices ri
        JOIN reminders r ON r.id = ri.reminder_id WHERE ri.invoice_id = ? ORDER BY r.sent_at DESC`)
      .all(id) as { id: number; channel: string; tone: string; delivery: string; recipient: string | null; subject: string | null; sent_at: string }[]
    const rejections = db()
      .prepare(`SELECT r.*, c.full_name AS contact_name FROM rejections r LEFT JOIN contacts c ON c.id = r.client_contact_id
        WHERE r.invoice_id = ? ORDER BY r.rejected_at DESC, r.id DESC`)
      .all(id) as {
      id: number
      rejected_at: string
      reason_code: string
      reason_text: string | null
      missing_document: string | null
      corrective_action: string | null
      client_contact_id: number | null
      contact_name: string | null
      redeposit_due: string | null
      redeposited_at: string | null
      status: 'ouvert' | 'redepose' | 'clos'
    }[]
    const batches = db()
      .prepare(`SELECT b.id, b.reference, b.deposit_date, b.deposit_mode FROM deposit_batch_invoices bi JOIN deposit_batches b ON b.id = bi.batch_id
        WHERE bi.invoice_id = ? AND b.deleted_at IS NULL ORDER BY b.deposit_date DESC`)
      .all(id) as { id: number; reference: string; deposit_date: string; deposit_mode: string }[]
    const litigations = db()
      .prepare(`SELECT l.id, l.reference, l.status, l.handler_name FROM litigation_invoices li JOIN litigation_cases l ON l.id = li.case_id
        WHERE li.invoice_id = ? AND l.deleted_at IS NULL`)
      .all(id) as { id: number; reference: string; status: string; handler_name: string | null }[]
    const activities = db()
      .prepare(`SELECT a.id, a.type, a.occurred_at, a.summary, p.amount_minor AS promised_minor, p.currency AS promised_currency,
          p.promised_date, p.status AS promise_status
        FROM activity_invoices ai JOIN activities a ON a.id = ai.activity_id LEFT JOIN promises p ON p.activity_id = a.id
        WHERE ai.invoice_id = ? AND a.deleted_at IS NULL ORDER BY a.occurred_at DESC`)
      .all(id) as {
      id: number
      type: string
      occurred_at: string
      summary: string
      promised_minor: number | null
      promised_currency: Currency | null
      promised_date: string | null
      promise_status: string | null
    }[]
    const penalty =
      convention && row.kind === 'facture'
        ? computePenalty(row.balance_minor, row.days_late, {
            type: convention.penalty_type,
            rate: convention.penalty_rate,
            fixed: convention.penalty_fixed_minor,
            graceDays: convention.penalty_grace_days
          })
        : 0
    return {
      invoice: { ...row, ...raw, company_name: row.company_name, balance_minor: row.balance_minor, days_late: row.days_late },
      convention: convention ? { ...convention, required_documents: JSON.parse(convention.required_documents || '[]') as string[] } : null,
      voucher,
      allocations,
      creditNotes,
      correctsInvoice,
      events,
      reminders,
      penalty,
      rejections,
      batches,
      litigations,
      activities
    }
  },

  /** Suggestion d'échéance pour le formulaire. */
  previewDueDate(p: { company_id: number; convention_id: number | null; issue_date: string; deposit_date: string | null }) {
    const t = termsFor(p.company_id, p.convention_id)
    return { due_date: computeDueDate({ issueDate: p.issue_date, depositDate: p.deposit_date, termsDays: t.days, termsStart: t.start }), ...t }
  },

  numberExists(number: string, exceptId: number | null = null): boolean {
    return !!db().prepare('SELECT id FROM invoices WHERE number = ? COLLATE NOCASE AND id IS NOT ?').get(number.trim(), exceptId)
  },

  create(input: InvoiceInput) {
    const d = invoiceSchema.parse(input)
    if (invoices.numberExists(d.number)) throw new AppError(`Le numéro de facture « ${d.number} » existe déjà (vérifiez aussi la corbeille).`)
    return tx(() => {
      const t = termsFor(d.company_id, d.convention_id)
      const voucherId = resolveVoucher(d, null)
      const depositDate = d.workflow_status === 'brouillon' ? d.deposit_date : (d.deposit_date ?? d.issue_date)
      const due = d.due_date_manual && d.due_date ? d.due_date : computeDueDate({ issueDate: d.issue_date, depositDate, termsDays: t.days, termsStart: t.start })
      const r = db()
        .prepare(`INSERT INTO invoices (number, kind, company_id, convention_id, voucher_id, po_number, patient_name, patient_matricule,
          beneficiary_type, subcontractor_name, service_date, issue_date, deposit_date, due_date, due_date_manual, amount_minor, currency,
          workflow_status, status, status_changed_at, notes)
          VALUES (@number, 'facture', @company_id, @convention_id, @voucher_id, @po_number, @patient_name, @patient_matricule,
          @beneficiary_type, @subcontractor_name, @service_date, @issue_date, @deposit_date, @due_date, @due_date_manual, @amount_minor, @currency,
          @workflow_status, @workflow_status, @now, @notes)`)
        .run({
          number: d.number,
          company_id: d.company_id,
          convention_id: d.convention_id,
          voucher_id: voucherId,
          po_number: d.po_number,
          patient_name: d.patient_name,
          patient_matricule: d.patient_matricule,
          beneficiary_type: d.beneficiary_type,
          subcontractor_name: d.subcontractor_name,
          service_date: d.service_date,
          issue_date: d.issue_date,
          deposit_date: depositDate,
          due_date: due,
          due_date_manual: d.due_date_manual ? 1 : 0,
          amount_minor: d.amount_minor,
          currency: d.currency,
          workflow_status: d.workflow_status,
          now: nowLocal(),
          notes: d.notes
        })
      const id = Number(r.lastInsertRowid)
      invoiceEvent(id, 'creation', `Facture créée (${STATUS_INFO[d.workflow_status].label}) – ${formatMoney(d.amount_minor, d.currency)}, échéance ${formatDate(due)}`, {
        to: d.workflow_status
      })
      audit('creation', 'facture', id, `Facture ${d.number} créée`, undefined, d)
      return { id }
    })
  },

  update(id: number, input: InvoiceInput) {
    const d = invoiceSchema.parse(input)
    const before = getRaw(id)
    if (before.kind !== 'facture') throw new AppError('Un avoir ne se modifie pas : supprimez-le et recréez-le.')
    if (invoices.numberExists(d.number, id)) throw new AppError(`Le numéro de facture « ${d.number} » existe déjà.`)
    const covered = before.paid_minor + before.credited_minor
    if (covered > 0 && d.company_id !== before.company_id) throw new AppError('Cette facture a déjà reçu des paiements ou avoirs : l’entreprise ne peut plus être changée.')
    if (covered > 0 && d.currency !== before.currency) throw new AppError('Cette facture a déjà reçu des paiements ou avoirs : la devise ne peut plus être changée.')
    if (d.amount_minor < covered)
      throw new AppError(`Le montant ne peut pas être inférieur à ce qui est déjà payé ou crédité (${formatMoney(covered, before.currency)}).`)
    return tx(() => {
      const t = termsFor(d.company_id, d.convention_id)
      const voucherId = resolveVoucher(d, id)
      const due = d.due_date_manual && d.due_date ? d.due_date : computeDueDate({ issueDate: d.issue_date, depositDate: d.deposit_date, termsDays: t.days, termsStart: t.start })
      db()
        .prepare(`UPDATE invoices SET number=@number, company_id=@company_id, convention_id=@convention_id, voucher_id=@voucher_id,
          po_number=@po_number, patient_name=@patient_name, patient_matricule=@patient_matricule, beneficiary_type=@beneficiary_type,
          subcontractor_name=@subcontractor_name, service_date=@service_date, issue_date=@issue_date, deposit_date=@deposit_date,
          due_date=@due_date, due_date_manual=@due_date_manual, amount_minor=@amount_minor, currency=@currency, notes=@notes,
          updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({
          id,
          number: d.number,
          company_id: d.company_id,
          convention_id: d.convention_id,
          voucher_id: voucherId,
          po_number: d.po_number,
          patient_name: d.patient_name,
          patient_matricule: d.patient_matricule,
          beneficiary_type: d.beneficiary_type,
          subcontractor_name: d.subcontractor_name,
          service_date: d.service_date,
          issue_date: d.issue_date,
          deposit_date: d.deposit_date,
          due_date: due,
          due_date_manual: d.due_date_manual ? 1 : 0,
          amount_minor: d.amount_minor,
          currency: d.currency,
          notes: d.notes
        })
      const changes: string[] = []
      if (before.amount_minor !== d.amount_minor) changes.push(`montant ${formatMoney(before.amount_minor, before.currency)} → ${formatMoney(d.amount_minor, d.currency)}`)
      if (before.due_date !== due) changes.push(`échéance ${formatDate(before.due_date)} → ${formatDate(due)}`)
      if (before.number !== d.number) changes.push(`numéro ${before.number} → ${d.number}`)
      invoiceEvent(id, 'modification', `Facture modifiée${changes.length ? ' : ' + changes.join(', ') : ''}`)
      invoices.recompute(id)
      audit('modification', 'facture', id, `Facture ${d.number} modifiée`, before, d)
      return { id }
    })
  },

  /** Applique une action de cycle de vie à une ou plusieurs factures. */
  applyAction(input: InvoiceActionInput) {
    const a = invoiceActionSchema.parse(input)
    const def = INVOICE_ACTIONS[a.action]
    const date = a.date ?? todayISO()
    const skipped: { number: string; reason: string }[] = []
    let done = 0
    tx(() => {
      for (const id of a.ids) {
        const inv = getRaw(id)
        if (inv.kind !== 'facture') {
          skipped.push({ number: inv.number, reason: 'c’est un avoir' })
          continue
        }
        if (!(def.from as readonly string[]).includes(inv.workflow_status)) {
          skipped.push({ number: inv.number, reason: `statut actuel « ${STATUS_INFO[inv.status].label} »` })
          continue
        }
        if ((a.action === 'brouillon' || a.action === 'annuler') && inv.paid_minor + inv.credited_minor > 0) {
          skipped.push({ number: inv.number, reason: 'elle a déjà reçu un paiement ou un avoir' })
          continue
        }
        let message: string = def.label
        const updates: Record<string, unknown> = { workflow_status: def.to }
        if (a.action === 'envoyer' || a.action === 'redeposer') {
          if (date < inv.issue_date) {
            skipped.push({ number: inv.number, reason: 'la date de dépôt précède la date d’émission' })
            continue
          }
          updates.deposit_date = date
          if (!inv.due_date_manual) {
            const t = termsFor(inv.company_id, inv.convention_id)
            updates.due_date = computeDueDate({ issueDate: inv.issue_date, depositDate: date, termsDays: t.days, termsStart: t.start })
          }
          message =
            a.action === 'envoyer'
              ? `Facture déposée chez le client le ${formatDate(date)}`
              : `Facture corrigée et redéposée le ${formatDate(date)} – le délai de paiement repart`
          if (updates.due_date && updates.due_date !== inv.due_date) message += ` (nouvelle échéance ${formatDate(updates.due_date as string)})`
        }
        if (a.action === 'rejeter') {
          message = `Rejet du client le ${formatDate(date)} : ${REJECTION_REASONS[a.reason_code!]}${a.reason_text ? ' – ' + a.reason_text : ''}`
        }
        if (a.action === 'contentieux') message = `Dossier passé en contentieux le ${formatDate(date)}${a.reason_text ? ' – ' + a.reason_text : ''}`
        if (a.reason_text && a.action !== 'rejeter' && a.action !== 'contentieux') message += ` – ${a.reason_text}`
        const sets = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ')
        db().prepare(`UPDATE invoices SET ${sets}, updated_at = datetime('now','localtime') WHERE id = @id`).run({ ...updates, id })
        if (a.action === 'rejeter') {
          db()
            .prepare(`INSERT INTO rejections (invoice_id, rejected_at, reason_code, reason_text, missing_document, corrective_action,
              client_contact_id, redeposit_due, is_demo) VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(id, date, a.reason_code, a.reason_text, a.missing_document, a.corrective_action, a.client_contact_id, a.redeposit_due, inv.is_demo ?? 0)
          if (a.missing_document) message += ` – pièce manquante : ${a.missing_document}`
        }
        if (a.action === 'redeposer') {
          db().prepare(`UPDATE rejections SET status = 'redepose', redeposited_at = ?, updated_at = datetime('now','localtime') WHERE invoice_id = ? AND status = 'ouvert'`).run(date, id)
        }
        invoiceEvent(id, a.action === 'rejeter' ? 'rejet' : a.action === 'redeposer' ? 'redepot' : 'statut', message, {
          from: inv.status,
          to: def.to,
          details: a.action === 'rejeter' ? { reason_code: a.reason_code, reason_text: a.reason_text, date } : undefined
        })
        invoices.recompute(id, false)
        audit('statut', 'facture', id, `Facture ${inv.number} : ${def.label}`, { status: inv.status }, updates)
        done++
      }
    })
    return { done, skipped }
  },

  createCreditNote(input: CreditNoteInput) {
    const d = creditNoteSchema.parse(input)
    const target = getRaw(d.invoice_id)
    if (target.kind !== 'facture') throw new AppError('Un avoir ne peut porter que sur une facture.')
    const balance = target.amount_minor - target.paid_minor - target.credited_minor
    if (d.amount_minor > balance)
      throw new AppError(`L’avoir (${formatMoney(d.amount_minor, target.currency)}) dépasse le reste dû de la facture (${formatMoney(balance, target.currency)}).`)
    if (invoices.numberExists(d.number)) throw new AppError(`Le numéro « ${d.number} » existe déjà.`)
    return tx(() => {
      const r = db()
        .prepare(`INSERT INTO invoices (number, kind, corrects_invoice_id, company_id, convention_id, voucher_id, patient_name, patient_matricule,
          beneficiary_type, issue_date, due_date, amount_minor, currency, workflow_status, status, status_changed_at, notes, is_demo)
          SELECT ?, 'avoir', id, company_id, convention_id, voucher_id, patient_name, patient_matricule, beneficiary_type, ?, ?, ?, currency,
          'acceptee', 'avoir', ?, ?, is_demo FROM invoices WHERE id = ?`)
        .run(d.number, d.issue_date, d.issue_date, d.amount_minor, nowLocal(), d.notes, d.invoice_id)
      const id = Number(r.lastInsertRowid)
      invoiceEvent(id, 'creation', `Avoir créé sur la facture ${target.number} : ${d.notes}`)
      invoiceEvent(d.invoice_id, 'avoir', `Avoir n° ${d.number} de ${formatMoney(d.amount_minor, target.currency)} : ${d.notes}`)
      invoices.recompute(d.invoice_id)
      audit('creation', 'avoir', id, `Avoir ${d.number} sur facture ${target.number}`, undefined, d)
      return { id }
    })
  },

  /** Mise à la corbeille (refusée si des paiements ou avoirs actifs y sont rattachés). */
  remove(ids: number[]) {
    const ts = nowLocal()
    const blocked: { number: string; reason: string }[] = []
    let done = 0
    tx(() => {
      for (const id of ids) {
        const inv = getRaw(id)
        const allocs = (db()
          .prepare('SELECT count(*) AS n FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ? AND p.deleted_at IS NULL')
          .get(id) as { n: number }).n
        if (allocs > 0) {
          blocked.push({ number: inv.number, reason: 'des paiements y sont imputés (supprimez ou modifiez d’abord le paiement)' })
          continue
        }
        const credits = (db().prepare(`SELECT count(*) AS n FROM invoices WHERE corrects_invoice_id = ? AND kind = 'avoir' AND deleted_at IS NULL`).get(id) as { n: number }).n
        if (credits > 0) {
          blocked.push({ number: inv.number, reason: 'des avoirs y sont rattachés (supprimez d’abord les avoirs)' })
          continue
        }
        db().prepare('UPDATE invoices SET deleted_at = ? WHERE id = ?').run(ts, id)
        if (inv.kind === 'avoir' && inv.corrects_invoice_id) {
          invoiceEvent(inv.corrects_invoice_id, 'avoir', `Avoir n° ${inv.number} supprimé`)
          invoices.recompute(inv.corrects_invoice_id)
        }
        audit('corbeille', inv.kind, id, `${inv.kind === 'avoir' ? 'Avoir' : 'Facture'} ${inv.number} mis(e) à la corbeille`)
        done++
      }
    })
    return { done, blocked }
  },

  /** Recalcule les montants payés / crédités et le statut affiché. */
  recompute(id: number, logEvent = true): InvoiceStatus {
    const inv = db().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as ReturnType<typeof getRaw> | undefined
    if (!inv || inv.kind !== 'facture') return 'avoir'
    const paid = (db()
      .prepare('SELECT COALESCE(SUM(pa.amount_minor), 0) AS s FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ? AND p.deleted_at IS NULL')
      .get(id) as { s: number }).s
    const credited = (db()
      .prepare(`SELECT COALESCE(SUM(amount_minor), 0) AS s FROM invoices WHERE corrects_invoice_id = ? AND kind = 'avoir' AND deleted_at IS NULL`)
      .get(id) as { s: number }).s
    const status = deriveStatus(inv.workflow_status, inv.amount_minor, paid, credited)
    const changed = status !== inv.status
    db()
      .prepare(`UPDATE invoices SET paid_minor = ?, credited_minor = ?, status = ?, status_changed_at = CASE WHEN ? THEN ? ELSE status_changed_at END WHERE id = ?`)
      .run(paid, credited, status, changed ? 1 : 0, nowLocal(), id)
    if (changed && logEvent && (status === 'soldee' || status === 'partiellement_payee' || inv.status === 'soldee' || status === 'annulee')) {
      invoiceEvent(id, 'statut', `Statut : ${STATUS_INFO[inv.status].label} → ${STATUS_INFO[status].label}`, { from: inv.status, to: status })
    }
    return status
  },

  recomputeDueDatesForConvention(conventionId: number): number {
    const rows = db()
      .prepare(`SELECT id, company_id, convention_id, issue_date, deposit_date, due_date FROM invoices
        WHERE convention_id = ? AND deleted_at IS NULL AND kind = 'facture' AND due_date_manual = 0 AND status NOT IN ('soldee','annulee')`)
      .all(conventionId) as { id: number; company_id: number; convention_id: number; issue_date: string; deposit_date: string | null; due_date: string }[]
    let n = 0
    for (const r of rows) {
      const t = termsFor(r.company_id, r.convention_id)
      const due = computeDueDate({ issueDate: r.issue_date, depositDate: r.deposit_date, termsDays: t.days, termsStart: t.start })
      if (due !== r.due_date) {
        db().prepare('UPDATE invoices SET due_date = ? WHERE id = ?').run(due, r.id)
        invoiceEvent(r.id, 'modification', `Échéance recalculée suite à la modification de la convention : ${formatDate(r.due_date)} → ${formatDate(due)}`)
        n++
      }
    }
    return n
  },

  /** Factures pouvant recevoir un paiement d'une entreprise (et de ses sous-traitants). */
  openForPayment(companyId: number, currency: Currency, paymentId: number | null = null) {
    return db()
      .prepare(`SELECT i.id, i.number, i.issue_date, i.due_date, i.amount_minor, i.currency, i.status, i.patient_name, i.patient_matricule,
          c.name AS company_name,
          ${BALANCE} + COALESCE((SELECT amount_minor FROM payment_allocations WHERE payment_id = @pid AND invoice_id = i.id), 0) AS balance_minor
        FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.currency = @currency AND i.status <> 'annulee'
          AND (i.company_id = @company OR c.parent_company_id = @company)
          AND (${BALANCE} > 0 OR i.id IN (SELECT invoice_id FROM payment_allocations WHERE payment_id = @pid))
        ORDER BY i.due_date, i.issue_date, i.id`)
      .all({ company: companyId, currency, pid: paymentId ?? -1 }) as {
      id: number
      number: string
      issue_date: string
      due_date: string
      amount_minor: number
      currency: Currency
      status: InvoiceStatus
      patient_name: string | null
      patient_matricule: string | null
      company_name: string
      balance_minor: number
    }[]
  },

  /** Jours de retard d'une échéance par rapport à aujourd'hui. */
  daysLate(dueDate: string): number {
    return Math.max(0, diffDays(todayISO(), dueDate))
  }
}
