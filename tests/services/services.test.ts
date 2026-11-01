// Tests d'intégration des services sur une vraie base SQLite chiffrée (exécutés via Electron).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openDatabase, setDb, closeDatabase } from '../../src/main/db/connection'
import { companies } from '../../src/main/services/companies'
import { invoices } from '../../src/main/services/invoices'
import { payments } from '../../src/main/services/payments'
import { reminders } from '../../src/main/services/reminders'
import { trash } from '../../src/main/services/trash'
import { dashboard } from '../../src/main/services/dashboard'
import { demo } from '../../src/main/services/demo'
import { search } from '../../src/main/services/search'
import { addDays, todayISO } from '@shared/dates'

const dir = mkdtempSync(join(tmpdir(), 'recouvrement-test-'))
const file = join(dir, 'test.db')
const today = todayISO()
let A = 0
let conv = 0

beforeAll(() => {
  setDb(openDatabase(file, randomBytes(32).toString('hex')))
  A = companies.create({ name: 'Pétrole Test', type: 'petrolier', default_currency: 'XAF', payment_terms_days: 60 }).id
  companies.saveContact(null, { company_id: A, role: 'compta_fournisseurs', full_name: 'Jean Test', email: 'ap@test.example', whatsapp: '06 123 45 67', is_primary: true })
  conv = companies.saveConvention(null, {
    company_id: A,
    reference: 'CONV-1',
    start_date: '2026-01-01',
    payment_terms_days: 45,
    terms_start: 'depot',
    penalty_type: 'taux_annuel',
    penalty_rate: 12,
    currency: 'XAF',
    status: 'active'
  }).id
})

