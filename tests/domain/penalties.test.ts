import { describe, expect, it } from 'vitest'
import { computePenalty } from '@shared/domain/penalties'
import { computeDueDate } from '@shared/domain/dueDates'

describe('pénalités de retard', () => {
  it('taux annuel au prorata des jours', () => {
    // 1 000 000 FCFA à 12 %/an pendant 73 jours = 24 000
    expect(computePenalty(1_000_000, 73, { type: 'taux_annuel', rate: 12, fixed: 0, graceDays: 0 })).toBe(24_000)
  })
  it('taux mensuel avec délai de grâce', () => {
    // 45 jours de retard - 15 de grâce = 30 jours = 1 mois à 1,5 %
    expect(computePenalty(2_000_000, 45, { type: 'taux_mensuel', rate: 1.5, fixed: 0, graceDays: 15 })).toBe(30_000)
  })
  it('aucune pénalité pendant le délai de grâce', () => {
    expect(computePenalty(2_000_000, 10, { type: 'taux_mensuel', rate: 1.5, fixed: 0, graceDays: 15 })).toBe(0)
  })
  it('forfait fixe dès le premier jour de retard', () => {
    expect(computePenalty(500_000, 1, { type: 'forfait', rate: 0, fixed: 25_000, graceDays: 0 })).toBe(25_000)
    expect(computePenalty(500_000, 0, { type: 'forfait', rate: 0, fixed: 25_000, graceDays: 0 })).toBe(0)
  })
  it('rien si pas de règle, pas de solde ou type « aucune »', () => {
    expect(computePenalty(500_000, 30, null)).toBe(0)
    expect(computePenalty(0, 30, { type: 'taux_annuel', rate: 10, fixed: 0, graceDays: 0 })).toBe(0)
    expect(computePenalty(500_000, 30, { type: 'aucune', rate: 10, fixed: 0, graceDays: 0 })).toBe(0)
  })
})

describe('échéance', () => {
  it('à partir de la date d’émission', () => {
    expect(computeDueDate({ issueDate: '2026-11-15', depositDate: '2026-11-20', termsDays: 60, termsStart: 'emission' })).toBe('2027-01-14')
  })
  it('à partir du dépôt, avec repli sur l’émission si pas encore déposée', () => {
    expect(computeDueDate({ issueDate: '2026-11-15', depositDate: '2026-11-20', termsDays: 45, termsStart: 'depot' })).toBe('2027-01-04')
    expect(computeDueDate({ issueDate: '2026-11-15', depositDate: null, termsDays: 45, termsStart: 'depot' })).toBe('2026-12-30')
  })
  it('un re-dépôt après rejet fait repartir le délai', () => {
    const first = computeDueDate({ issueDate: '2026-10-01', depositDate: '2026-10-05', termsDays: 90, termsStart: 'depot' })
    const after = computeDueDate({ issueDate: '2026-10-01', depositDate: '2026-12-10', termsDays: 90, termsStart: 'depot' })
    expect(first).toBe('2027-01-03')
    expect(after).toBe('2027-03-10')
  })
})
