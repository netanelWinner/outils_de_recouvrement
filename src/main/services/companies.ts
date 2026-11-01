// Entreprises clientes, interlocuteurs par rôle et conventions.
import { db } from '../db/connection'
import { audit, bool, nowLocal, tx } from '../db/util'
import { BALANCE, RECEIVABLE, balanceXafSql, likeParam } from '../db/sql'
import { AppError } from '../errors'
import { companySchema, contactSchema, conventionSchema, type CompanyInput, type ContactInput, type ConventionInput } from '@shared/schemas'
import { todayISO } from '@shared/dates'
import type { CompanyType, ContactRole, Currency, PenaltyType, TermsStart } from '@shared/constants'
import { invoices } from './invoices'

export interface CompanyRow {
  id: number
  name: string
  short_name: string | null
  type: CompanyType
  parent_company_id: number | null
  parent_name: string | null
  niu: string | null
  rccm: string | null
  address: string | null
  city: string | null
  phone: string | null
  email: string | null
  default_currency: Currency
  payment_terms_days: number
  billing_notes: string | null
  notes: string | null
  reminder_scenario_id: number | null
  is_demo: number
  open_count: number
  outstanding_xaf: number
  overdue_xaf: number
  created_at: string
}

export interface ContactRow {
  id: number
  company_id: number
  role: ContactRole
  full_name: string
  job_title: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  third_party_name: string | null
  is_primary: number
  notes: string | null
}

export interface ConventionRow {
  id: number
  company_id: number
  reference: string
  title: string | null
  start_date: string
  end_date: string | null
  payment_terms_days: number
  terms_start: TermsStart
  required_documents: string[]
  billing_format_notes: string | null
  penalty_type: PenaltyType
  penalty_rate: number
  penalty_fixed_minor: number
  penalty_grace_days: number
  currency: Currency
  status: 'active' | 'expiree' | 'suspendue'
  invoice_count: number
}

function statsJoin(): string {
  const x = balanceXafSql()
  return `LEFT JOIN (
    SELECT i.company_id, count(*) AS n, SUM(${x}) AS outstanding,
           SUM(CASE WHEN i.due_date < @today THEN ${x} ELSE 0 END) AS overdue
    FROM invoices i WHERE ${RECEIVABLE} AND ${BALANCE} > 0 GROUP BY i.company_id
  ) s ON s.company_id = c.id`
}

const COMPANY_SELECT = `SELECT c.*, p.name AS parent_name,
  COALESCE(s.n, 0) AS open_count, COALESCE(s.outstanding, 0) AS outstanding_xaf, COALESCE(s.overdue, 0) AS overdue_xaf`

function parseConvention(r: Record<string, unknown>): ConventionRow {
  return { ...(r as unknown as ConventionRow), required_documents: JSON.parse((r.required_documents as string) || '[]') }
}

function getCompanyRow(id: number): CompanyRow {
  const row = db()
    .prepare(`${COMPANY_SELECT} FROM companies c LEFT JOIN companies p ON p.id = c.parent_company_id ${statsJoin()} WHERE c.id = @id AND c.deleted_at IS NULL`)
    .get({ id, today: todayISO() }) as CompanyRow | undefined
  if (!row) throw new AppError('Entreprise introuvable.')
  return row
}

function checkParent(id: number | null, parentId: number | null): void {
  if (!parentId) return
  if (id && parentId === id) throw new AppError('Une entreprise ne peut pas être son propre donneur d’ordre.')
  const p = db().prepare('SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL').get(parentId)
  if (!p) throw new AppError('Le donneur d’ordre choisi est introuvable.')
}

function nameTaken(name: string, exceptId: number | null): boolean {
  return !!db()
    .prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?')
    .get(name, exceptId)
}