afterAll(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

const base = (o: Record<string, unknown> = {}) => ({
  number: `F-${Math.random().toString(36).slice(2, 8)}`,
  company_id: A,
  convention_id: conv,
  patient_name: 'Patient X',
  beneficiary_type: 'salarie' as const,
  issue_date: addDays(today, -100),
  amount_minor: 1_000_000,
  currency: 'XAF' as const,
  workflow_status: 'envoyee' as const,
  ...o
})

describe('base chiffrée', () => {
  it('le fichier n’est pas lisible en clair', () => {
    expect(readFileSync(file).subarray(0, 15).toString()).not.toBe('SQLite format 3')
  })
  it('les modèles et le scénario par défaut sont créés', () => {
    expect(reminders.templates().length).toBeGreaterThanOrEqual(6)
    expect(reminders.scenario().steps.map((s) => s.offset_days)).toEqual([3, 15, 30])
  })
})

describe('factures', () => {
  it('calcule l’échéance depuis le dépôt et refuse les doublons', () => {
    const { id } = invoices.create(base({ number: 'DUP-1', deposit_date: addDays(today, -95) }))
    expect(invoices.get(id).invoice.due_date).toBe(addDays(today, -50))
    expect(() => invoices.create(base({ number: 'dup-1' }))).toThrow(/existe déjà/)
  })

  it('contrôle le plafond du bon de prise en charge', () => {
    invoices.create(base({ voucher_number: 'BON-9', voucher_ceiling_minor: 1_500_000, amount_minor: 1_000_000 }))
    expect(() => invoices.create(base({ voucher_number: 'BON-9', amount_minor: 600_000 }))).toThrow(/Plafond du bon/)
    expect(() => invoices.create(base({ voucher_number: 'BON-9', amount_minor: 500_000 }))).not.toThrow()
  })

  it('rejet puis re-dépôt : le délai repart', () => {
    const { id } = invoices.create(base({ deposit_date: addDays(today, -90) }))
    const r = invoices.applyAction({ ids: [id], action: 'rejeter', reason_code: 'po_manquant' })
    expect(r.done).toBe(1)
    expect(invoices.get(id).invoice.status).toBe('rejetee')
    invoices.applyAction({ ids: [id], action: 'redeposer', date: today })
    const after = invoices.get(id)
    expect(after.invoice.status).toBe('envoyee')
    expect(after.invoice.due_date).toBe(addDays(today, 45))
    expect(after.events.some((e) => e.type === 'redepot')).toBe(true)
  })

  it('filtres, tri et pagination', () => {
    const res = invoices.list({ company_id: A, page_size: 10, sort: 'amount', dir: 'desc' })
    expect(res.total).toBeGreaterThan(3)
    expect(res.rows.length).toBeLessThanOrEqual(10)
    const late = invoices.list({ overdue_only: true })
    expect(late.rows.every((r) => r.days_late > 0)).toBe(true)
  })
})

describe('paiements et avoirs', () => {
  it('impute un paiement sur plusieurs factures et met à jour les statuts', () => {
    const f1 = invoices.create(base({ amount_minor: 300_000 })).id
    const f2 = invoices.create(base({ amount_minor: 500_000 })).id
    const { id } = payments.create({
      company_id: A,
      received_at: today,
      method: 'virement',
      amount_minor: 600_000,
      currency: 'XAF',
      allocations: [
        { invoice_id: f1, amount_minor: 300_000 },
        { invoice_id: f2, amount_minor: 300_000 }
      ]
    })
    expect(invoices.get(f1).invoice.status).toBe('soldee')
    expect(invoices.get(f2).invoice.status).toBe('partiellement_payee')
    expect(invoices.get(f2).invoice.balance_minor).toBe(200_000)
    // Sur-imputation refusée
    expect(() =>
      payments.create({ company_id: A, received_at: today, method: 'cheque', amount_minor: 900_000, currency: 'XAF', allocations: [{ invoice_id: f2, amount_minor: 250_000 }] })
    ).toThrow(/reste dû/)
    // Suppression du paiement → statuts recalculés, puis restauration
    payments.remove(id)
    expect(invoices.get(f1).invoice.status).toBe('envoyee')
    trash.restore('payment', id)
    expect(invoices.get(f1).invoice.status).toBe('soldee')
  })

  it('un avoir réduit le reste dû et ne peut pas le dépasser', () => {
    const f = invoices.create(base({ amount_minor: 400_000 })).id
    expect(() => invoices.createCreditNote({ invoice_id: f, number: 'AV-X', issue_date: today, amount_minor: 500_000, notes: 'trop' })).toThrow(/dépasse/)
    invoices.createCreditNote({ invoice_id: f, number: 'AV-1', issue_date: today, amount_minor: 100_000, notes: 'remise' })
    expect(invoices.get(f).invoice.balance_minor).toBe(300_000)
  })

  it('suggestion d’imputation : plus anciennes d’abord', () => {
    const s = payments.suggest({ company_id: A, currency: 'XAF', amount_minor: 1_200_000 })
    const dues = s.allocations.map((a) => s.open.find((o) => o.id === a.invoice_id)!.due_date)
    expect([...dues].sort()).toEqual(dues)
  })
})

describe('relances', () => {
  it('génère les relances du jour une seule fois, regroupées par entreprise', () => {
    const first = reminders.generate()
    const tasks = reminders.tasks()
    expect(first.created).toBeGreaterThan(0)
    expect(tasks.filter((t) => t.company_id === A).length).toBe(1)
    expect(reminders.generate().created).toBe(0)
    const t = tasks[0]
    const c = reminders.compose({ company_id: t.company_id, invoice_ids: t.invoices.map((i) => i.id), template_id: t.template_id, channel: t.channel })
    expect(c.body).toContain('Madame, Monsieur')
    expect(c.contact_id).not.toBeNull() // l'interlocuteur de la comptabilité fournisseurs est proposé
    expect(c.body).toContain('Facture n° DUP-1')
    expect(c.body).not.toMatch(/\{[a-z_]+\}/)
  })
})

describe('corbeille', () => {
  it('une facture payée ne peut pas être supprimée ; une facture libre va à la corbeille puis revient', () => {
    const paid = invoices.list({ statuses: ['soldee'] }).rows[0]
    expect(invoices.remove([paid.id]).blocked.length).toBe(1)
    const f = invoices.create(base()).id
    expect(invoices.remove([f]).done).toBe(1)
    expect(trash.list().some((i) => i.type === 'invoice' && i.id === f)).toBe(true)
    trash.restore('invoice', f)
    expect(invoices.get(f).invoice.number).toBeTruthy()
  })
})

describe('démonstration, tableau de bord, recherche', () => {
  it('charge ~40 factures fictives, alimente le tableau de bord, puis s’efface', () => {
    demo.load()
    const n = invoices.list({ search: 'DEMO-', kind: 'all', page_size: 100 }).total
    expect(n).toBeGreaterThanOrEqual(40)
    const d = dashboard.summary()
    expect(d.outstanding).toBeGreaterThan(0)
    expect(d.monthly).toHaveLength(12)
    expect(search.global('DEMO-2026-0001').invoices[0].number).toBe('DEMO-2026-0001')
    demo.clear()
    expect(invoices.list({ search: 'DEMO-', kind: 'all' }).total).toBe(0)
    expect(companies.list().map((c) => c.name)).toEqual(['Pétrole Test'])
  })
})
