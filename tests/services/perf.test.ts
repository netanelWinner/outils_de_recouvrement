// Performances avec plusieurs milliers de factures (exigence du cahier des charges).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openDatabase, setDb, closeDatabase, db } from '../../src/main/db/connection'
import { invoices } from '../../src/main/services/invoices'
import { dashboard } from '../../src/main/services/dashboard'
import { reminders } from '../../src/main/services/reminders'
import { search } from '../../src/main/services/search'
import { companies } from '../../src/main/services/companies'
import { agenda } from '../../src/main/services/agenda'
import { addDays, todayISO } from '@shared/dates'

const dir = mkdtempSync(join(tmpdir(), 'recouvrement-perf-'))
const N = 6000

beforeAll(() => {
  setDb(openDatabase(join(dir, 'perf.db'), randomBytes(32).toString('hex')))
  const today = todayISO()
  db().transaction(() => {
    const insC = db().prepare('INSERT INTO companies (name, payment_terms_days) VALUES (?, 60)')
    for (let c = 1; c <= 60; c++) insC.run(`Entreprise ${c}`)
    const ins = db().prepare(`INSERT INTO invoices (number, company_id, patient_name, issue_date, due_date, amount_minor, workflow_status, status, paid_minor)
      VALUES (?,?,?,?,?,?,?,?,?)`)
    const st = ['envoyee', 'acceptee', 'partiellement_payee', 'soldee', 'rejetee']
    for (let i = 0; i < N; i++) {
      const issue = addDays(today, -(i % 700))
      const s = st[i % st.length]
      const amount = 50_000 + (i % 97) * 10_000
      ins.run(`F-${100000 + i}`, 1 + (i % 60), `Patient ${i % 900}`, issue, addDays(issue, 60), amount, s === 'soldee' || s === 'partiellement_payee' ? 'acceptee' : s, s, s === 'soldee' ? amount : s === 'partiellement_payee' ? amount / 2 : 0)
    }
  })()
})
afterAll(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

const time = (fn: () => unknown) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}

describe(`${N} factures`, () => {
  it('liste filtrée, triée et paginée en moins de 300 ms', () => {
    expect(time(() => invoices.list({ overdue_only: true, sort: 'days_late', dir: 'desc', page_size: 50 }))).toBeLessThan(300)
    expect(time(() => invoices.list({ search: 'Patient 12', page: 3 }))).toBeLessThan(300)
  })
  it('recherche globale en moins de 200 ms', () => {
    expect(time(() => search.global('F-1054'))).toBeLessThan(200)
  })
  it('tableau de bord, liste des entreprises et agenda en moins d’une seconde', () => {
    expect(time(() => dashboard.summary())).toBeLessThan(1000)
    expect(time(() => companies.list({ sort: 'outstanding' }))).toBeLessThan(1000)
    expect(time(() => agenda.today())).toBeLessThan(1000)
  })
  it('génération des relances du jour en moins de 2 secondes', () => {
    expect(time(() => reminders.generate())).toBeLessThan(2000)
    expect(time(() => reminders.tasks())).toBeLessThan(1500)
  })
})