export const companies = {
  list(q: { search?: string; type?: CompanyType | null; sort?: 'name' | 'outstanding' | 'overdue' } = {}): CompanyRow[] {
    const where = ['c.deleted_at IS NULL']
    const params: Record<string, unknown> = { today: todayISO() }
    if (q.search?.trim()) {
      where.push(`(c.name LIKE @s ESCAPE '\\' OR c.short_name LIKE @s ESCAPE '\\' OR c.niu LIKE @s ESCAPE '\\')`)
      params.s = likeParam(q.search)
    }
    if (q.type) {
      where.push('c.type = @type')
      params.type = q.type
    }
    const order = q.sort === 'outstanding' ? 'outstanding_xaf DESC' : q.sort === 'overdue' ? 'overdue_xaf DESC' : 'c.name COLLATE NOCASE'
    return db()
      .prepare(`${COMPANY_SELECT} FROM companies c LEFT JOIN companies p ON p.id = c.parent_company_id ${statsJoin()}
        WHERE ${where.join(' AND ')} ORDER BY ${order}`)
      .all(params) as CompanyRow[]
  },

  /** Liste courte pour les menus déroulants. */
  options(): { id: number; name: string; default_currency: Currency; payment_terms_days: number; type: CompanyType }[] {
    return db()
      .prepare('SELECT id, name, default_currency, payment_terms_days, type FROM companies WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE')
      .all() as never
  },

  get(id: number) {
    const company = getCompanyRow(id)
    const contacts = db()
      .prepare('SELECT * FROM contacts WHERE company_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, role, full_name')
      .all(id) as ContactRow[]
    const conventions = (
      db()
        .prepare(`SELECT v.*, (SELECT count(*) FROM invoices i WHERE i.convention_id = v.id AND i.deleted_at IS NULL) AS invoice_count
          FROM conventions v WHERE v.company_id = ? AND v.deleted_at IS NULL ORDER BY v.start_date DESC`)
        .all(id) as Record<string, unknown>[]
    ).map(parseConvention)
    const subcontractors = db()
      .prepare('SELECT id, name FROM companies WHERE parent_company_id = ? AND deleted_at IS NULL ORDER BY name')
      .all(id) as { id: number; name: string }[]
    const byCurrency = db()
      .prepare(`SELECT i.currency, SUM(${BALANCE}) AS balance, count(*) AS n FROM invoices i
        WHERE i.company_id = ? AND ${RECEIVABLE} AND ${BALANCE} > 0 GROUP BY i.currency`)
      .all(id) as { currency: Currency; balance: number; n: number }[]
    const paid12 = db()
      .prepare(`SELECT currency, SUM(amount_minor) AS total FROM payments WHERE company_id = ? AND deleted_at IS NULL
        AND received_at >= date('now','-12 months') GROUP BY currency`)
      .all(id) as { currency: Currency; total: number }[]
    return { company, contacts, conventions, subcontractors, byCurrency, paid12 }
  },

  create(input: CompanyInput) {
    const d = companySchema.parse(input)
    if (nameTaken(d.name, null)) throw new AppError(`Une entreprise nommée « ${d.name} » existe déjà.`)
    checkParent(null, d.parent_company_id)
    const r = db()
      .prepare(`INSERT INTO companies (name, short_name, type, parent_company_id, niu, rccm, address, city, phone, email,
        default_currency, payment_terms_days, billing_notes, notes, reminder_scenario_id)
        VALUES (@name, @short_name, @type, @parent_company_id, @niu, @rccm, @address, @city, @phone, @email,
        @default_currency, @payment_terms_days, @billing_notes, @notes, @reminder_scenario_id)`)
      .run(d)
    const id = Number(r.lastInsertRowid)
    audit('creation', 'entreprise', id, `Entreprise « ${d.name} » créée`, undefined, d)
    return { id }
  },

  update(id: number, input: CompanyInput) {
    const d = companySchema.parse(input)
    const before = getCompanyRow(id)
    if (nameTaken(d.name, id)) throw new AppError(`Une entreprise nommée « ${d.name} » existe déjà.`)
    checkParent(id, d.parent_company_id)
    db()
      .prepare(`UPDATE companies SET name=@name, short_name=@short_name, type=@type, parent_company_id=@parent_company_id,
        niu=@niu, rccm=@rccm, address=@address, city=@city, phone=@phone, email=@email, default_currency=@default_currency,
        payment_terms_days=@payment_terms_days, billing_notes=@billing_notes, notes=@notes,
        reminder_scenario_id=@reminder_scenario_id, updated_at=datetime('now','localtime') WHERE id=@id`)
      .run({ ...d, id })
    audit('modification', 'entreprise', id, `Entreprise « ${d.name} » modifiée`, before, d)
    return true
  },

  /** Mise à la corbeille avec ses contacts et conventions (même horodatage pour la restauration). */
  remove(id: number) {
    const c = getCompanyRow(id)
    const inv = db().prepare('SELECT count(*) AS n FROM invoices WHERE company_id = ? AND deleted_at IS NULL').get(id) as { n: number }
    const pay = db().prepare('SELECT count(*) AS n FROM payments WHERE company_id = ? AND deleted_at IS NULL').get(id) as { n: number }
    if (inv.n > 0 || pay.n > 0)
      throw new AppError(
        `Impossible de supprimer « ${c.name} » : elle a encore ${inv.n} facture(s) et ${pay.n} paiement(s). Supprimez-les d’abord.`
      )
    const ts = nowLocal()
    tx(() => {
      db().prepare('UPDATE companies SET deleted_at = ? WHERE id = ?').run(ts, id)
      db().prepare('UPDATE contacts SET deleted_at = ? WHERE company_id = ? AND deleted_at IS NULL').run(ts, id)
      db().prepare('UPDATE conventions SET deleted_at = ? WHERE company_id = ? AND deleted_at IS NULL').run(ts, id)
      audit('corbeille', 'entreprise', id, `Entreprise « ${c.name} » mise à la corbeille`)
    })
    return true
  },

  // ---- Contacts ----
  saveContact(id: number | null, input: ContactInput) {
    const d = contactSchema.parse(input)
    getCompanyRow(d.company_id)
    return tx(() => {
      if (d.is_primary) {
        db().prepare('UPDATE contacts SET is_primary = 0 WHERE company_id = ? AND role = ? AND id IS NOT ?').run(d.company_id, d.role, id)
      }
      const p = { ...d, is_primary: bool(d.is_primary) }
      if (id) {
        db()
          .prepare(`UPDATE contacts SET role=@role, full_name=@full_name, job_title=@job_title, email=@email, phone=@phone,
            whatsapp=@whatsapp, third_party_name=@third_party_name, is_primary=@is_primary, notes=@notes,
            updated_at=datetime('now','localtime') WHERE id=@id AND deleted_at IS NULL`)
          .run({ ...p, id })
        audit('modification', 'contact', id, `Contact « ${d.full_name} » modifié`, undefined, d)
        return { id }
      }
      const r = db()
        .prepare(`INSERT INTO contacts (company_id, role, full_name, job_title, email, phone, whatsapp, third_party_name, is_primary, notes)
          VALUES (@company_id, @role, @full_name, @job_title, @email, @phone, @whatsapp, @third_party_name, @is_primary, @notes)`)
        .run(p)
      const newId = Number(r.lastInsertRowid)
      audit('creation', 'contact', newId, `Contact « ${d.full_name} » ajouté`, undefined, d)
      return { id: newId }
    })
  },

  removeContact(id: number) {
    const c = db().prepare('SELECT full_name FROM contacts WHERE id = ? AND deleted_at IS NULL').get(id) as { full_name: string } | undefined
    if (!c) throw new AppError('Contact introuvable.')
    db().prepare('UPDATE contacts SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'contact', id, `Contact « ${c.full_name} » mis à la corbeille`)
    return true
  },

  // ---- Conventions ----
  conventionOptions(companyId: number): ConventionRow[] {
    return (
      db()
        .prepare(`SELECT *, 0 AS invoice_count FROM conventions WHERE company_id = ? AND deleted_at IS NULL ORDER BY status = 'active' DESC, start_date DESC`)
        .all(companyId) as Record<string, unknown>[]
    ).map(parseConvention)
  },

  /** Enregistre une convention. Si le délai change, les échéances des factures liées sont recalculées. */
  saveConvention(id: number | null, input: ConventionInput) {
    const d = conventionSchema.parse(input)
    getCompanyRow(d.company_id)
    const p = { ...d, required_documents: JSON.stringify(d.required_documents) }
    return tx(() => {
      if (id) {
        const before = db().prepare('SELECT * FROM conventions WHERE id = ? AND deleted_at IS NULL').get(id) as Record<string, unknown> | undefined
        if (!before) throw new AppError('Convention introuvable.')
        db()
          .prepare(`UPDATE conventions SET reference=@reference, title=@title, start_date=@start_date, end_date=@end_date,
            payment_terms_days=@payment_terms_days, terms_start=@terms_start, required_documents=@required_documents,
            billing_format_notes=@billing_format_notes, penalty_type=@penalty_type, penalty_rate=@penalty_rate,
            penalty_fixed_minor=@penalty_fixed_minor, penalty_grace_days=@penalty_grace_days, currency=@currency,
            status=@status, updated_at=datetime('now','localtime') WHERE id=@id`)
          .run({ ...p, id })
        let recomputed = 0
        if (before.payment_terms_days !== d.payment_terms_days || before.terms_start !== d.terms_start) {
          recomputed = invoices.recomputeDueDatesForConvention(id)
        }
        audit('modification', 'convention', id, `Convention « ${d.reference} » modifiée`, before, d)
        return { id, recomputed }
      }
      const r = db()
        .prepare(`INSERT INTO conventions (company_id, reference, title, start_date, end_date, payment_terms_days, terms_start,
          required_documents, billing_format_notes, penalty_type, penalty_rate, penalty_fixed_minor, penalty_grace_days, currency, status)
          VALUES (@company_id, @reference, @title, @start_date, @end_date, @payment_terms_days, @terms_start, @required_documents,
          @billing_format_notes, @penalty_type, @penalty_rate, @penalty_fixed_minor, @penalty_grace_days, @currency, @status)`)
        .run(p)
      const newId = Number(r.lastInsertRowid)
      audit('creation', 'convention', newId, `Convention « ${d.reference} » créée`, undefined, d)
      return { id: newId, recomputed: 0 }
    })
  },

  removeConvention(id: number) {
    const c = db().prepare('SELECT reference FROM conventions WHERE id = ? AND deleted_at IS NULL').get(id) as { reference: string } | undefined
    if (!c) throw new AppError('Convention introuvable.')
    const n = (db().prepare('SELECT count(*) AS n FROM invoices WHERE convention_id = ? AND deleted_at IS NULL').get(id) as { n: number }).n
    if (n > 0) throw new AppError(`Cette convention est utilisée par ${n} facture(s) : passez-la plutôt au statut « expirée ».`)
    db().prepare('UPDATE conventions SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'convention', id, `Convention « ${c.reference} » mise à la corbeille`)
    return true
  }
}
