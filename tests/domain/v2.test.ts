import { describe, expect, it } from 'vitest'
import { evaluatePromise, prescription, voucherState } from '@shared/domain/followup'
import { companyScore, invoicesCited, suggestMatches, type MatchInvoice } from '@shared/domain/matching'
import { planReminders } from '@shared/domain/reminders'

describe('promesses de paiement', () => {
  const today = '2026-12-10'
  it('en attente tant que la date n’est pas passée', () => {
    expect(evaluatePromise({ amount: 1000, promisedDate: '2026-12-10', paidSince: 0, today })).toBe('en_attente')
  })
  it('tenue dès que le montant est payé, même avant la date', () => {
    expect(evaluatePromise({ amount: 1000, promisedDate: '2026-12-20', paidSince: 1000, today })).toBe('tenue')
  })
  it('non tenue / partielle le lendemain de la date promise', () => {
    expect(evaluatePromise({ amount: 1000, promisedDate: '2026-12-09', paidSince: 0, today })).toBe('non_tenue')
    expect(evaluatePromise({ amount: 1000, promisedDate: '2026-12-09', paidSince: 400, today })).toBe('partielle')
  })
  it('une promesse en cours suspend les relances automatiques', () => {
    const steps = new Map([[null, [{ id: 1, offsetDays: 3 }]]])
    const c = { invoiceId: 1, companyId: 1, scenarioId: null, dueDate: '2026-11-01', balance: 10, status: 'envoyee' as const, handledStepIds: [] }
    expect(planReminders([{ ...c, hasPendingPromise: true }], steps, today)).toEqual([])
    expect(planReminders([c], steps, today)).toHaveLength(1)
  })
})

describe('bons de prise en charge', () => {
  const base = { status: 'actif', validUntil: '2026-12-31', ceiling: 1000, used: 0, today: '2026-12-01', warnDays: 15 }
  it('valide, expire bientôt, expiré', () => {
    expect(voucherState(base)).toBe('actif')
    expect(voucherState({ ...base, today: '2026-12-20' })).toBe('expire_bientot')
    expect(voucherState({ ...base, today: '2027-01-01' })).toBe('expire')
  })
  it('plafond atteint et annulé', () => {
    expect(voucherState({ ...base, used: 1000 })).toBe('consomme')
    expect(voucherState({ ...base, status: 'annule' })).toBe('annule')
  })
  it('sans date ni plafond : valide', () => {
    expect(voucherState({ ...base, validUntil: null, ceiling: null })).toBe('actif')
  })
})

describe('prescription', () => {
  it('5 ans après l’échéance, alerte à 6 mois, critique à 3 mois', () => {
    expect(prescription('2022-01-15', 5, '2026-06-01')).toEqual({ date: '2027-01-15', daysLeft: 228, level: null })
    expect(prescription('2022-01-15', 5, '2026-08-01').level).toBe('alerte')
    expect(prescription('2022-01-15', 5, '2026-11-01').level).toBe('critique')
    expect(prescription('2022-01-15', 5, '2027-01-15').level).toBe('prescrite')
  })
})

describe('rapprochement bancaire', () => {
  const inv = (o: Partial<MatchInvoice>): MatchInvoice => ({
    id: 1,
    number: 'FAC-2026-0012',
    company_id: 10,
    company_name: 'Kouilou Énergie SA',
    company_short: 'KESA',
    balance: 500_000,
    currency: 'XAF',
    due_date: '2026-10-01',
    issue_date: '2026-08-01',
    ...o
  })
  const line = (label: string, amount: number) => ({ date: '2026-12-01', label, reference: null, amount, currency: 'XAF' as const })

  it('reconnaît le nom ou le sigle de l’entreprise', () => {
    expect(companyScore('VIR RECU KOUILOU ENERGIE', 'Kouilou Énergie SA', null)).toBe(1)
    expect(companyScore('VIREMENT KESA OCT', 'Kouilou Énergie SA', 'KESA')).toBe(1)
    expect(companyScore('VIREMENT ATLANTIQUE', 'Kouilou Énergie SA', null)).toBe(0)
  })
  it('retrouve un n° de facture écrit sans tirets', () => {
    expect(invoicesCited('VIR FAC2026 0012 HOPITAL', [inv({})])).toHaveLength(1)
    expect(invoicesCited('VIR 12', [inv({ number: '12' })])).toHaveLength(0) // trop court : ignoré
  })
  it('priorité au n° de facture cité dans le libellé', () => {
    const s = suggestMatches(line('VIREMENT FACTURE FAC-2026-0012', 500_000), [inv({}), inv({ id: 2, number: 'FAC-2026-0099' })], [])
    expect(s[0].allocations).toEqual([{ invoice_id: 1, number: 'FAC-2026-0012', amount: 500_000 }])
    expect(s[0].score).toBe(100)
  })
  it('paiement groupé : montant égal au total dû par l’entreprise', () => {
    const s = suggestMatches(line('VIR KOUILOU ENERGIE', 800_000), [inv({}), inv({ id: 2, number: 'FAC-2026-0020', balance: 300_000 })], [])
    expect(s[0].allocations.map((a) => a.invoice_id).sort()).toEqual([1, 2])
  })
  it('propose d’associer un paiement déjà saisi à la main', () => {
    const s = suggestMatches(line('VIR', 500_000), [], [{ id: 7, company_id: 10, company_name: 'Kouilou', amount: 500_000, currency: 'XAF', received_at: '2026-11-28' }])
    expect(s[0]).toMatchObject({ kind: 'paiement', payment_id: 7 })
  })
  it('ignore les autres devises et les débits', () => {
    expect(suggestMatches(line('FAC-2026-0012', 500_000), [inv({ currency: 'USD' })], [])).toEqual([])
    expect(suggestMatches(line('FAC-2026-0012', -500_000), [inv({})], [])).toEqual([])
  })
})
