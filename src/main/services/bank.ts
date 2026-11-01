// Rapprochement bancaire : import du relevé (Excel/CSV), suggestions automatiques, validation en un clic.
import { createHash, randomUUID } from 'node:crypto'
import { db } from '../db/connection'
import { audit, tx } from '../db/util'
import { BALANCE } from '../db/sql'
import { AppError } from '../errors'
import type { Currency, BankLineStatus, PaymentMethod } from '@shared/constants'
import { formatMoney, parseAmount } from '@shared/money'
import { parseDateFlexible } from '@shared/dates'
import { guessMapping } from '@shared/importFields'
import { BANK_FIELDS, suggestMatches, type BankFieldKey, type MatchInvoice, type MatchPayment } from '@shared/domain/matching'
import { readSpreadsheet, type ParsedFile } from './excel'
import { payments } from './payments'

type BankMapping = Partial<Record<BankFieldKey, number | null>>

export interface BankLineRow {
  id: number
  statement_id: number
  file_name: string
  op_date: string
  label: string
  reference: string | null
  amount_minor: number
  currency: Currency
  status: BankLineStatus
  payment_id: number | null
  payment_company: string | null
}

const parsed = new Map<string, ParsedFile>()

function fingerprint(date: string, amount: number, label: string, ref: string | null): string {
  return createHash('sha256').update(`${date}|${amount}|${label.trim().toUpperCase()}|${(ref ?? '').trim().toUpperCase()}`).digest('hex')
}

