import { describe, expect, it } from 'vitest'
import { formatMoney, parseAmount, toXaf } from '@shared/money'
import { addMonths, diffDays, parseDateFlexible } from '@shared/dates'
import { computeDso, recoveryRate } from '@shared/domain/kpi'
import { findMedicalTerms } from '@shared/medical'

describe('montants', () => {
  it('formate en français', () => {
    expect(formatMoney(1_250_000, 'XAF')).toBe('1 250 000 FCFA')
    expect(formatMoney(125_050, 'USD')).toBe('1 250,50 USD')
    expect(formatMoney(-500, 'XAF', false)).toBe('-500')
  })
  it('lit les saisies courantes', () => {
    expect(parseAmount('1 250 000', 'XAF')).toBe(1_250_000)
    expect(parseAmount('1.250.000', 'XAF')).toBe(1_250_000)
    expect(parseAmount('1250,50', 'USD')).toBe(125_050)
    expect(parseAmount('1.250,50', 'EUR')).toBe(125_050)
    expect(parseAmount('1,250.50', 'USD')).toBe(125_050)
    expect(parseAmount('12 500 FCFA', 'XAF')).toBe(12_500)
    expect(parseAmount(3000, 'XAF')).toBe(3000)
    expect(parseAmount('abc', 'XAF')).toBeNull()
    expect(parseAmount('', 'XAF')).toBeNull()
  })
  it('convertit en FCFA (parité fixe EUR)', () => {
    expect(toXaf(100_00, 'EUR', 600)).toBe(65_596)
    expect(toXaf(100_00, 'USD', 600)).toBe(60_000)
    expect(toXaf(5000, 'XAF', 600)).toBe(5000)
  })
})

describe('dates', () => {
  it('lit les formats Excel et français', () => {
    expect(parseDateFlexible('02/11/2026')).toBe('2026-11-02')
    expect(parseDateFlexible('2/11/26')).toBe('2026-11-02')
    expect(parseDateFlexible('2026-11-02')).toBe('2026-11-02')
    expect(parseDateFlexible(new Date(Date.UTC(2026, 10, 2)))).toBe('2026-11-02')
    expect(parseDateFlexible(46328)).toBe('2026-11-02')
    expect(parseDateFlexible('31/02/2026')).toBeNull()
  })
  it('calcule les écarts et ajoute des mois', () => {
    expect(diffDays('2027-01-01', '2026-12-01')).toBe(31)
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })
})

describe('indicateurs', () => {
  it('DSO et taux de recouvrement', () => {
    expect(computeDso(30_000_000, 45_000_000, 90)).toBe(60)
    expect(computeDso(1, 0)).toBeNull()
    expect(recoveryRate(1000, 755)).toBe(75.5)
  })
})

describe('confidentialité médicale', () => {
  it('détecte les termes médicaux', () => {
    expect(findMedicalTerms('Patient suivi pour paludisme')).toEqual(['paludisme'])
    expect(findMedicalTerms('Facture janvier, bon n° 45')).toEqual([])
  })
})
