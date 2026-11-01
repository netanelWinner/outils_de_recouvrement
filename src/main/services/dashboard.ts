// Indicateurs du tableau de bord (montants consolidés en FCFA).
import { db } from '../db/connection'
import { BALANCE, RECEIVABLE, balanceXafSql, usdRate } from '../db/sql'
import { xafSql } from '@shared/money'
import { addDays, addMonths, todayISO } from '@shared/dates'
import { computeAging } from '@shared/domain/aging'
import { computeDso, lastMonths, recoveryRate } from '@shared/domain/kpi'
import type { Currency } from '@shared/constants'

export const dashboard = {
  summary() {
    const today = todayISO()
    const x = balanceXafSql()
    const rate = usdRate()
    const items = db()
      .prepare(`SELECT i.company_id, c.name AS company_name, i.due_date, ${x} AS bx FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE ${RECEIVABLE} AND ${BALANCE} > 0`)
      .all() as { company_id: number; company_name: string; due_date: string; bx: number }[]
    const aging = computeAging(
      items.map((i) => ({ companyId: i.company_id, companyName: i.company_name, dueDate: i.due_date, balanceXaf: i.bx })),
      today
    )
    const overdueItems = items.filter((i) => i.due_date < today)
    const overdue = overdueItems.reduce((s, i) => s + i.bx, 0)

    // Taux de recouvrement sur les factures émises depuis 12 mois (hors brouillons / annulées)
    const since12 = addMonths(today, -12)
    const amountX = xafSql('i.amount_minor', 'i.currency', rate)
    const netX = xafSql('(i.amount_minor - i.credited_minor)', 'i.currency', rate)
    const paidX = xafSql('i.paid_minor', 'i.currency', rate)
    const r12 = db()
      .prepare(`SELECT COALESCE(SUM(${netX}),0) AS billed, COALESCE(SUM(${paidX}),0) AS collected FROM invoices i
        WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.status NOT IN ('brouillon','annulee') AND i.issue_date >= ?`)
      .get(since12) as { billed: number; collected: number }
    const billed90 = (db()
      .prepare(`SELECT COALESCE(SUM(${amountX}),0) AS s FROM invoices i WHERE i.deleted_at IS NULL AND i.kind = 'facture'
        AND i.status NOT IN ('brouillon','annulee') AND i.issue_date > ?`)
      .get(addDays(today, -90)) as { s: number }).s

    // Évolution mensuelle : facturé vs encaissé
    const months = lastMonths(today, 12)
    const billedByMonth = new Map(
      (db()
        .prepare(`SELECT substr(i.issue_date,1,7) AS m, SUM(${amountX}) AS s FROM invoices i WHERE i.deleted_at IS NULL AND i.kind = 'facture'
          AND i.status NOT IN ('brouillon','annulee') AND i.issue_date >= ? GROUP BY m`)
        .all(months[0] + '-01') as { m: string; s: number }[]).map((r) => [r.m, r.s])
    )
    const payX = xafSql('p.amount_minor', 'p.currency', rate)
    const collectedByMonth = new Map(
      (db()
        .prepare(`SELECT substr(p.received_at,1,7) AS m, SUM(${payX}) AS s FROM payments p WHERE p.deleted_at IS NULL AND p.received_at >= ? GROUP BY m`)
        .all(months[0] + '-01') as { m: string; s: number }[]).map((r) => [r.m, r.s])
    )
    const monthly = months.map((m) => ({ month: m, billed: billedByMonth.get(m) ?? 0, collected: collectedByMonth.get(m) ?? 0 }))

    const counts = db()
      .prepare(`SELECT
          SUM(CASE WHEN status = 'brouillon' THEN 1 ELSE 0 END) AS drafts,
          SUM(CASE WHEN status = 'rejetee' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'contentieux' THEN 1 ELSE 0 END) AS litigation
        FROM invoices WHERE deleted_at IS NULL AND kind = 'facture'`)
      .get() as { drafts: number | null; rejected: number | null; litigation: number | null }
    const byCurrency = db()
      .prepare(`SELECT i.currency, SUM(${BALANCE}) AS balance, count(*) AS n FROM invoices i WHERE ${RECEIVABLE} AND ${BALANCE} > 0 GROUP BY i.currency`)
      .all() as { currency: Currency; balance: number; n: number }[]
    const thisMonth = today.slice(0, 7)

    return {
      today,
      usd_rate: rate,
      outstanding: aging.total,
      open_count: items.length,
      overdue,
      overdue_count: overdueItems.length,
      aging: aging.totals,
      top_debtors: aging.rows.slice(0, 10),
      recovery_rate: recoveryRate(r12.billed, r12.collected),
      billed_12m: r12.billed,
      collected_12m: r12.collected,
      dso: computeDso(aging.total, billed90, 90),
      collected_this_month: collectedByMonth.get(thisMonth) ?? 0,
      monthly,
      drafts: counts.drafts ?? 0,
      rejected: counts.rejected ?? 0,
      litigation: counts.litigation ?? 0,
      by_currency: byCurrency
    }
  },

  /** Balance âgée détaillée par entreprise (export, relevé). */
  aging(companyId: number | null = null) {
    const x = balanceXafSql()
    const items = db()
      .prepare(`SELECT i.company_id, c.name AS company_name, i.due_date, ${x} AS bx FROM invoices i JOIN companies c ON c.id = i.company_id
        WHERE ${RECEIVABLE} AND ${BALANCE} > 0 ${companyId ? 'AND (i.company_id = @cid OR c.parent_company_id = @cid)' : ''}`)
      .all(companyId ? { cid: companyId } : {}) as { company_id: number; company_name: string; due_date: string; bx: number }[]
    return computeAging(
      items.map((i) => ({ companyId: i.company_id, companyName: i.company_name, dueDate: i.due_date, balanceXaf: i.bx })),
      todayISO()
    )
  }
}
