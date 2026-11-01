// Bordereaux de dépôt : facturation groupée par entreprise et par période.
// Le bordereau liste les factures déposées ensemble ; le client le tamponne comme accusé de réception.
import { db } from '../db/connection'
import { audit, nowLocal, tx } from '../db/util'
import { AppError } from '../errors'
import { depositBatchSchema, type DepositBatchInput } from '@shared/schemas'
import { DEPOSIT_MODES, type Currency, type DepositMode } from '@shared/constants'
import { formatDate, formatDateLong } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { invoices } from './invoices'
import { getSettings } from './settings'
import { page, renderPdf, savePdf, signatureBlock } from './pdf'

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export interface BatchRow {
  id: number
  company_id: number
  company_name: string
  reference: string
  period_start: string | null
  period_end: string | null
  deposit_date: string
  deposit_mode: DepositMode
  acknowledgment_ref: string | null
  notes: string | null
  invoice_count: number
  total_minor: number
  currency: Currency | null
}

const SELECT = `SELECT b.*, c.name AS company_name,
  (SELECT count(*) FROM deposit_batch_invoices bi WHERE bi.batch_id = b.id) AS invoice_count,
  (SELECT SUM(i.amount_minor) FROM deposit_batch_invoices bi JOIN invoices i ON i.id = bi.invoice_id WHERE bi.batch_id = b.id) AS total_minor,
  (SELECT i.currency FROM deposit_batch_invoices bi JOIN invoices i ON i.id = bi.invoice_id WHERE bi.batch_id = b.id LIMIT 1) AS currency
  FROM deposit_batches b JOIN companies c ON c.id = b.company_id`

