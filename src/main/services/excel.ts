// Import Excel/CSV de la facturation existante et export Excel de toutes les listes.
import { BrowserWindow, dialog, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { db } from '../db/connection'
import { audit } from '../db/util'
import { AppError } from '../errors'
import { getSettings } from './settings'
import { autoSavePath } from '../paths'
import { invoices, type InvoiceQuery } from './invoices'
import { payments, type PaymentQuery } from './payments'
import { companies } from './companies'
import { reminders } from './reminders'
import { dashboard } from './dashboard'
import { vouchers } from './vouchers'
import { rejections } from './rejections'
import { activities } from './activities'
import { litigation } from './litigation'
import {
  ACTIVITY_TYPES,
  CHANNELS,
  COMPANY_TYPES,
  CURRENCIES,
  DELIVERY_LABELS,
  LITIGATION_HANDLERS,
  LITIGATION_PROCEDURES,
  LITIGATION_STATUS,
  PAYMENT_METHODS,
  PROMISE_STATUS,
  REJECTION_REASONS,
  REJECTION_STATUS,
  STATUS_INFO,
  AGING_BUCKETS,
  VOUCHER_STATES,
  type Currency,
  type WorkflowStatus
} from '@shared/constants'
import { formatMoney, fromMinor, parseAmount } from '@shared/money'
import { parseDateFlexible, todayISO } from '@shared/dates'
import { IMPORT_FIELDS, guessMapping, normalizeHeader, type ImportMapping } from '@shared/importFields'

// ------------------------------------------------------------------ Export

type ColType = 'text' | 'date' | 'money' | 'int' | 'percent'
interface Col<T> {
  header: string
  width: number
  type?: ColType
  value: (r: T) => unknown
  currency?: (r: T) => Currency
}

const toDate = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null)

function addSheet<T>(wb: ExcelJS.Workbook, title: string, cols: Col<T>[], rows: T[]): void {
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
  head.alignment = { vertical: 'middle', wrapText: true }
  head.height = 28
  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => c.value(r)))
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      if (c.type === 'date') cell.numFmt = 'dd/mm/yyyy'
      if (c.type === 'money') cell.numFmt = c.currency && c.currency(r) !== 'XAF' ? '#,##0.00' : '#,##0'
      if (c.type === 'int') cell.numFmt = '0'
      if (c.type === 'percent') cell.numFmt = '0.0%'
    })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

