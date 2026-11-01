// Bons de prise en charge : plafond, validité, consommation, alertes d'expiration.
import { db } from '../db/connection'
import { audit, nowLocal } from '../db/util'
import { likeParam } from '../db/sql'
import { AppError } from '../errors'
import { voucherSchema, type VoucherInput } from '@shared/schemas'
import { VOUCHER_WARN_DAYS, type BeneficiaryType, type Currency, type VoucherState } from '@shared/constants'
import { addDays, todayISO } from '@shared/dates'
import { voucherState } from '@shared/domain/followup'

export interface VoucherRow {
  id: number
  company_id: number
  company_name: string
  convention_id: number | null
  convention_reference: string | null
  number: string
  patient_name: string | null
  patient_matricule: string | null
  beneficiary_type: BeneficiaryType
  subcontractor_name: string | null
  po_number: string | null
  issue_date: string | null
  valid_until: string | null
  ceiling_minor: number | null
  currency: Currency
  status: 'actif' | 'annule'
  notes: string | null
  used_minor: number
  invoice_count: number
  state: VoucherState
  is_demo: number
}

const SELECT = `SELECT v.*, c.name AS company_name, cv.reference AS convention_reference,
  COALESCE((SELECT SUM(i.amount_minor - i.credited_minor) FROM invoices i WHERE i.voucher_id = v.id AND i.deleted_at IS NULL
    AND i.kind = 'facture' AND i.status <> 'annulee'), 0) AS used_minor,
  (SELECT count(*) FROM invoices i WHERE i.voucher_id = v.id AND i.deleted_at IS NULL AND i.kind = 'facture') AS invoice_count
  FROM coverage_vouchers v JOIN companies c ON c.id = v.company_id LEFT JOIN conventions cv ON cv.id = v.convention_id`

function withState(rows: Omit<VoucherRow, 'state'>[]): VoucherRow[] {
  const today = todayISO()
  return rows.map((r) => ({
    ...r,
    state: voucherState({ status: r.status, validUntil: r.valid_until, ceiling: r.ceiling_minor, used: r.used_minor, today, warnDays: VOUCHER_WARN_DAYS })
  }))
}

function getRow(id: number): VoucherRow {
  const r = db().prepare(`${SELECT} WHERE v.id = ? AND v.deleted_at IS NULL`).all(id) as Omit<VoucherRow, 'state'>[]
  if (!r.length) throw new AppError('Bon de prise en charge introuvable.')
  return withState(r)[0]
}

