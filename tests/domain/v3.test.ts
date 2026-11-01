import { describe, expect, it } from 'vitest'
import { computeReliability, gradeFor } from '@shared/domain/scoring'
import { buildForecast, forecastInvoice, type ForecastItem } from '@shared/domain/forecast'
import { changesSince, compareVersions } from '@shared/version'

describe('score de fiabilité', () => {
  const good = { avgDelayDays: 55, avgTermsDays: 60, onTimeRate: 0.95, rejectionRate: 0.02, promiseKeptRate: 1, paidCount: 20 }
  it('un bon payeur obtient A', () => {
    const r = computeReliability(good)
    expect(r.grade).toBe('A')
    expect(r.avgLatenessDays).toBe(0)
  })
  it('un payeur très en retard avec beaucoup de rejets obtient E', () => {
    const r = computeReliability({ avgDelayDays: 150, avgTermsDays: 60, onTimeRate: 0.1, rejectionRate: 0.4, promiseKeptRate: 0.2, paidCount: 12 })
    expect(r.grade).toBe('E')
    expect(r.avgLatenessDays).toBe(90)
  })
  it('composante inconnue : poids redistribué', () => {
    const r = computeReliability({ ...good, promiseKeptRate: null })
    expect(r.score).toBeGreaterThanOrEqual(90)
  })
  it('pas de score sans historique suffisant', () => {
    expect(computeReliability({ ...good, paidCount: 2 })).toMatchObject({ score: null, grade: null, insufficient: true })
  })
  it('bornes des notes', () => {
    expect([gradeFor(80), gradeFor(79), gradeFor(65), gradeFor(50), gradeFor(35), gradeFor(34)]).toEqual(['A', 'B', 'B', 'C', 'D', 'E'])
  })
})

describe('prévisions d’encaissement', () => {
  const today = '2026-11-10'
  const base: ForecastItem = { invoiceId: 1, companyId: 1, balanceXaf: 1_000_000, dueDate: '2026-11-30', status: 'acceptee', companyLatenessDays: 20, companyGrade: 'B' }
  it('échéance + retard habituel, probabilité selon la note', () => {
    expect(forecastInvoice(base, today)).toMatchObject({ date: '2026-12-20', probability: 0.85 })
  })
  it('une promesse fixe la date', () => {
    expect(forecastInvoice({ ...base, promise: { date: '2026-11-15' } }, today)).toMatchObject({ date: '2026-11-15', probability: 0.9 })
  })
  it('contentieux : probabilité faible, à 3 mois', () => {
    expect(forecastInvoice({ ...base, status: 'contentieux' }, today)).toMatchObject({ date: '2027-02-08', probability: 0.25 })
  })
  it('rejet : re-dépôt nécessaire, date repoussée', () => {
    const r = forecastInvoice({ ...base, status: 'rejetee' }, today)
    expect(r.date).toBe('2026-12-25')
    expect(r.probability).toBeCloseTo(0.51)
  })
  it('très ancienne créance : décalée et dépréciée', () => {
    const r = forecastInvoice({ ...base, dueDate: '2026-04-01' }, today)
    expect(r.date).toBe('2026-12-01')
    expect(r.probability).toBeLessThan(0.3)
  })
  it('agrégation par mois avec colonne « au-delà »', () => {
    const f = buildForecast(
      [
        { ...base, invoiceId: 1, dueDate: '2026-11-01', companyLatenessDays: 5 }, // 06/11 < today → +21 j → déc.
        { ...base, invoiceId: 2, dueDate: '2026-11-15', companyLatenessDays: 0, companyGrade: 'A' }, // 15/11 → nov.
        { ...base, invoiceId: 3, dueDate: '2027-06-01' } // au-delà
      ],
      today,
      3
    )
    expect(f.buckets.map((b) => b.key)).toEqual(['2026-11', '2026-12', '2027-01', 'later'])
    expect(f.buckets[0]).toMatchObject({ potential: 1_000_000, expected: 950_000, count: 1 })
    expect(f.buckets[1].count).toBe(1)
    expect(f.buckets[3].count).toBe(1)
  })
})

describe('versions', () => {
  it('compare les numéros de version', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('1.0.9', '1.1.0')).toBe(-1)
  })
  it('« Quoi de neuf » : seulement les versions installées depuis la dernière vue', () => {
    expect(changesSince('1.1.0', '1.2.0').map((c) => c.version)).toEqual(['1.2.0'])
    expect(changesSince('1.0.0', '1.2.0').map((c) => c.version)).toEqual(['1.2.0', '1.1.0'])
    expect(changesSince('1.2.0', '1.2.0')).toEqual([])
  })
})
