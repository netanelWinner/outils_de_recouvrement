import { describe, expect, it } from 'vitest'
import { autoAllocate, deriveStatus, validateAllocations } from '@shared/domain/allocation'

const inv = (id: number, dueDate: string, balance: number) => ({ id, dueDate, issueDate: '2026-01-01', balance })

describe('imputation automatique', () => {
  it('impute sur les factures les plus anciennes d’abord', () => {
    const r = autoAllocate(1500, [inv(1, '2026-03-01', 1000), inv(2, '2026-01-01', 800), inv(3, '2026-02-01', 500)])
    expect(r.allocations).toEqual([
      { invoiceId: 2, amount: 800 },
      { invoiceId: 3, amount: 500 },
      { invoiceId: 1, amount: 200 }
    ])
    expect(r.remaining).toBe(0)
  })

  it('garde le reliquat quand le paiement dépasse le total dû', () => {
    const r = autoAllocate(2000, [inv(1, '2026-01-01', 1200)])
    expect(r.allocations).toEqual([{ invoiceId: 1, amount: 1200 }])
    expect(r.remaining).toBe(800)
  })

  it('ignore les factures sans reste dû', () => {
    const r = autoAllocate(100, [inv(1, '2026-01-01', 0), inv(2, '2026-02-01', 300)])
    expect(r.allocations).toEqual([{ invoiceId: 2, amount: 100 }])
  })
})

describe('contrôle de l’imputation', () => {
  const balances = new Map([
    [1, 1000],
    [2, 500]
  ])
  it('accepte une imputation correcte sur plusieurs factures', () => {
    expect(validateAllocations(1500, [{ invoiceId: 1, amount: 1000 }, { invoiceId: 2, amount: 500 }], balances)).toEqual([])
  })
  it('refuse un total supérieur au paiement', () => {
    expect(validateAllocations(1000, [{ invoiceId: 1, amount: 800 }, { invoiceId: 2, amount: 300 }], balances)).toContain(
      'Le total imputé dépasse le montant du paiement.'
    )
  })
  it('refuse une imputation supérieure au reste dû', () => {
    expect(validateAllocations(5000, [{ invoiceId: 2, amount: 600 }], balances)).toContain(
      'Le montant imputé dépasse le reste dû d’une facture.'
    )
  })
  it('refuse les montants nuls, les doublons et les factures inconnues', () => {
    const errs = validateAllocations(
      5000,
      [
        { invoiceId: 1, amount: 0 },
        { invoiceId: 1, amount: 10 },
        { invoiceId: 9, amount: 10 }
      ],
      balances
    )
    expect(errs.length).toBe(3)
  })
})

describe('statut calculé', () => {
  it('passe en partiellement payée puis soldée', () => {
    expect(deriveStatus('acceptee', 1000, 0, 0)).toBe('acceptee')
    expect(deriveStatus('acceptee', 1000, 400, 0)).toBe('partiellement_payee')
    expect(deriveStatus('envoyee', 1000, 600, 400)).toBe('soldee')
  })
  it('une facture entièrement couverte par avoir est annulée', () => {
    expect(deriveStatus('envoyee', 1000, 0, 1000)).toBe('annulee')
  })
  it('le contentieux reste affiché tant que tout n’est pas payé', () => {
    expect(deriveStatus('contentieux', 1000, 300, 0)).toBe('contentieux')
    expect(deriveStatus('contentieux', 1000, 1000, 0)).toBe('soldee')
  })
  it('une facture annulée reste annulée', () => {
    expect(deriveStatus('annulee', 1000, 0, 0)).toBe('annulee')
  })
})
