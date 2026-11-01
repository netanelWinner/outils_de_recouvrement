import { describe, expect, it } from 'vitest'
import { bucketFor, computeAging } from '@shared/domain/aging'

describe('balance âgée', () => {
  it('classe les retards dans les bonnes tranches (bornes incluses)', () => {
    expect(bucketFor(-10)).toBe('non_echu')
    expect(bucketFor(0)).toBe('non_echu')
    expect(bucketFor(1)).toBe('j0_30')
    expect(bucketFor(30)).toBe('j0_30')
    expect(bucketFor(31)).toBe('j31_60')
    expect(bucketFor(60)).toBe('j31_60')
    expect(bucketFor(61)).toBe('j61_90')
    expect(bucketFor(90)).toBe('j61_90')
    expect(bucketFor(91)).toBe('j90_plus')
  })

  it('totalise par tranche et par entreprise, triées par encours décroissant', () => {
    const asOf = '2026-12-31'
    const res = computeAging(
      [
        { companyId: 1, companyName: 'A', dueDate: '2027-01-15', balanceXaf: 100 }, // non échu
        { companyId: 1, companyName: 'A', dueDate: '2026-12-21', balanceXaf: 200 }, // 10 j
        { companyId: 2, companyName: 'B', dueDate: '2026-11-01', balanceXaf: 1000 }, // 60 j
        { companyId: 2, companyName: 'B', dueDate: '2026-08-01', balanceXaf: 500 }, // 152 j
        { companyId: 3, companyName: 'C', dueDate: '2026-08-01', balanceXaf: 0 } // soldée : ignorée
      ],
      asOf
    )
    expect(res.totals).toEqual({ non_echu: 100, j0_30: 200, j31_60: 1000, j61_90: 0, j90_plus: 500 })
    expect(res.total).toBe(1800)
    expect(res.rows.map((r) => r.companyName)).toEqual(['B', 'A'])
    expect(res.rows[0].buckets.j90_plus).toBe(500)
  })
})
