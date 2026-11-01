// Contentieux : dossiers confiés à un avocat ou un huissier (étapes, frais, échéances, documents),
// et alerte de prescription sur les créances anciennes.
import { db } from '../db/connection'
import { audit, invoiceEvent, nowLocal, tx } from '../db/util'
import { BALANCE, RECEIVABLE } from '../db/sql'
import { AppError } from '../errors'
import { litigationCostSchema, litigationSchema, litigationStepSchema, type LitigationInput } from '@shared/schemas'
import { LITIGATION_STATUS, type Currency, type LitigationHandler, type LitigationProcedure, type LitigationStatus } from '@shared/constants'
import { addDays, todayISO } from '@shared/dates'
import { prescription } from '@shared/domain/followup'
import { invoices } from './invoices'
import { getSettings } from './settings'
import type { z } from 'zod'

export interface LitigationRow {
  id: number
  company_id: number
  company_name: string
  reference: string
  opened_at: string
  handler_type: LitigationHandler
  handler_name: string | null
  handler_contact: string | null
  procedure: LitigationProcedure
  status: LitigationStatus
  closed_at: string | null
  outcome_notes: string | null
  notes: string | null
  invoice_count: number
  next_step: string | null
  next_step_due: string | null
  is_demo: number
}

const SELECT = `SELECT l.*, c.name AS company_name,
  (SELECT count(*) FROM litigation_invoices li WHERE li.case_id = l.id) AS invoice_count,
  (SELECT title FROM litigation_steps s WHERE s.case_id = l.id AND s.done_at IS NULL ORDER BY COALESCE(s.due_date, '9999') LIMIT 1) AS next_step,
  (SELECT due_date FROM litigation_steps s WHERE s.case_id = l.id AND s.done_at IS NULL ORDER BY COALESCE(s.due_date, '9999') LIMIT 1) AS next_step_due
  FROM litigation_cases l JOIN companies c ON c.id = l.company_id`

const CLOSED: LitigationStatus[] = ['clos_gagne', 'transige', 'clos_perdu']

function getRow(id: number): LitigationRow {
  const r = db().prepare(`${SELECT} WHERE l.id = ? AND l.deleted_at IS NULL`).get(id) as LitigationRow | undefined
  if (!r) throw new AppError('Dossier de contentieux introuvable.')
  return r
}

