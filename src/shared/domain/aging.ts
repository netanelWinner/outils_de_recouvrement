// Balance âgée : répartition des sommes dues selon le nombre de jours de retard.
import type { AgingBucket } from '../constants'
import { diffDays } from '../dates'

export type AgingTotals = Record<AgingBucket, number>

export interface AgingItem {
  companyId: number
  companyName: string
  dueDate: string
  /** Reste dû, converti en FCFA. */
  balanceXaf: number
}

export interface AgingRow {
  companyId: number
  companyName: string
  buckets: AgingTotals
  total: number
}

export interface AgingResult {
  totals: AgingTotals
  total: number
  rows: AgingRow[]
}

export const emptyBuckets = (): AgingTotals => ({ non_echu: 0, j0_30: 0, j31_60: 0, j61_90: 0, j90_plus: 0 })

/** Retard en jours → tranche. Une facture échue aujourd'hui n'est pas encore en retard. */
export function bucketFor(daysLate: number): AgingBucket {
  if (daysLate <= 0) return 'non_echu'
  if (daysLate <= 30) return 'j0_30'
  if (daysLate <= 60) return 'j31_60'
  if (daysLate <= 90) return 'j61_90'
  return 'j90_plus'
}

export function daysLate(dueDate: string, asOf: string): number {
  return Math.max(0, diffDays(asOf, dueDate))
}

export function computeAging(items: AgingItem[], asOf: string): AgingResult {
  const totals = emptyBuckets()
  const byCompany = new Map<number, AgingRow>()
  for (const it of items) {
    if (it.balanceXaf <= 0) continue
    const bucket = bucketFor(diffDays(asOf, it.dueDate))
    totals[bucket] += it.balanceXaf
    let row = byCompany.get(it.companyId)
    if (!row) {
      row = { companyId: it.companyId, companyName: it.companyName, buckets: emptyBuckets(), total: 0 }
      byCompany.set(it.companyId, row)
    }
    row.buckets[bucket] += it.balanceXaf
    row.total += it.balanceXaf
  }
  const total = Object.values(totals).reduce((a, b) => a + b, 0)
  const rows = [...byCompany.values()].sort((a, b) => b.total - a.total)
  return { totals, total, rows }
}
