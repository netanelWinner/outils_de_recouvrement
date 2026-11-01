// Tests d'intégration V2 : bons, rejets, bordereaux, promesses, rapprochement bancaire, contentieux, prescription.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import ExcelJS from 'exceljs'
import { openDatabase, setDb, closeDatabase, db } from '../../src/main/db/connection'
import { companies } from '../../src/main/services/companies'
import { invoices } from '../../src/main/services/invoices'
import { payments } from '../../src/main/services/payments'
import { reminders } from '../../src/main/services/reminders'
import { vouchers } from '../../src/main/services/vouchers'
import { rejections } from '../../src/main/services/rejections'
import { batches } from '../../src/main/services/batches'
import { activities } from '../../src/main/services/activities'
import { bank } from '../../src/main/services/bank'
import { litigation } from '../../src/main/services/litigation'
import { agenda } from '../../src/main/services/agenda'
import { demo } from '../../src/main/services/demo'
import { trash } from '../../src/main/services/trash'
import { addDays, todayISO } from '@shared/dates'

const dir = mkdtempSync(join(tmpdir(), 'recouvrement-v2-'))
const today = todayISO()
let A = 0
let n = 0

beforeAll(() => {
  setDb(openDatabase(join(dir, 'v2.db'), randomBytes(32).toString('hex')))
  A = companies.create({ name: 'Atlantique Test Petroleum', short_name: 'ATP', type: 'petrolier', default_currency: 'XAF', payment_terms_days: 30 }).id
})
afterAll(() => {
  closeDatabase()
  delete process.env.RECOUVREMENT_OPEN_FILE
  rmSync(dir, { recursive: true, force: true })
})

const inv = (o: Record<string, unknown> = {}) =>
  invoices.create({
    number: `T-${++n}`.padEnd(8, '0'),
    company_id: A,
    patient_name: 'Patient',
    beneficiary_type: 'salarie',
    issue_date: addDays(today, -60),
    amount_minor: 100_000,
    currency: 'XAF',
    workflow_status: 'envoyee',
    ...o
  }).id

describe('bons de prise en charge', () => {
  it('suit la consommation du plafond et signale l’expiration proche', () => {
    const { id } = vouchers.save(null, { company_id: A, number: 'B-1', patient_matricule: 'M1', beneficiary_type: 'salarie', valid_until: addDays(today, 5), ceiling_minor: 300_000, currency: 'XAF' })
    inv({ voucher_number: 'B-1', amount_minor: 200_000 })
    const v = vouchers.get(id).voucher
    expect(v.used_minor).toBe(200_000)
    expect(v.state).toBe('expire_bientot')
    expect(vouchers.expiring().some((x) => x.id === id)).toBe(true)
    expect(() => vouchers.save(id, { company_id: A, number: 'B-1', patient_matricule: 'M1', beneficiary_type: 'salarie', ceiling_minor: 100_000, currency: 'XAF' })).toThrow(/plafond/)
    expect(() => vouchers.remove(id)).toThrow(/utilisé/)
  })
})

describe('rejets', () => {
  it('enregistre le détail du rejet, puis le clôt au re-dépôt', () => {
    const id = inv()
    invoices.applyAction({ ids: [id], action: 'rejeter', reason_code: 'po_manquant', missing_document: 'PO', corrective_action: 'Demander le PO', redeposit_due: addDays(today, -1) })
    expect(rejections.dueForRedeposit().some((r) => r.invoice_id === id)).toBe(true)
    expect(invoices.get(id).rejections[0]).toMatchObject({ status: 'ouvert', missing_document: 'PO' })
    invoices.applyAction({ ids: [id], action: 'redeposer', date: today })
    expect(invoices.get(id).rejections[0]).toMatchObject({ status: 'redepose', redeposited_at: today })
    expect(rejections.stats().find((s) => s.reason_code === 'po_manquant')?.n).toBeGreaterThan(0)
  })
})