export const vouchers = {
  list(q: { search?: string; company_id?: number | null; state?: VoucherState | null; page?: number; page_size?: number } = {}) {
    const w = ['v.deleted_at IS NULL']
    const p: Record<string, unknown> = {}
    if (q.search?.trim()) {
      w.push(`(v.number LIKE @s ESCAPE '\\' OR v.patient_name LIKE @s ESCAPE '\\' OR v.patient_matricule LIKE @s ESCAPE '\\' OR v.po_number LIKE @s ESCAPE '\\' OR c.name LIKE @s ESCAPE '\\')`)
      p.s = likeParam(q.search)
    }
    if (q.company_id) {
      w.push('v.company_id = @company')
      p.company = q.company_id
    }
    // L'état dépend de la date et de la consommation : filtré après calcul (quelques milliers de bons au plus)
    const all = withState(db().prepare(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY COALESCE(v.issue_date, v.created_at) DESC, v.id DESC`).all(p) as Omit<VoucherRow, 'state'>[])
    const filtered = q.state ? all.filter((r) => r.state === q.state) : all
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const counts = all.reduce<Record<string, number>>((acc, r) => ((acc[r.state] = (acc[r.state] ?? 0) + 1), acc), {})
    return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, page_size: pageSize, counts }
  },

  get(id: number) {
    const voucher = getRow(id)
    const invoices = db()
      .prepare(`SELECT id, number, issue_date, amount_minor, currency, status FROM invoices WHERE voucher_id = ? AND deleted_at IS NULL ORDER BY issue_date`)
      .all(id) as { id: number; number: string; issue_date: string; amount_minor: number; currency: Currency; status: string }[]
    return { voucher, invoices }
  },

  /** Bons d'une entreprise, pour l'autocomplétion du formulaire de facture. */
  forCompany(companyId: number): VoucherRow[] {
    return withState(db().prepare(`${SELECT} WHERE v.company_id = ? AND v.deleted_at IS NULL AND v.status = 'actif' ORDER BY v.id DESC LIMIT 500`).all(companyId) as Omit<VoucherRow, 'state'>[])
  },

  findByNumber(companyId: number, number: string): VoucherRow | null {
    const r = db().prepare(`${SELECT} WHERE v.company_id = ? AND v.number = ? COLLATE NOCASE AND v.deleted_at IS NULL`).all(companyId, number.trim()) as Omit<VoucherRow, 'state'>[]
    return r.length ? withState(r)[0] : null
  },

  /** Bons valides qui expirent dans les `days` prochains jours. */
  expiring(days = VOUCHER_WARN_DAYS): VoucherRow[] {
    const today = todayISO()
    return withState(
      db()
        .prepare(`${SELECT} WHERE v.deleted_at IS NULL AND v.status = 'actif' AND v.valid_until BETWEEN ? AND ? ORDER BY v.valid_until`)
        .all(today, addDays(today, days)) as Omit<VoucherRow, 'state'>[]
    ).filter((v) => v.state !== 'consomme')
  },

  save(id: number | null, input: VoucherInput) {
    const d = voucherSchema.parse(input)
    if (!db().prepare('SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL').get(d.company_id)) throw new AppError('Entreprise introuvable.')
    const dup = db()
      .prepare('SELECT id FROM coverage_vouchers WHERE company_id = ? AND number = ? COLLATE NOCASE AND deleted_at IS NULL AND id IS NOT ?')
      .get(d.company_id, d.number, id)
    if (dup) throw new AppError(`Le bon n° ${d.number} existe déjà pour cette entreprise.`)
    if (id) {
      const before = getRow(id)
      if (d.ceiling_minor !== null && d.ceiling_minor < before.used_minor)
        throw new AppError('Le plafond ne peut pas être inférieur au montant déjà facturé sur ce bon.')
      if (before.invoice_count > 0 && d.company_id !== before.company_id) throw new AppError('Ce bon est déjà utilisé par des factures : l’entreprise ne peut plus être changée.')
      db()
        .prepare(`UPDATE coverage_vouchers SET company_id=@company_id, convention_id=@convention_id, number=@number, patient_name=@patient_name,
          patient_matricule=@patient_matricule, beneficiary_type=@beneficiary_type, subcontractor_name=@subcontractor_name, po_number=@po_number,
          issue_date=@issue_date, valid_until=@valid_until, ceiling_minor=@ceiling_minor, currency=@currency, status=@status, notes=@notes,
          updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({ ...d, id })
      audit('modification', 'bon', id, `Bon n° ${d.number} modifié`, before, d)
      return { id }
    }
    const r = db()
      .prepare(`INSERT INTO coverage_vouchers (company_id, convention_id, number, patient_name, patient_matricule, beneficiary_type, subcontractor_name,
        po_number, issue_date, valid_until, ceiling_minor, currency, status, notes) VALUES (@company_id, @convention_id, @number, @patient_name,
        @patient_matricule, @beneficiary_type, @subcontractor_name, @po_number, @issue_date, @valid_until, @ceiling_minor, @currency, @status, @notes)`)
      .run(d)
    audit('creation', 'bon', Number(r.lastInsertRowid), `Bon n° ${d.number} créé`, undefined, d)
    return { id: Number(r.lastInsertRowid) }
  },

  remove(id: number) {
    const v = getRow(id)
    if (v.invoice_count > 0) throw new AppError(`Ce bon est utilisé par ${v.invoice_count} facture(s) : passez-le plutôt au statut « annulé ».`)
    db().prepare('UPDATE coverage_vouchers SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'bon', id, `Bon n° ${v.number} mis à la corbeille`)
    return true
  }
}