export const batches = {
  list(q: { company_id?: number | null } = {}): BatchRow[] {
    return db()
      .prepare(`${SELECT} WHERE b.deleted_at IS NULL ${q.company_id ? 'AND b.company_id = @company' : ''} ORDER BY b.deposit_date DESC, b.id DESC LIMIT 500`)
      .all(q.company_id ? { company: q.company_id } : {}) as BatchRow[]
  },

  /** Factures à regrouper : brouillons ou envoyées, d'une entreprise, sur une période, pas encore dans un bordereau. */
  candidates(p: { company_id: number; from?: string | null; to?: string | null }) {
    return db()
      .prepare(`SELECT i.id, i.number, i.issue_date, i.patient_name, i.patient_matricule, i.amount_minor, i.currency, i.status,
          v.number AS voucher_number, i.po_number
        FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id
        WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.workflow_status IN ('brouillon','envoyee')
          AND (i.company_id = @company OR c.parent_company_id = @company)
          AND (@from IS NULL OR i.issue_date >= @from) AND (@to IS NULL OR i.issue_date <= @to)
          AND NOT EXISTS (SELECT 1 FROM deposit_batch_invoices bi JOIN deposit_batches b ON b.id = bi.batch_id WHERE bi.invoice_id = i.id AND b.deleted_at IS NULL)
        ORDER BY i.issue_date, i.number`)
      .all({ company: p.company_id, from: p.from ?? null, to: p.to ?? null }) as {
      id: number
      number: string
      issue_date: string
      patient_name: string | null
      patient_matricule: string | null
      amount_minor: number
      currency: Currency
      status: string
      voucher_number: string | null
      po_number: string | null
    }[]
  },

  nextReference(companyId: number): string {
    const n = (db().prepare('SELECT count(*) AS n FROM deposit_batches WHERE company_id = ?').get(companyId) as { n: number }).n + 1
    const year = new Date().getFullYear()
    return `BRD-${year}-${String(companyId).padStart(3, '0')}-${String(n).padStart(3, '0')}`
  },

  /** Crée le bordereau ; les brouillons passent en « déposée » à la date du bordereau (l'échéance est recalculée). */
  create(input: DepositBatchInput) {
    const d = depositBatchSchema.parse(input)
    const allowed = new Set(batches.candidates({ company_id: d.company_id }).map((c) => c.id))
    const bad = d.invoice_ids.filter((i) => !allowed.has(i))
    if (bad.length) throw new AppError('Certaines factures ne peuvent pas être ajoutées (déjà dans un bordereau, d’une autre entreprise, ou déjà acceptées / payées).')
    return tx(() => {
      const r = db()
        .prepare(`INSERT INTO deposit_batches (company_id, reference, period_start, period_end, deposit_date, deposit_mode, acknowledgment_ref, notes)
          VALUES (@company_id, @reference, @period_start, @period_end, @deposit_date, @deposit_mode, @acknowledgment_ref, @notes)`)
        .run(d)
      const id = Number(r.lastInsertRowid)
      const ins = db().prepare('INSERT INTO deposit_batch_invoices (batch_id, invoice_id) VALUES (?,?)')
      for (const inv of d.invoice_ids) ins.run(id, inv)
      const drafts = (db()
        .prepare(`SELECT id FROM invoices WHERE workflow_status = 'brouillon' AND id IN (${d.invoice_ids.map(() => '?').join(',')})`)
        .all(...d.invoice_ids) as { id: number }[]).map((x) => x.id)
      if (drafts.length) invoices.applyAction({ ids: drafts, action: 'envoyer', date: d.deposit_date, reason_text: `Bordereau ${d.reference}` })
      audit('creation', 'bordereau', id, `Bordereau ${d.reference} : ${d.invoice_ids.length} facture(s) déposée(s) le ${formatDate(d.deposit_date)}`)
      return { id }
    })
  },

  update(id: number, p: { acknowledgment_ref: string | null; notes: string | null }) {
    db().prepare(`UPDATE deposit_batches SET acknowledgment_ref = ?, notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(p.acknowledgment_ref || null, p.notes || null, id)
    audit('modification', 'bordereau', id, 'Bordereau modifié (accusé de réception)')
    return true
  },

  remove(id: number) {
    db().prepare('UPDATE deposit_batches SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('suppression', 'bordereau', id, 'Bordereau supprimé (les factures restent déposées)')
    return true
  },

  /** PDF du bordereau, avec cadre « reçu par » pour le tampon du client. */
  async pdf(id: number) {
    const b = db().prepare(`${SELECT} WHERE b.id = ?`).get(id) as BatchRow | undefined
    if (!b) throw new AppError('Bordereau introuvable.')
    const comp = db().prepare('SELECT name, address, city FROM companies WHERE id = ?').get(b.company_id) as { name: string; address: string | null; city: string | null }
    const rows = db()
      .prepare(`SELECT i.number, i.issue_date, i.patient_name, i.patient_matricule, i.amount_minor, i.currency, i.po_number, v.number AS voucher_number
        FROM deposit_batch_invoices bi JOIN invoices i ON i.id = bi.invoice_id LEFT JOIN coverage_vouchers v ON v.id = i.voucher_id
        WHERE bi.batch_id = ? ORDER BY i.issue_date, i.number`)
      .all(id) as { number: string; issue_date: string; patient_name: string | null; patient_matricule: string | null; amount_minor: number; currency: Currency; po_number: string | null; voucher_number: string | null }[]
    const totals = new Map<Currency, number>()
    rows.forEach((r) => totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount_minor))
    const s = getSettings()
    const body = `<div class="addr"><div class="to">${esc(comp.name)}</div>${comp.address ? `<div>${esc(comp.address)}</div>` : ''}${comp.city ? `<div>${esc(comp.city)}</div>` : ''}</div>
      <h1>Bordereau de dépôt de factures</h1>
      <div class="small">N° ${esc(b.reference)} · Dépôt le ${formatDateLong(b.deposit_date)} · ${DEPOSIT_MODES[b.deposit_mode]}${
        b.period_start || b.period_end ? ` · Période du ${formatDate(b.period_start)} au ${formatDate(b.period_end)}` : ''
      }</div>
      <table style="margin-top:12px"><thead><tr><th>#</th><th>N° facture</th><th>Date</th><th>Patient / matricule</th><th>N° bon</th><th>N° PO</th><th class="num">Montant</th></tr></thead>
      <tbody>${rows
        .map(
          (r, k) => `<tr><td>${k + 1}</td><td class="nw">${esc(r.number)}</td><td class="nw">${formatDate(r.issue_date)}</td><td>${esc(r.patient_name || r.patient_matricule)}</td>
          <td class="nw">${esc(r.voucher_number ?? '')}</td><td class="nw">${esc(r.po_number ?? '')}</td><td class="num">${formatMoney(r.amount_minor, r.currency)}</td></tr>`
        )
        .join('')}
      ${[...totals].map(([c, t]) => `<tr class="total"><td colspan="6">Total (${rows.length} facture${rows.length > 1 ? 's' : ''})</td><td class="num">${formatMoney(t, c)}</td></tr>`).join('')}
      </tbody></table>
      <p>Les pièces justificatives (bons de prise en charge, bons de commande) sont jointes à chaque facture. Merci de nous retourner un exemplaire de ce bordereau revêtu de votre cachet et de la date de réception.</p>
      <div style="display:flex; gap:24px; margin-top:18px; page-break-inside:avoid">
        <div class="box" style="flex:1; min-height:110px"><b>Reçu par le client</b><br><span class="small">Nom, date, signature et cachet :</span></div>
        <div class="signwrap" style="flex:1">${signatureBlock(s, b.deposit_date)}</div>
      </div>`
    const path = await savePdf(await renderPdf(page(s, body, { title: `Bordereau ${b.reference}` })), `Bordereau ${b.reference} ${comp.name}`)
    if (path) audit('document', 'bordereau', id, `Bordereau ${b.reference} imprimé en PDF`)
    return path
  }
}
