// Recherche globale (Ctrl+K) : factures, patients, bons, entreprises, paiements.
import { db } from '../db/connection'
import { BALANCE, likeParam } from '../db/sql'
import type { Currency, InvoiceStatus } from '@shared/constants'

export const search = {
  global(q: string) {
    const term = q.trim()
    if (term.length < 2) return { invoices: [], companies: [], payments: [], vouchers: [] }
    const s = likeParam(term)
    const invoices = db()
      .prepare(`SELECT i.id, i.number, i.kind, i.patient_name, i.patient_matricule, i.amount_minor, i.currency, i.status, ${BALANCE} AS balance_minor,
          c.name AS company_name, v.number AS voucher_number
        FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id
        WHERE i.deleted_at IS NULL AND (i.number LIKE @s ESCAPE '\\' OR i.patient_name LIKE @s ESCAPE '\\' OR i.patient_matricule LIKE @s ESCAPE '\\'
          OR i.po_number LIKE @s ESCAPE '\\' OR v.number LIKE @s ESCAPE '\\')
        ORDER BY (i.number = @exact COLLATE NOCASE) DESC, i.issue_date DESC LIMIT 10`)
      .all({ s, exact: term }) as {
      id: number
      number: string
      kind: string
      patient_name: string | null
      patient_matricule: string | null
      amount_minor: number
      currency: Currency
      status: InvoiceStatus
      balance_minor: number
      company_name: string
      voucher_number: string | null
    }[]
    const companies = db()
      .prepare(`SELECT id, name, type FROM companies WHERE deleted_at IS NULL AND (name LIKE @s ESCAPE '\\' OR short_name LIKE @s ESCAPE '\\')
        ORDER BY name LIMIT 6`)
      .all({ s }) as { id: number; name: string; type: string }[]
    const payments = db()
      .prepare(`SELECT p.id, p.reference, p.received_at, p.amount_minor, p.currency, c.name AS company_name FROM payments p
        JOIN companies c ON c.id = p.company_id WHERE p.deleted_at IS NULL AND p.reference LIKE @s ESCAPE '\\' ORDER BY p.received_at DESC LIMIT 5`)
      .all({ s }) as { id: number; reference: string; received_at: string; amount_minor: number; currency: Currency; company_name: string }[]
    const vouchers = db()
      .prepare(`SELECT v.id, v.number, v.patient_name, v.patient_matricule, c.name AS company_name FROM coverage_vouchers v
        JOIN companies c ON c.id = v.company_id WHERE v.deleted_at IS NULL AND (v.number LIKE @s ESCAPE '\\' OR v.patient_name LIKE @s ESCAPE '\\'
        OR v.patient_matricule LIKE @s ESCAPE '\\') ORDER BY v.id DESC LIMIT 5`)
      .all({ s }) as { id: number; number: string; patient_name: string | null; patient_matricule: string | null; company_name: string }[]
    return { invoices, companies, payments, vouchers }
  }
}