describe('bordereaux de dépôt', () => {
  it('regroupe des brouillons et les marque déposés à la date du bordereau', () => {
    const d1 = inv({ workflow_status: 'brouillon' })
    const d2 = inv({ workflow_status: 'brouillon' })
    const cands = batches.candidates({ company_id: A }).map((c) => c.id)
    expect(cands).toEqual(expect.arrayContaining([d1, d2]))
    batches.create({ company_id: A, invoice_ids: [d1, d2], reference: 'BRD-1', deposit_date: today, deposit_mode: 'main_propre' })
    expect(invoices.get(d1).invoice).toMatchObject({ status: 'envoyee', deposit_date: today })
    expect(batches.candidates({ company_id: A }).map((c) => c.id)).not.toContain(d1)
    expect(() => batches.create({ company_id: A, invoice_ids: [d1], reference: 'BRD-2', deposit_date: today, deposit_mode: 'email' })).toThrow()
  })
})

describe('échanges et promesses', () => {
  it('une promesse suspend les relances, puis une promesse non tenue les fait reprendre', () => {
    const id = inv({ issue_date: addDays(today, -80) })
    reminders.generate()
    const before = reminders.tasks().flatMap((t) => t.invoices.map((i) => i.id))
    expect(before).toContain(id)
    activities.create({ company_id: A, type: 'appel', occurred_at: today, summary: 'Promet de payer', invoice_ids: [id], promise: { amount_minor: 100_000, currency: 'XAF', promised_date: addDays(today, 3) } })
    expect(reminders.tasks().flatMap((t) => t.invoices.map((i) => i.id))).not.toContain(id)
    // Simule le dépassement de la date promise sans paiement
    db().prepare('UPDATE promises SET promised_date = ? WHERE status = ?').run(addDays(today, -1), 'en_attente')
    db().prepare('UPDATE activities SET occurred_at = ?').run(addDays(today, -5))
    const broken = activities.evaluatePromises()
    expect(broken.map((b) => b.status)).toContain('non_tenue')
    expect(agenda.today().promises_broken.length).toBeGreaterThan(0)
    expect(reminders.tasks().flatMap((t) => t.invoices.map((i) => i.id))).toContain(id)
  })

  it('une promesse est tenue dès que le paiement arrive', () => {
    const id = inv()
    activities.create({ company_id: A, type: 'visite', occurred_at: today, summary: 'OK', invoice_ids: [id], promise: { amount_minor: 100_000, currency: 'XAF', promised_date: addDays(today, 10) } })
    payments.create({ company_id: A, received_at: today, method: 'virement', amount_minor: 100_000, currency: 'XAF', allocations: [{ invoice_id: id, amount_minor: 100_000 }] })
    activities.evaluatePromises()
    expect(activities.promises({ status: 'tenue' }).length).toBe(1)
  })
})

describe('rapprochement bancaire', () => {
  it('importe un relevé Excel, propose la bonne facture et crée le paiement', async () => {
    const target = inv({ number: 'FAC-2026-7777', amount_minor: 432_100 })
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Relevé')
    ws.addRow(['Relevé de compte – Banque Test'])
    ws.addRow(['Date opération', 'Libellé', 'Débit', 'Crédit', 'Référence'])
    ws.addRow([new Date(Date.UTC(2026, 10, 2)), 'VIR ATP FAC2026 7777', null, 432100, 'VR1'])
    ws.addRow([new Date(Date.UTC(2026, 10, 3)), 'FRAIS TENUE DE COMPTE', 5000, null, null])
    ws.addRow([new Date(Date.UTC(2026, 10, 4)), 'REMISE CHEQUE', null, '12 500', 'CH9'])
    const file = join(dir, 'releve.xlsx')
    await wb.xlsx.writeFile(file)
    process.env.RECOUVREMENT_OPEN_FILE = file

    const prev = await bank.importPreview()
    expect(prev!.mapping).toMatchObject({ date: 0, label: 1, debit: 2, credit: 3, reference: 4 })
    const r = bank.importRun({ token: prev!.token, mapping: prev!.mapping, currency: 'XAF', bank_name: 'Test' })
    expect(r).toMatchObject({ added: 2, skipped: 1 })
    // Ré-import du même fichier : pas de doublon
    const again = await bank.importPreview()
    expect(bank.importRun({ token: again!.token, mapping: again!.mapping, currency: 'XAF', bank_name: null })).toMatchObject({ added: 0, duplicates: 2 })

    const line = bank.lines({ status: 'non_rapproche' }).find((l) => l.amount_minor === 432_100)!
    const s = bank.suggest(line.id)
    expect(s[0].allocations[0].invoice_id).toBe(target)
    bank.confirm(line.id, { company_id: s[0].company_id, allocations: s[0].allocations.map((a) => ({ invoice_id: a.invoice_id, amount_minor: a.amount })) })
    expect(invoices.get(target).invoice.status).toBe('soldee')
    expect(bank.lines({ status: 'rapproche' })).toHaveLength(1)
    // Supprimer le paiement remet la ligne « à rapprocher »
    const pay = payments.list({ search: 'VR1' }).rows[0]
    payments.remove(pay.id)
    expect(bank.lines({ status: 'rapproche' })).toHaveLength(0)
  })
})

