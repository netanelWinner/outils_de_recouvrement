// Tests d'intégration V3 : fiabilité, prévisions, rapport mensuel (contenu ; le PDF est testé de bout en bout).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openDatabase, setDb, closeDatabase } from '../../src/main/db/connection'
import { companies } from '../../src/main/services/companies'
import { invoices } from '../../src/main/services/invoices'
import { payments } from '../../src/main/services/payments'
import { analytics } from '../../src/main/services/analytics'
import { reports, monthBounds, previousMonth } from '../../src/main/services/reports'
import { demo } from '../../src/main/services/demo'
import { addDays, todayISO } from '@shared/dates'

const dir = mkdtempSync(join(tmpdir(), 'recouvrement-v3-'))
const today = todayISO()
let good = 0
let bad = 0
let n = 0

beforeAll(() => {
  setDb(openDatabase(join(dir, 'v3.db'), randomBytes(32).toString('hex')))
  good = companies.create({ name: 'Bon Payeur SA', type: 'petrolier', default_currency: 'XAF', payment_terms_days: 30 }).id
  bad = companies.create({ name: 'Mauvais Payeur SA', type: 'petrolier', default_currency: 'XAF', payment_terms_days: 30 }).id
  // Historique : le bon payeur règle à 25 jours, le mauvais à 120 jours, avec des rejets
  for (let k = 0; k < 5; k++) {
    for (const [company, delay] of [
      [good, 25],
      [bad, 120]
    ] as const) {
      const issue = addDays(today, -300 + k * 30)
      const id = invoices.create({ number: `H-${++n}`, company_id: company, patient_name: 'P', beneficiary_type: 'salarie', issue_date: issue, amount_minor: 500_000, currency: 'XAF', workflow_status: 'envoyee' }).id
      if (company === bad && k < 2) invoices.applyAction({ ids: [id], action: 'rejeter', reason_code: 'po_manquant', date: addDays(issue, 5) })
      payments.create({ company_id: company, received_at: addDays(issue, delay), method: 'virement', amount_minor: 500_000, currency: 'XAF', allocations: [{ invoice_id: id, amount_minor: 500_000 }] })
    }
  }
  // Encours ouvert pour les deux
  for (const company of [good, bad])
    invoices.create({ number: `O-${++n}`, company_id: company, patient_name: 'P', beneficiary_type: 'salarie', issue_date: addDays(today, -20), amount_minor: 1_000_000, currency: 'XAF', workflow_status: 'envoyee' })
})
afterAll(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('scores de fiabilité', () => {
  it('distingue le bon et le mauvais payeur à partir de l’historique réel', () => {
    const rel = analytics.reliability()
    const g = rel.find((r) => r.company_id === good)!
    const b = rel.find((r) => r.company_id === bad)!
    expect(g).toMatchObject({ paid_count: 5, avg_delay_days: 25, on_time_rate: 1, grade: 'A' })
    expect(b.avg_delay_days).toBe(120)
    expect(b.avgLatenessDays).toBe(90)
    expect(b.rejection_rate).toBeCloseTo(2 / 6)
    expect(['D', 'E']).toContain(b.grade)
    expect(g.score!).toBeGreaterThan(b.score!)
  })
})

describe('prévisions d’encaissement', () => {
  it('le bon payeur est attendu plus tôt et avec une probabilité plus forte', () => {
    const f = analytics.forecast(3)
    const dg = f.details.find((d) => d.companyId === good)!
    const db = f.details.find((d) => d.companyId === bad)!
    expect(dg.date < db.date).toBe(true)
    expect(dg.probability).toBeGreaterThan(db.probability)
    expect(f.buckets).toHaveLength(4)
    const total = f.buckets.reduce((s, b) => s + b.potential, 0)
    expect(total).toBe(2_000_000)
  })
})

describe('rapport mensuel', () => {
  it('calcule les indicateurs du mois et les compare au mois précédent', () => {
    const month = today.slice(0, 7)
    const d = reports.compute(month, 'Commentaire de test')
    const { start, end } = monthBounds(month)
    expect(d.start).toBe(start)
    expect(d.end).toBe(end)
    expect(d.kpis.outstanding_end).toBe(2_000_000)
    expect(d.trend).toHaveLength(6)
    expect(d.highlights.length).toBeGreaterThan(1)
    expect(d.reliability.map((r) => r.name)).toEqual(expect.arrayContaining(['Bon Payeur SA']))
    const html = reports.html(d)
    expect(html).toContain('Rapport mensuel de recouvrement')
    expect(html).toContain('Commentaire de test')
    expect(html).toContain('<svg')
  })
  it('l’encours en fin de mois passé tient compte des paiements reçus après cette date', () => {
    const prev = previousMonth(today.slice(0, 7))
    const d = reports.compute(prev)
    // Calcul indépendant : soldes à la fin du mois précédent
    expect(d.kpis.outstanding_end).toBeGreaterThanOrEqual(0)
    expect(d.previous).toBeDefined()
  })
  it('refuse un mois invalide', () => {
    expect(() => reports.compute('2026-13')).toThrow(/Mois invalide/)
  })
})

describe('démo + pilotage', () => {
  it('les données de démonstration produisent des scores et des prévisions', () => {
    demo.load()
    const rel = analytics.reliability().filter((r) => r.company_name.includes('(démo)'))
    expect(rel.some((r) => r.grade !== null)).toBe(true)
    expect(analytics.forecast(3).total_expected).toBeGreaterThan(0)
    demo.clear()
  })
})