export const bank = {
  async importPreview() {
    const sheet = await readSpreadsheet('Choisir le relevé bancaire (Excel ou CSV)')
    if (!sheet) return null
    const token = randomUUID()
    parsed.set(token, sheet)
    return {
      token,
      file_name: sheet.fileName,
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 6).map((r) => r.map((v) => (v instanceof Date ? parseDateFlexible(v) : v))),
      row_count: sheet.rows.length,
      mapping: guessMapping<BankFieldKey>(sheet.headers, BANK_FIELDS)
    }
  },

  /** Enregistre les ENCAISSEMENTS du relevé (les débits sont ignorés). Les lignes déjà importées sont sautées. */
  importRun(p: { token: string; mapping: BankMapping; currency: Currency; bank_name: string | null }) {
    const file = parsed.get(p.token)
    if (!file) throw new AppError('Le fichier n’est plus en mémoire : recommencez l’import.')
    const m = p.mapping
    if (m.date == null || m.label == null) throw new AppError('Indiquez au moins les colonnes « Date » et « Libellé ».')
    if (m.credit == null && m.amount == null) throw new AppError('Indiquez la colonne « Crédit » ou la colonne « Montant ».')
    const get = (row: unknown[], k: BankFieldKey) => (m[k] == null ? null : (row[m[k]!] ?? null))
    let added = 0
    let skipped = 0
    let duplicates = 0
    const errors: { row: number; message: string }[] = []
    const statementId = tx(() => {
      const r = db().prepare('INSERT INTO bank_statements (file_name, bank_name, currency) VALUES (?,?,?)').run(file.fileName, p.bank_name || null, p.currency)
      const sid = Number(r.lastInsertRowid)
      const ins = db().prepare(
        `INSERT OR IGNORE INTO bank_statement_lines (statement_id, op_date, label, reference, amount_minor, currency, fingerprint) VALUES (?,?,?,?,?,?,?)`
      )
      file.rows.forEach((row, i) => {
        const date = parseDateFlexible(get(row, 'date'))
        const label = String(get(row, 'label') ?? '').trim()
        let amount: number | null = null
        if (m.credit != null) amount = parseAmount(get(row, 'credit') as string | number | null, p.currency)
        if ((amount === null || amount === 0) && m.amount != null) amount = parseAmount(get(row, 'amount') as string | number | null, p.currency)
        if (!date && !label && amount === null) return
        if (!date) return errors.push({ row: i + file.headerRow + 1, message: 'date illisible' })
        if (amount === null || amount <= 0) return skipped++ // débit ou ligne sans montant : pas un encaissement
        const ref = get(row, 'reference') ? String(get(row, 'reference')).trim() : null
        const res = ins.run(sid, date, label || '(sans libellé)', ref, amount, p.currency, fingerprint(date, amount, label, ref))
        if (res.changes) added++
        else duplicates++
      })
      if (added === 0) db().prepare('DELETE FROM bank_statements WHERE id = ?').run(sid)
      return sid
    })
    parsed.delete(p.token)
    audit('import', 'releve_bancaire', statementId, `Relevé « ${file.fileName} » importé : ${added} encaissement(s), ${duplicates} déjà présent(s)`)
    return { added, skipped, duplicates, errors }
  },

  statements() {
    return db()
      .prepare(`SELECT s.*, (SELECT count(*) FROM bank_statement_lines l WHERE l.statement_id = s.id) AS lines,
          (SELECT count(*) FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.status = 'non_rapproche') AS pending
        FROM bank_statements s ORDER BY s.imported_at DESC`)
      .all() as { id: number; file_name: string; bank_name: string | null; currency: Currency; imported_at: string; lines: number; pending: number }[]
  },

  lines(q: { status?: BankLineStatus | null; statement_id?: number | null } = {}): BankLineRow[] {
    const w = ['1=1']
    const p: Record<string, unknown> = {}
    if (q.status) {
      w.push('l.status = @status')
      p.status = q.status
    }
    if (q.statement_id) {
      w.push('l.statement_id = @sid')
      p.sid = q.statement_id
    }
    return db()
      .prepare(`SELECT l.*, s.file_name, c.name AS payment_company FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id
        LEFT JOIN payments py ON py.id = l.payment_id LEFT JOIN companies c ON c.id = py.company_id
        WHERE ${w.join(' AND ')} ORDER BY l.op_date DESC, l.id DESC LIMIT 1000`)
      .all(p) as BankLineRow[]
  },

  /** Propositions de rapprochement pour une ligne. */
  suggest(lineId: number) {
    const line = db().prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId) as
      | { op_date: string; label: string; reference: string | null; amount_minor: number; currency: Currency; status: string }
      | undefined
    if (!line) throw new AppError('Ligne introuvable.')
    const invs = db()
      .prepare(`SELECT i.id, i.number, c.id AS company_id, c.name AS company_name, c.short_name AS company_short, ${BALANCE} AS balance,
          i.currency, i.due_date, i.issue_date
        FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.status NOT IN ('annulee','soldee') AND i.currency = ? AND ${BALANCE} > 0`)
      .all(line.currency) as MatchInvoice[]
    const pays = db()
      .prepare(`SELECT p.id, p.company_id, c.name AS company_name, p.amount_minor AS amount, p.currency, p.received_at FROM payments p
        JOIN companies c ON c.id = p.company_id WHERE p.deleted_at IS NULL AND p.bank_line_id IS NULL AND p.currency = ?
        AND p.received_at BETWEEN date(?, '-10 days') AND date(?, '+10 days')`)
      .all(line.currency, line.op_date, line.op_date) as MatchPayment[]
    return suggestMatches({ date: line.op_date, label: line.label, reference: line.reference, amount: line.amount_minor, currency: line.currency }, invs, pays)
  },

  /** Valide un rapprochement : crée le paiement (avec ses imputations) depuis la ligne du relevé. */
  confirm(lineId: number, p: { company_id: number; allocations: { invoice_id: number; amount_minor: number }[]; method?: PaymentMethod }) {
    const line = db().prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(lineId) as
      | { id: number; op_date: string; label: string; reference: string | null; amount_minor: number; currency: Currency; status: string }
      | undefined
    if (!line) throw new AppError('Ligne introuvable.')
    if (line.status === 'rapproche') throw new AppError('Cette ligne est déjà rapprochée.')
    return tx(() => {
      const { id } = payments.create({
        company_id: p.company_id,
        received_at: line.op_date,
        method: p.method ?? 'virement',
        reference: (line.reference || line.label).slice(0, 100),
        amount_minor: line.amount_minor,
        currency: line.currency,
        notes: `Rapprochement bancaire : ${line.label}`.slice(0, 1000),
        allocations: p.allocations
      })
      db().prepare(`UPDATE bank_statement_lines SET status = 'rapproche', payment_id = ? WHERE id = ?`).run(id, lineId)
      db().prepare('UPDATE payments SET bank_line_id = ? WHERE id = ?').run(lineId, id)
      audit('rapprochement', 'paiement', id, `Ligne bancaire ${formatMoney(line.amount_minor, line.currency)} du ${line.op_date} rapprochée`)
      return { payment_id: id }
    })
  },

  /** Associe la ligne à un paiement déjà saisi à la main (évite un doublon). */
  linkPayment(lineId: number, paymentId: number) {
    const line = db().prepare('SELECT amount_minor, currency, status FROM bank_statement_lines WHERE id = ?').get(lineId) as
      | { amount_minor: number; currency: Currency; status: string }
      | undefined
    const pay = db().prepare('SELECT amount_minor, currency, bank_line_id FROM payments WHERE id = ? AND deleted_at IS NULL').get(paymentId) as
      | { amount_minor: number; currency: Currency; bank_line_id: number | null }
      | undefined
    if (!line || !pay) throw new AppError('Ligne ou paiement introuvable.')
    if (pay.bank_line_id) throw new AppError('Ce paiement est déjà rapproché d’une autre ligne.')
    if (pay.amount_minor !== line.amount_minor || pay.currency !== line.currency) throw new AppError('Les montants ne correspondent pas.')
    tx(() => {
      db().prepare(`UPDATE bank_statement_lines SET status = 'rapproche', payment_id = ? WHERE id = ?`).run(paymentId, lineId)
      db().prepare('UPDATE payments SET bank_line_id = ? WHERE id = ?').run(lineId, paymentId)
      audit('rapprochement', 'paiement', paymentId, 'Paiement existant associé à une ligne du relevé bancaire')
    })
    return true
  },

  setStatus(lineId: number, status: 'ignore' | 'non_rapproche') {
    const line = db().prepare('SELECT status, payment_id FROM bank_statement_lines WHERE id = ?').get(lineId) as { status: string; payment_id: number | null } | undefined
    if (!line) throw new AppError('Ligne introuvable.')
    if (line.status === 'rapproche') {
      // Annuler un rapprochement : le paiement reste, il est seulement détaché de la ligne
      db().prepare('UPDATE payments SET bank_line_id = NULL WHERE id = ?').run(line.payment_id)
    }
    db().prepare('UPDATE bank_statement_lines SET status = ?, payment_id = NULL WHERE id = ?').run(status, lineId)
    return true
  },

  removeStatement(id: number) {
    const n = (db().prepare(`SELECT count(*) AS n FROM bank_statement_lines WHERE statement_id = ? AND status = 'rapproche'`).get(id) as { n: number }).n
    if (n > 0) throw new AppError(`${n} ligne(s) de ce relevé sont déjà rapprochées : impossible de le supprimer.`)
    db().prepare('DELETE FROM bank_statements WHERE id = ?').run(id)
    audit('suppression', 'releve_bancaire', id, 'Relevé bancaire supprimé')
    return true
  }
}