describe('contentieux et prescription', () => {
  it('ouvre un dossier (factures en contentieux) puis le clôt (sortie du contentieux)', () => {
    const id = inv()
    const { id: cid } = litigation.create({ company_id: A, reference: 'CTX-1', opened_at: today, handler_type: 'avocat', procedure: 'injonction_de_payer', invoice_ids: [id] })
    expect(invoices.get(id).invoice.status).toBe('contentieux')
    litigation.addCost(cid, { date: today, label: 'Honoraires', amount_minor: 50_000, currency: 'XAF' })
    const g = litigation.get(cid)
    expect(g.steps.length).toBe(1)
    expect(g.cost_totals[0].total).toBe(50_000)
    expect(litigation.upcomingSteps(7).some((s) => s.case_id === cid)).toBe(true)
    litigation.update(cid, { ...g.case, status: 'transige', invoice_ids: [] })
    expect(invoices.get(id).invoice.status).toBe('acceptee')
  })

  it('signale les créances proches de la prescription', () => {
    const id = inv({ issue_date: addDays(today, -1900), due_date: addDays(today, -1800), due_date_manual: true })
    expect(litigation.prescriptions().find((p) => p.id === id)?.level).toBe('critique')
  })
})

describe('migration V1 → V2', () => {
  it('une base V1 existante est mise à niveau et ses rejets sont repris', async () => {
    const Database = (await import('better-sqlite3-multiple-ciphers')).default
    const { MIGRATIONS } = await import('../../src/main/db/migrations')
    const { migrate } = await import('../../src/main/db/connection')
    const old = new Database(':memory:')
    old.exec(MIGRATIONS[0].sql)
    old.pragma('user_version = 1')
    old.exec(`INSERT INTO companies (id, name) VALUES (1, 'X');
      INSERT INTO invoices (id, number, company_id, issue_date, due_date, amount_minor, workflow_status, status) VALUES (1, 'F1', 1, '2026-01-01', '2026-03-01', 1000, 'rejetee', 'rejetee');
      INSERT INTO invoice_events (invoice_id, type, message, details) VALUES (1, 'rejet', 'Rejet', '{"reason_code":"po_manquant","reason_text":"PO absent","date":"2026-02-01"}');`)
    migrate(old)
    expect(old.pragma('user_version', { simple: true })).toBe(MIGRATIONS.at(-1)!.version)
    expect(old.prepare('SELECT invoice_id, reason_code, reason_text, rejected_at, status FROM rejections').get()).toEqual({
      invoice_id: 1,
      reason_code: 'po_manquant',
      reason_text: 'PO absent',
      rejected_at: '2026-02-01',
      status: 'ouvert'
    })
    old.close()
  })
})

describe('démonstration V2', () => {
  it('charge et efface les données V2 sans laisser de trace', () => {
    demo.load()
    const a = agenda.today()
    expect(a.vouchers_expiring.length).toBeGreaterThan(0)
    expect(a.rejections_due.length).toBeGreaterThan(0)
    expect(a.promises_broken.length).toBeGreaterThan(0)
    expect(litigation.list({ status: 'ouverts' }).some((l) => l.reference === 'CTX-DEMO-001')).toBe(true)
    expect(bank.lines({ status: 'non_rapproche' }).length).toBeGreaterThanOrEqual(3)
    demo.clear()
    const count = (t: string) => (db().prepare(`SELECT count(*) AS n FROM ${t} WHERE is_demo = 1`).get() as { n: number }).n
    for (const t of ['companies', 'invoices', 'activities', 'promises', 'litigation_cases', 'deposit_batches', 'bank_statements', 'rejections']) expect(count(t)).toBe(0)
    expect(trash.list().length).toBeGreaterThanOrEqual(0)
  })
})