function linkInvoices(caseId: number, ids: number[], date: string, ref: string): void {
  const ins = db().prepare('INSERT OR IGNORE INTO litigation_invoices (case_id, invoice_id) VALUES (?,?)')
  for (const i of ids) ins.run(caseId, i)
  // Les factures éligibles passent au statut « contentieux » (relances automatiques suspendues)
  const eligible = (db()
    .prepare(`SELECT id FROM invoices WHERE workflow_status IN ('envoyee','acceptee','rejetee') AND id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: number }[]).map((x) => x.id)
  if (eligible.length) invoices.applyAction({ ids: eligible, action: 'contentieux', date, reason_text: `Dossier ${ref}` })
}

export const litigation = {
  list(q: { status?: LitigationStatus | 'ouverts' | null; company_id?: number | null } = {}) {
    const w = ['l.deleted_at IS NULL']
    const p: Record<string, unknown> = {}
    if (q.status === 'ouverts') w.push(`l.status IN ('ouvert','suspendu')`)
    else if (q.status) {
      w.push('l.status = @status')
      p.status = q.status
    }
    if (q.company_id) {
      w.push('l.company_id = @company')
      p.company = q.company_id
    }
    const rows = db().prepare(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY l.status IN ('ouvert','suspendu') DESC, l.opened_at DESC`).all(p) as LitigationRow[]
    return rows.map((r) => ({ ...r, ...litigation.amounts(r.id) }))
  },

  amounts(caseId: number) {
    const due = db()
      .prepare(`SELECT i.currency, SUM(${BALANCE}) AS balance, SUM(i.paid_minor) AS paid FROM litigation_invoices li JOIN invoices i ON i.id = li.invoice_id
        WHERE li.case_id = ? AND i.deleted_at IS NULL GROUP BY i.currency`)
      .all(caseId) as { currency: Currency; balance: number; paid: number }[]
    const costs = db().prepare('SELECT currency, SUM(amount_minor) AS total FROM litigation_costs WHERE case_id = ? GROUP BY currency').all(caseId) as { currency: Currency; total: number }[]
    return { due, cost_totals: costs }
  },

  get(id: number) {
    const c = getRow(id)
    const invs = db()
      .prepare(`SELECT i.id, i.number, i.issue_date, i.due_date, i.amount_minor, i.currency, i.status, ${BALANCE} AS balance_minor
        FROM litigation_invoices li JOIN invoices i ON i.id = li.invoice_id WHERE li.case_id = ? AND i.deleted_at IS NULL ORDER BY i.due_date`)
      .all(id) as { id: number; number: string; issue_date: string; due_date: string; amount_minor: number; currency: Currency; status: string; balance_minor: number }[]
    const steps = db().prepare(`SELECT * FROM litigation_steps WHERE case_id = ? ORDER BY done_at IS NOT NULL, COALESCE(due_date, '9999'), id`).all(id) as {
      id: number
      title: string
      due_date: string | null
      done_at: string | null
      notes: string | null
    }[]
    const costs = db().prepare('SELECT * FROM litigation_costs WHERE case_id = ? ORDER BY date').all(id) as {
      id: number
      date: string
      label: string
      amount_minor: number
      currency: Currency
    }[]
    return { case: c, invoices: invs, steps, costs, ...litigation.amounts(id) }
  },

  create(input: LitigationInput) {
    const d = litigationSchema.parse(input)
    if (!d.invoice_ids.length) throw new AppError('Choisissez au moins une facture à transmettre.')
    return tx(() => {
      const r = db()
        .prepare(`INSERT INTO litigation_cases (company_id, reference, opened_at, handler_type, handler_name, handler_contact, procedure, status, notes)
          VALUES (@company_id, @reference, @opened_at, @handler_type, @handler_name, @handler_contact, @procedure, 'ouvert', @notes)`)
        .run(d)
      const id = Number(r.lastInsertRowid)
      linkInvoices(id, d.invoice_ids, d.opened_at, d.reference)
      db().prepare('INSERT INTO litigation_steps (case_id, title, due_date) VALUES (?,?,?)').run(id, 'Transmettre le dossier complet (factures, bons, relances, mise en demeure)', addDays(d.opened_at, 7))
      audit('creation', 'contentieux', id, `Dossier de contentieux ${d.reference} ouvert (${d.invoice_ids.length} facture(s))`, undefined, d)
      return { id }
    })
  },

  update(id: number, input: LitigationInput) {
    const d = litigationSchema.parse(input)
    const before = getRow(id)
    return tx(() => {
      const closing = CLOSED.includes(d.status) && !CLOSED.includes(before.status)
      db()
        .prepare(`UPDATE litigation_cases SET reference=@reference, opened_at=@opened_at, handler_type=@handler_type, handler_name=@handler_name,
          handler_contact=@handler_contact, procedure=@procedure, status=@status, outcome_notes=@outcome_notes, notes=@notes,
          closed_at = CASE WHEN @closing THEN @today ELSE closed_at END, updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({ ...d, id, closing: closing ? 1 : 0, today: todayISO() })
      if (d.invoice_ids.length) linkInvoices(id, d.invoice_ids, todayISO(), d.reference)
      // Clôture recouvrée / transigée : les factures restant dues sortent du contentieux. Irrécouvrable : elles y restent (passer un avoir).
      if (closing && d.status !== 'clos_perdu') {
        const ids = (db()
          .prepare(`SELECT i.id FROM litigation_invoices li JOIN invoices i ON i.id = li.invoice_id WHERE li.case_id = ? AND i.workflow_status = 'contentieux'`)
          .all(id) as { id: number }[]).map((x) => x.id)
        if (ids.length) invoices.applyAction({ ids, action: 'sortir_contentieux', reason_text: `Dossier ${d.reference} : ${LITIGATION_STATUS[d.status].label}` })
      }
      audit('modification', 'contentieux', id, `Dossier ${d.reference} modifié (${LITIGATION_STATUS[d.status].label})`, before, d)
      return { id }
    })
  },

  remove(id: number) {
    const c = getRow(id)
    db().prepare('UPDATE litigation_cases SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'contentieux', id, `Dossier ${c.reference} mis à la corbeille`)
    return true
  },

  removeInvoice(caseId: number, invoiceId: number) {
    db().prepare('DELETE FROM litigation_invoices WHERE case_id = ? AND invoice_id = ?').run(caseId, invoiceId)
    invoiceEvent(invoiceId, 'statut', 'Facture retirée du dossier de contentieux')
    return true
  },

  addStep(caseId: number, input: z.input<typeof litigationStepSchema>) {
    getRow(caseId)
    const d = litigationStepSchema.parse(input)
    db().prepare('INSERT INTO litigation_steps (case_id, title, due_date, notes) VALUES (?,?,?,?)').run(caseId, d.title, d.due_date, d.notes)
    return true
  },

  toggleStep(stepId: number) {
    db().prepare(`UPDATE litigation_steps SET done_at = CASE WHEN done_at IS NULL THEN ? ELSE NULL END WHERE id = ?`).run(todayISO(), stepId)
    return true
  },

  removeStep(stepId: number) {
    db().prepare('DELETE FROM litigation_steps WHERE id = ?').run(stepId)
    return true
  },

  addCost(caseId: number, input: z.input<typeof litigationCostSchema>) {
    getRow(caseId)
    const d = litigationCostSchema.parse(input)
    db().prepare('INSERT INTO litigation_costs (case_id, date, label, amount_minor, currency) VALUES (?,?,?,?,?)').run(caseId, d.date, d.label, d.amount_minor, d.currency)
    audit('creation', 'contentieux', caseId, `Frais de contentieux ajoutés : ${d.label}`)
    return true
  },

  removeCost(costId: number) {
    db().prepare('DELETE FROM litigation_costs WHERE id = ?').run(costId)
    return true
  },

  /** Étapes à faire dans les `days` prochains jours (ou en retard), dossiers ouverts. */
  upcomingSteps(days = 7) {
    return db()
      .prepare(`SELECT s.id, s.title, s.due_date, l.id AS case_id, l.reference, c.name AS company_name FROM litigation_steps s
        JOIN litigation_cases l ON l.id = s.case_id JOIN companies c ON c.id = l.company_id
        WHERE s.done_at IS NULL AND l.deleted_at IS NULL AND l.status IN ('ouvert','suspendu') AND s.due_date IS NOT NULL AND s.due_date <= ?
        ORDER BY s.due_date`)
      .all(addDays(todayISO(), days)) as { id: number; title: string; due_date: string; case_id: number; reference: string; company_name: string }[]
  },

  /** Créances qui approchent de la prescription (alerte à 6 mois) ou sont prescrites. */
  prescriptions() {
    const years = getSettings().legal.prescription_years
    const today = todayISO()
    // Échéance antérieure à (aujourd'hui + 6 mois − N ans)
    const limit = addDays(today, 183 - Math.round(years * 365.25))
    const rows = db()
      .prepare(`SELECT i.id, i.number, i.due_date, i.currency, ${BALANCE} AS balance_minor, i.status, c.id AS company_id, c.name AS company_name
        FROM invoices i JOIN companies c ON c.id = i.company_id WHERE ${RECEIVABLE} AND ${BALANCE} > 0 AND i.due_date <= ? ORDER BY i.due_date`)
      .all(limit) as { id: number; number: string; due_date: string; currency: Currency; balance_minor: number; status: string; company_id: number; company_name: string }[]
    return rows
      .map((r) => ({ ...r, ...prescription(r.due_date, years, today) }))
      .filter((r) => r.level !== null)
  }
}