async function saveWorkbook(wb: ExcelJS.Workbook, defaultName: string): Promise<string | null> {
  const auto = autoSavePath(`${defaultName}.xlsx`)
  if (auto) {
    await wb.xlsx.writeFile(auto)
    return auto
  }
  const win = BrowserWindow.getFocusedWindow()
  const opts = { title: 'Enregistrer le fichier Excel', defaultPath: `${defaultName}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  try {
    await wb.xlsx.writeFile(res.filePath)
  } catch (e) {
    if (/EBUSY|EPERM/.test(String(e))) throw new AppError('Le fichier est ouvert dans Excel : fermez-le puis réessayez.')
    throw e
  }
  await shell.openPath(res.filePath)
  return res.filePath
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = getSettings().signatory.name || 'Recouvrement'
  wb.created = new Date()
  return wb
}

function allReminders() {
  const all: ReturnType<typeof reminders.history>['rows'] = []
  for (let page = 1; ; page++) {
    const h = reminders.history({ page_size: 500, page })
    all.push(...h.rows)
    if (h.rows.length === 0 || all.length >= h.total) return all
  }
}

/** Pages 2…n d'une liste paginée de 500 lignes (la page 1 est fournie à part). */
function pagesAfterFirst<T>(fetch: (page: number) => T[], total: number): T[][] {
  const out: T[][] = []
  for (let page = 2; (page - 1) * 500 < total; page++) out.push(fetch(page))
  return out
}

export type ExportKind = 'factures' | 'paiements' | 'entreprises' | 'relances' | 'balance_agee' | 'bons' | 'rejets' | 'echanges' | 'contentieux'

// ------------------------------------------------------------------ Import

export interface ParsedFile {
  fileName: string
  headers: string[]
  rows: unknown[][]
  headerRow: number
}
const parsedFiles = new Map<string, ParsedFile>()

/**
 * Ouvre un fichier Excel (.xlsx) ou CSV choisi par l'utilisatrice et le lit :
 * la ligne d'en-têtes est détectée automatiquement (première ligne avec au moins 2 cellules texte).
 * Tests automatisés : RECOUVREMENT_OPEN_FILE remplace la boîte de dialogue.
 */
export async function readSpreadsheet(title: string): Promise<ParsedFile | null> {
  let file = process.env.RECOUVREMENT_OPEN_FILE ?? null
  if (!file) {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title, properties: ['openFile' as const], filters: [{ name: 'Excel ou CSV', extensions: ['xlsx', 'csv'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    file = res.filePaths[0]
  }
  const wb = new ExcelJS.Workbook()
  try {
    if (extname(file).toLowerCase() === '.csv') {
      const firstLine = readFileSync(file, 'utf8').split(/\r?\n/)[0] ?? ''
      const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
      await wb.csv.readFile(file, { parserOptions: { delimiter } })
    } else {
      await wb.xlsx.readFile(file)
    }
  } catch {
    throw new AppError('Impossible de lire ce fichier. Enregistrez-le au format Excel (.xlsx) puis réessayez. Les anciens fichiers .xls ne sont pas pris en charge.')
  }
  const ws = wb.worksheets.find((w) => w.rowCount > 0)
  if (!ws) throw new AppError('Le fichier est vide.')
  const all: unknown[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: unknown[] = []
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value))
    all.push(vals)
  })
  const headerIdx = all.findIndex((r) => r.filter((v) => typeof v === 'string').length >= 2)
  if (headerIdx < 0) throw new AppError('Impossible de trouver la ligne d’en-têtes (noms de colonnes) dans le fichier.')
  const headers = all[headerIdx].map((h, i) => (h ? String(h) : `Colonne ${i + 1}`))
  const rows = all.slice(headerIdx + 1).filter((r) => r.some((v) => v !== null && v !== ''))
  if (rows.length === 0) throw new AppError('Aucune ligne de données sous les en-têtes.')
  if (rows.length > 20000) throw new AppError('Fichier trop volumineux (20 000 lignes maximum par import). Découpez-le en plusieurs fichiers.')
  return { fileName: basename(file), headers, rows, headerRow: headerIdx + 1 }
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim() || null
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue)
    if ('text' in v) return String(v.text).trim() || null
    if ('error' in v) return null
  }
  return String(v)
}

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return parseDateFlexible(v)
  const s = String(v).trim()
  return s || null
}

/** Statut saisi dans le fichier → statut métier. */
type InitialStatus = Extract<WorkflowStatus, 'brouillon' | 'envoyee' | 'acceptee'>
function mapStatus(v: string | null, fallback: InitialStatus): { workflow: InitialStatus; paid?: boolean; action?: 'rejeter' | 'contentieux' | 'annuler' } {
  if (!v) return { workflow: fallback }
  const s = normalizeHeader(v)
  if (/brouillon|a envoyer|non envoy/.test(s)) return { workflow: 'brouillon' }
  if (/rejet|refus/.test(s)) return { workflow: 'envoyee', action: 'rejeter' }
  if (/contentieux|litige|avocat|huissier/.test(s)) return { workflow: 'envoyee', action: 'contentieux' }
  if (/annul/.test(s)) return { workflow: 'brouillon', action: 'annuler' }
  if (/sold|paye|regle|encaiss/.test(s) && !/partiel|non/.test(s)) return { workflow: 'acceptee', paid: true }
  if (/accept|valid|approuv|bon a payer/.test(s)) return { workflow: 'acceptee' }
  if (/envoy|depos|transmi|recu/.test(s)) return { workflow: 'envoyee' }
  return { workflow: fallback }
}

class DryRun extends Error {}

export const excel = {
  async export(kind: ExportKind, query: Record<string, unknown> = {}) {
    const wb = newWorkbook()
    const date = todayISO()
    if (kind === 'factures') {
      const rows = invoices.listAll({ ...(query as InvoiceQuery), kind: (query.kind as InvoiceQuery['kind']) ?? 'all' })
      addSheet(
        wb,
        'Factures',
        [
          { header: 'N° facture', width: 16, value: (r) => r.number },
          { header: 'Type', width: 9, value: (r) => (r.kind === 'avoir' ? 'Avoir' : 'Facture') },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Patient', width: 24, value: (r) => r.patient_name },
          { header: 'Matricule', width: 14, value: (r) => r.patient_matricule },
          { header: 'N° bon', width: 14, value: (r) => r.voucher_number },
          { header: 'N° PO', width: 14, value: (r) => r.po_number },
          { header: 'Convention', width: 16, value: (r) => r.convention_reference },
          { header: 'Émise le', width: 12, type: 'date', value: (r) => toDate(r.issue_date) },
          { header: 'Déposée le', width: 12, type: 'date', value: (r) => toDate(r.deposit_date) },
          { header: 'Échéance', width: 12, type: 'date', value: (r) => toDate(r.due_date) },
          { header: 'Montant', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.amount_minor, r.currency) },
          { header: 'Payé', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.paid_minor, r.currency) },
          { header: 'Avoirs', width: 13, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.credited_minor, r.currency) },
          { header: 'Reste dû', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.kind === 'avoir' ? 0 : r.balance_minor, r.currency) },
          { header: 'Devise', width: 8, value: (r) => r.currency },
          { header: 'Statut', width: 18, value: (r) => STATUS_INFO[r.status].label },
          { header: 'Jours de retard', width: 10, type: 'int', value: (r) => r.days_late },
          { header: 'Dernière relance', width: 14, type: 'date', value: (r) => toDate(r.last_reminder_at) }
        ],
        rows
      )
    } else if (kind === 'paiements') {
      addSheet(
        wb,
        'Paiements',
        [
          { header: 'Date', width: 12, type: 'date', value: (r) => toDate(r.received_at) },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Mode', width: 11, value: (r) => PAYMENT_METHODS[r.method] },
          { header: 'Référence', width: 18, value: (r) => r.reference },
          { header: 'Banque', width: 16, value: (r) => r.bank_name },
          { header: 'Montant', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.amount_minor, r.currency) },
          { header: 'Imputé', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.allocated_minor, r.currency) },
          { header: 'Non imputé', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.unallocated_minor, r.currency) },
          { header: 'Devise', width: 8, value: (r) => r.currency },
          { header: 'Factures', width: 40, value: (r) => r.invoice_numbers },
          { header: 'Notes', width: 30, value: (r) => r.notes }
        ],
        payments.listAll(query as PaymentQuery)
      )
    } else if (kind === 'entreprises') {
      addSheet(
        wb,
        'Entreprises',
        [
          { header: 'Entreprise', width: 32, value: (r) => r.name },
          { header: 'Type', width: 20, value: (r) => COMPANY_TYPES[r.type] },
          { header: 'Donneur d’ordre', width: 26, value: (r) => r.parent_name },
          { header: 'NIU', width: 16, value: (r) => r.niu },
          { header: 'Téléphone', width: 16, value: (r) => r.phone },
          { header: 'E-mail', width: 26, value: (r) => r.email },
          { header: 'Délai (jours)', width: 10, type: 'int', value: (r) => r.payment_terms_days },
          { header: 'Factures ouvertes', width: 10, type: 'int', value: (r) => r.open_count },
          { header: 'Total dû (FCFA)', width: 16, type: 'money', value: (r) => r.outstanding_xaf },
          { header: 'En retard (FCFA)', width: 16, type: 'money', value: (r) => r.overdue_xaf }
        ],
        companies.list({ sort: 'outstanding' })
      )
    } else if (kind === 'relances') {
      addSheet(
        wb,
        'Relances',
        [
          { header: 'Date', width: 17, value: (r) => r.sent_at },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Canal', width: 10, value: (r) => CHANNELS[r.channel] },
          { header: 'Action', width: 22, value: (r) => DELIVERY_LABELS[r.delivery] },
          { header: 'Destinataire', width: 26, value: (r) => r.recipient },
          { header: 'Interlocuteur', width: 22, value: (r) => r.contact_name },
          { header: 'Modèle', width: 26, value: (r) => r.template_name },
          { header: 'Objet', width: 40, value: (r) => r.subject },
          { header: 'Factures', width: 40, value: (r) => r.invoice_numbers }
        ],
        allReminders()
      )
    } else if (kind === 'balance_agee') {
      const a = dashboard.aging()
      type R = (typeof a.rows)[number]
      const total: R = { companyId: 0, companyName: 'TOTAL', buckets: a.totals, total: a.total }
      addSheet(
        wb,
        'Balance âgée',
        [
          { header: 'Entreprise', width: 34, value: (r: R) => r.companyName },
          ...AGING_BUCKETS.map((b) => ({ header: `${b.label} (FCFA)`, width: 16, type: 'money' as const, value: (r: R) => r.buckets[b.key] })),
          { header: 'Total (FCFA)', width: 18, type: 'money', value: (r: R) => r.total }
        ],
        [...a.rows, total]
      )
      const ws = wb.getWorksheet(1)!
      ws.getRow(ws.rowCount).font = { bold: true }
    } else if (kind === 'bons') {
      addSheet(
        wb,
        'Bons de prise en charge',
        [
          { header: 'N° bon', width: 16, value: (r) => r.number },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Patient', width: 22, value: (r) => r.patient_name },
          { header: 'Matricule', width: 14, value: (r) => r.patient_matricule },
          { header: 'N° PO', width: 14, value: (r) => r.po_number },
          { header: 'Émis le', width: 12, type: 'date', value: (r) => toDate(r.issue_date) },
          { header: 'Valide jusqu’au', width: 13, type: 'date', value: (r) => toDate(r.valid_until) },
          { header: 'Plafond', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => (r.ceiling_minor ? fromMinor(r.ceiling_minor, r.currency) : null) },
          { header: 'Facturé', width: 15, type: 'money', currency: (r) => r.currency, value: (r) => fromMinor(r.used_minor, r.currency) },
          { header: 'Devise', width: 8, value: (r) => r.currency },
          { header: 'Factures', width: 9, type: 'int', value: (r) => r.invoice_count },
          { header: 'État', width: 16, value: (r) => VOUCHER_STATES[r.state].label }
        ],
        vouchers.list({ page_size: 500 }).rows.concat(...pagesAfterFirst((page) => vouchers.list({ page_size: 500, page }).rows, vouchers.list({ page_size: 500 }).total))
      )
    } else if (kind === 'rejets') {
      addSheet(
        wb,
        'Rejets',
        [
          { header: 'Date du rejet', width: 12, type: 'date', value: (r) => toDate(r.rejected_at) },
          { header: 'N° facture', width: 16, value: (r) => r.invoice_number },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Motif', width: 30, value: (r) => REJECTION_REASONS[r.reason_code] },
          { header: 'Détail', width: 34, value: (r) => r.reason_text },
          { header: 'Pièce manquante', width: 22, value: (r) => r.missing_document },
          { header: 'Action corrective', width: 34, value: (r) => r.corrective_action },
          { header: 'Interlocuteur', width: 20, value: (r) => r.contact_name },
          { header: 'Re-dépôt prévu', width: 13, type: 'date', value: (r) => toDate(r.redeposit_due) },
          { header: 'Redéposée le', width: 13, type: 'date', value: (r) => toDate(r.redeposited_at) },
          { header: 'Jours', width: 8, type: 'int', value: (r) => r.days_open },
          { header: 'Statut', width: 12, value: (r) => REJECTION_STATUS[r.status].label }
        ],
        rejections.list({ page_size: 500 }).rows.concat(...pagesAfterFirst((page) => rejections.list({ page_size: 500, page }).rows, rejections.list({ page_size: 500 }).total))
      )
    } else if (kind === 'echanges') {
      addSheet(
        wb,
        'Échanges et promesses',
        [
          { header: 'Date', width: 12, type: 'date', value: (r) => toDate(r.occurred_at) },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Type', width: 18, value: (r) => ACTIVITY_TYPES[r.type] },
          { header: 'Interlocuteur', width: 20, value: (r) => r.contact_name },
          { header: 'Résumé', width: 60, value: (r) => r.summary },
          { header: 'Factures', width: 30, value: (r) => r.invoice_numbers },
          { header: 'Montant promis', width: 15, type: 'money', currency: (r) => r.promised_currency ?? 'XAF', value: (r) => (r.promised_minor ? fromMinor(r.promised_minor, r.promised_currency ?? 'XAF') : null) },
          { header: 'Date promise', width: 12, type: 'date', value: (r) => toDate(r.promised_date) },
          { header: 'Promesse', width: 18, value: (r) => (r.promise_status ? PROMISE_STATUS[r.promise_status].label : null) }
        ],
        activities.list({ page_size: 500 }).rows.concat(...pagesAfterFirst((page) => activities.list({ page_size: 500, page }).rows, activities.list({ page_size: 500 }).total))
      )
    } else if (kind === 'contentieux') {
      addSheet(
        wb,
        'Contentieux',
        [
          { header: 'Référence', width: 16, value: (r) => r.reference },
          { header: 'Entreprise', width: 30, value: (r) => r.company_name },
          { header: 'Ouvert le', width: 12, type: 'date', value: (r) => toDate(r.opened_at) },
          { header: 'Confié à', width: 24, value: (r) => `${LITIGATION_HANDLERS[r.handler_type]}${r.handler_name ? ' – ' + r.handler_name : ''}` },
          { header: 'Procédure', width: 28, value: (r) => LITIGATION_PROCEDURES[r.procedure] },
          { header: 'Statut', width: 20, value: (r) => LITIGATION_STATUS[r.status].label },
          { header: 'Factures', width: 9, type: 'int', value: (r) => r.invoice_count },
          { header: 'Reste dû', width: 26, value: (r) => r.due.map((d) => formatMoney(d.balance, d.currency)).join(' + ') },
          { header: 'Frais engagés', width: 22, value: (r) => r.cost_totals.map((d) => formatMoney(d.total, d.currency)).join(' + ') },
          { header: 'Prochaine étape', width: 36, value: (r) => r.next_step }
        ],
        litigation.list()
      )
    } else throw new AppError('Export inconnu.')
    const names: Record<ExportKind, string> = {
      factures: 'Factures',
      paiements: 'Paiements',
      entreprises: 'Entreprises',
      relances: 'Historique des relances',
      balance_agee: 'Balance âgée',
      bons: 'Bons de prise en charge',
      rejets: 'Rejets',
      echanges: 'Échanges et promesses',
      contentieux: 'Contentieux'
    }
    return saveWorkbook(wb, `${names[kind]} ${date}`)
  },

  /** Fichier modèle à remplir pour l'import. */
  async importTemplate() {
    const wb = newWorkbook()
    const ws = wb.addWorksheet('Factures')
    ws.columns = IMPORT_FIELDS.map((f) => ({ header: f.label, width: Math.max(14, f.label.length + 2) }))
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
    const example: Record<string, unknown> = {
      number: 'FAC-2026-0001',
      company: 'Nom de l’entreprise',
      amount: 1250000,
      currency: 'XAF',
      issue_date: new Date(Date.UTC(2026, 9, 15)),
      deposit_date: new Date(Date.UTC(2026, 9, 20)),
      due_date: null,
      voucher_number: 'BPC-4521',
      po_number: 'PO-778',
      patient_name: 'Nom Prénom',
      patient_matricule: 'MAT-0012',
      convention: 'CONV-2026',
      status: 'Envoyée',
      paid_amount: null,
      paid_date: null,
      notes: null
    }
    ws.addRow(IMPORT_FIELDS.map((f) => example[f.key] ?? null))
    ws.getRow(2).eachCell((c) => {
      if (c.value instanceof Date) c.numFmt = 'dd/mm/yyyy'
    })
    const help = wb.addWorksheet('Mode d’emploi')
    help.getColumn(1).width = 110
    ;[
      'Une ligne par facture. Les colonnes en gras dans l’assistant d’import sont obligatoires : N° de facture, Entreprise, Montant, Date d’émission.',
      'Ne saisissez JAMAIS de diagnostic ni d’acte médical : seulement le nom OU le matricule du patient.',
      'Montant : nombre sans symbole (ex. 1250000). Devise : XAF, USD ou EUR (XAF par défaut).',
      'Dates : format JJ/MM/AAAA. Si l’échéance est vide, elle est calculée selon le délai de l’entreprise ou de la convention.',
      'Statut (facultatif) : Brouillon, Envoyée, Acceptée, Rejetée, Contentieux, Payée/Soldée, Annulée.',
      'Montant déjà payé (facultatif) : un paiement « reprise d’historique » est créé et imputé automatiquement.',
      'Les numéros de facture déjà présents dans l’application sont refusés (pas de doublon).'
    ].forEach((t) => help.addRow([t]))
    return saveWorkbook(wb, 'Modèle import factures')
  },

  /** Étape 1 : choisir le fichier, lire les en-têtes et proposer une correspondance. */
  async importPreview() {
    const sheet = await readSpreadsheet('Choisir le fichier Excel à importer')
    if (!sheet) return null
    const token = randomUUID()
    parsedFiles.set(token, sheet)
    return {
      token,
      file_name: sheet.fileName,
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 8).map((r) => r.map((v) => (v instanceof Date ? parseDateFlexible(v) : v))),
      row_count: sheet.rows.length,
      mapping: guessMapping(sheet.headers),
      header_row: sheet.headerRow
    }
  },

  /** Étape 2 : contrôler (dry_run) puis importer. Chaque ligne en erreur est ignorée et signalée. */
  importRun(p: { token: string; mapping: ImportMapping; create_companies: boolean; default_currency: Currency; default_status: 'brouillon' | 'envoyee'; dry_run: boolean }) {
    const file = parsedFiles.get(p.token)
    if (!file) throw new AppError('Le fichier n’est plus en mémoire : recommencez l’import.')
    for (const f of IMPORT_FIELDS) {
      if (f.required && (p.mapping[f.key] === undefined || p.mapping[f.key] === null)) throw new AppError(`Indiquez la colonne correspondant à « ${f.label} ».`)
    }
    const get = (row: unknown[], key: keyof ImportMapping) => {
      const idx = p.mapping[key]
      return idx === undefined || idx === null ? null : (row[idx] ?? null)
    }
    const errors: { row: number; number: string | null; message: string }[] = []
    const createdCompanies = new Set<string>()
    const seenNumbers = new Set<string>()
    let ok = 0
    const companyCache = new Map<string, number>()
    const findCompany = (name: string): number | null => {
      const k = name.toLowerCase()
      if (companyCache.has(k)) return companyCache.get(k)!
      const r = db().prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL').get(name) as { id: number } | undefined
      if (r) companyCache.set(k, r.id)
      return r?.id ?? null
    }

    const run = () =>
      db().transaction(() => {
        file.rows.forEach((row, i) => {
          const line = i + 2
          const number = asText(get(row, 'number'))
          try {
            db().transaction(() => {
              if (!number) throw new AppError('numéro de facture manquant')
              const key = number.toLowerCase()
              if (seenNumbers.has(key)) throw new AppError('numéro en double dans le fichier')
              seenNumbers.add(key)
              if (invoices.numberExists(number)) throw new AppError('ce numéro existe déjà dans l’application')
              const companyName = asText(get(row, 'company'))
              if (!companyName) throw new AppError('entreprise manquante')
              let companyId = findCompany(companyName)
              if (!companyId) {
                if (!p.create_companies) throw new AppError(`entreprise « ${companyName} » inconnue`)
                companyId = companies.create({
                  name: companyName,
                  type: 'petrolier',
                  default_currency: p.default_currency,
                  payment_terms_days: 60
                }).id
                companyCache.set(companyName.toLowerCase(), companyId)
                createdCompanies.add(companyName)
              }
              const curRaw = asText(get(row, 'currency'))?.toUpperCase().replace('FCFA', 'XAF').replace('€', 'EUR').replace('$', 'USD') ?? p.default_currency
              if (!(CURRENCIES as readonly string[]).includes(curRaw)) throw new AppError(`devise « ${curRaw} » non reconnue (XAF, USD ou EUR)`)
              const currency = curRaw as Currency
              const amount = parseAmount(get(row, 'amount') as string | number | null, currency)
              if (!amount || amount <= 0) throw new AppError('montant manquant ou invalide')
              const issue = parseDateFlexible(get(row, 'issue_date'))
              if (!issue) throw new AppError('date d’émission manquante ou invalide')
              const depositRaw = get(row, 'deposit_date')
              const deposit = depositRaw ? parseDateFlexible(depositRaw) : null
              if (depositRaw && !deposit) throw new AppError('date de dépôt invalide')
              const dueRaw = get(row, 'due_date')
              const due = dueRaw ? parseDateFlexible(dueRaw) : null
              if (dueRaw && !due) throw new AppError('date d’échéance invalide')
              const convRef = asText(get(row, 'convention'))
              let conventionId: number | null = null
              if (convRef) {
                const cv = db()
                  .prepare('SELECT id FROM conventions WHERE company_id = ? AND reference = ? COLLATE NOCASE AND deleted_at IS NULL')
                  .get(companyId, convRef) as { id: number } | undefined
                if (!cv) throw new AppError(`convention « ${convRef} » introuvable pour cette entreprise`)
                conventionId = cv.id
              }
              const st = mapStatus(asText(get(row, 'status')), p.default_status)
              const patientName = asText(get(row, 'patient_name'))
              const matricule = asText(get(row, 'patient_matricule'))
              const { id } = invoices.create({
                number,
                company_id: companyId,
                convention_id: conventionId,
                voucher_number: asText(get(row, 'voucher_number')),
                po_number: asText(get(row, 'po_number')),
                patient_name: patientName ?? (matricule ? null : 'Non renseigné'),
                patient_matricule: matricule,
                beneficiary_type: 'salarie',
                issue_date: issue,
                deposit_date: deposit,
                due_date: due,
                due_date_manual: !!due,
                amount_minor: amount,
                currency,
                notes: asText(get(row, 'notes')),
                workflow_status: st.workflow
              })
              if (st.action) {
                const r = invoices.applyAction({ ids: [id], action: st.action, date: deposit ?? issue, reason_code: st.action === 'rejeter' ? 'autre' : null, reason_text: 'Import Excel' })
                if (r.done === 0) throw new AppError(`statut impossible à appliquer (${r.skipped[0]?.reason ?? ''})`)
              }
              let paid = parseAmount(get(row, 'paid_amount') as string | number | null, currency)
              if (st.paid && !paid) paid = amount
              if (paid && paid > 0) {
                if (paid > amount) throw new AppError('le montant payé dépasse le montant de la facture')
                const paidDate = parseDateFlexible(get(row, 'paid_date')) ?? deposit ?? issue
                payments.create({
                  company_id: companyId,
                  received_at: paidDate,
                  method: 'virement',
                  reference: 'Reprise historique',
                  amount_minor: paid,
                  currency,
                  notes: `Import Excel – ${file.fileName}`,
                  allocations: [{ invoice_id: id, amount_minor: paid }]
                })
              }
            })()
            ok++
          } catch (e) {
            errors.push({ row: line, number, message: e instanceof Error ? e.message : String(e) })
          }
        })
        if (p.dry_run) throw new DryRun()
      })()

    try {
      run()
    } catch (e) {
      if (!(e instanceof DryRun)) throw e
    }
    const report = { ok, errors, created_companies: [...createdCompanies], dry_run: p.dry_run, total: file.rows.length }
    if (!p.dry_run) {
      db()
        .prepare('INSERT INTO import_jobs (kind, file_name, rows_ok, rows_error, report_json) VALUES (?,?,?,?,?)')
        .run('factures', file.fileName, ok, errors.length, JSON.stringify(report))
      audit('import', 'facture', null, `Import Excel « ${file.fileName} » : ${ok} facture(s) importée(s), ${errors.length} erreur(s)`)
      parsedFiles.delete(p.token)
    }
    return report
  },

  /** Rapport d'erreurs d'import en Excel. */
  async exportImportErrors(errors: { row: number; number: string | null; message: string }[]) {
    const wb = newWorkbook()
    addSheet(
      wb,
      'Erreurs d’import',
      [
        { header: 'Ligne du fichier', width: 14, type: 'int', value: (r) => r.row },
        { header: 'N° facture', width: 20, value: (r) => r.number },
        { header: 'Problème', width: 80, value: (r) => r.message }
      ],
      errors
    )
    return saveWorkbook(wb, `Rapport erreurs import ${todayISO()}`)
  }
}
