// Pilotage : scores de fiabilité des entreprises et prévisions d'encaissement.
import { db } from '../db/connection'
import { BALANCE, RECEIVABLE, usdRate } from '../db/sql'
import { toXaf } from '@shared/money'
import { diffDays, todayISO } from '@shared/dates'
import type { Currency, InvoiceStatus } from '@shared/constants'
import { computeReliability, type Reliability } from '@shared/domain/scoring'
import { buildForecast, type ForecastItem } from '@shared/domain/forecast'
import { activities } from './activities'

export interface ReliabilityRow extends Reliability {
  company_id: number
  company_name: string
  paid_count: number
  avg_delay_days: number | null
  avg_terms_days: number | null
  on_time_rate: number | null
  rejection_rate: number | null
  rejected_count: number
  deposited_count: number
  promise_kept_rate: number | null
  promises_count: number
  outstanding_xaf: number
}

/** Historique pris en compte : factures émises sur les 24 derniers mois. */
const HISTORY = `date('now','-24 months')`

export const analytics = {
  reliability(): ReliabilityRow[] {
    const rate = usdRate()
    const companies = db().prepare('SELECT id, name FROM companies WHERE deleted_at IS NULL ORDER BY name').all() as { id: number; name: string }[]

    // Factures soldées : délai réel = date du dernier paiement − date de départ (dépôt ou émission)
    const paid = db()
      .prepare(`SELECT i.company_id, i.amount_minor, i.currency, COALESCE(i.deposit_date, i.issue_date) AS start, i.due_date,
          (SELECT MAX(p.received_at) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = i.id AND p.deleted_at IS NULL) AS paid_at
        FROM invoices i WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.status = 'soldee' AND i.paid_minor > 0 AND i.issue_date >= ${HISTORY}`)
      .all() as { company_id: number; amount_minor: number; currency: Currency; start: string; due_date: string; paid_at: string | null }[]

    const rej = db()
      .prepare(`SELECT i.company_id, count(*) AS deposited, SUM(CASE WHEN EXISTS (SELECT 1 FROM rejections r WHERE r.invoice_id = i.id) THEN 1 ELSE 0 END) AS rejected
        FROM invoices i WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.workflow_status NOT IN ('brouillon','annulee') AND i.issue_date >= ${HISTORY}
        GROUP BY i.company_id`)
      .all() as { company_id: number; deposited: number; rejected: number }[]

    const prom = db()
      .prepare(`SELECT p.company_id, SUM(CASE WHEN p.status = 'tenue' THEN 1 ELSE 0 END) AS kept,
          SUM(CASE WHEN p.status IN ('tenue','partielle','non_tenue') THEN 1 ELSE 0 END) AS total
        FROM promises p JOIN activities a ON a.id = p.activity_id WHERE a.deleted_at IS NULL GROUP BY p.company_id`)
      .all() as { company_id: number; kept: number; total: number }[]

    const outstanding = db()
      .prepare(`SELECT i.company_id, i.currency, SUM(${BALANCE}) AS bal FROM invoices i WHERE ${RECEIVABLE} AND ${BALANCE} > 0 GROUP BY i.company_id, i.currency`)
      .all() as { company_id: number; currency: Currency; bal: number }[]

    return companies.map((c) => {
      let w = 0
      let delay = 0
      let terms = 0
      let onTime = 0
      let n = 0
      for (const p of paid) {
        if (p.company_id !== c.id || !p.paid_at) continue
        const weight = Math.max(1, toXaf(p.amount_minor, p.currency, rate))
        w += weight
        delay += diffDays(p.paid_at, p.start) * weight
        terms += diffDays(p.due_date, p.start) * weight
        if (p.paid_at <= p.due_date) onTime += weight
        n++
      }
      const r = rej.find((x) => x.company_id === c.id)
      const pr = prom.find((x) => x.company_id === c.id)
      const stats = {
        avgDelayDays: w ? Math.round(delay / w) : null,
        avgTermsDays: w ? Math.round(terms / w) : null,
        onTimeRate: w ? onTime / w : null,
        rejectionRate: r && r.deposited ? r.rejected / r.deposited : null,
        promiseKeptRate: pr && pr.total ? pr.kept / pr.total : null,
        paidCount: n
      }
      return {
        company_id: c.id,
        company_name: c.name,
        paid_count: n,
        avg_delay_days: stats.avgDelayDays,
        avg_terms_days: stats.avgTermsDays,
        on_time_rate: stats.onTimeRate,
        rejection_rate: stats.rejectionRate,
        rejected_count: r?.rejected ?? 0,
        deposited_count: r?.deposited ?? 0,
        promise_kept_rate: stats.promiseKeptRate,
        promises_count: pr?.total ?? 0,
        outstanding_xaf: outstanding.filter((o) => o.company_id === c.id).reduce((s, o) => s + toXaf(o.bal, o.currency, rate), 0),
        ...computeReliability(stats)
      }
    })
  },

  reliabilityOf(companyId: number): ReliabilityRow | null {
    return analytics.reliability().find((r) => r.company_id === companyId) ?? null
  },

  /** Prévisions d'encaissement sur `months` mois (montants en FCFA). */
  forecast(months = 3) {
    const today = todayISO()
    const rate = usdRate()
    const rel = new Map(analytics.reliability().map((r) => [r.company_id, r]))
    const promised = activities.promises({ status: 'en_attente' })
    const promiseByInvoice = new Map<number, string>()
    const promiseByCompany = new Map<number, string>()
    for (const p of promised) {
      if (p.promised_date < today) continue
      if (p.invoice_ids) p.invoice_ids.split(',').forEach((id) => promiseByInvoice.set(Number(id), p.promised_date))
      else promiseByCompany.set(p.company_id, p.promised_date)
    }
    const rows = db()
      .prepare(`SELECT i.id, i.number, i.company_id, c.name AS company_name, i.due_date, i.status, i.currency, ${BALANCE} AS balance
        FROM invoices i JOIN companies c ON c.id = i.company_id WHERE ${RECEIVABLE} AND ${BALANCE} > 0`)
      .all() as { id: number; number: string; company_id: number; company_name: string; due_date: string; status: InvoiceStatus; currency: Currency; balance: number }[]
    const items: (ForecastItem & { number: string; company_name: string })[] = rows.map((r) => {
      const cr = rel.get(r.company_id)
      const promise = promiseByInvoice.get(r.id) ?? promiseByCompany.get(r.company_id)
      return {
        invoiceId: r.id,
        number: r.number,
        companyId: r.company_id,
        company_name: r.company_name,
        balanceXaf: toXaf(r.balance, r.currency, rate),
        dueDate: r.due_date,
        status: r.status,
        companyLatenessDays: cr?.avgLatenessDays ?? null,
        companyGrade: cr?.grade ?? null,
        promise: promise ? { date: promise } : null
      }
    })
    const f = buildForecast(items, today, months)
    // Synthèse par entreprise sur l'horizon (hors « au-delà »)
    const horizonEnd = f.buckets[f.buckets.length - 2].key
    const byCompany = new Map<number, { company_id: number; company_name: string; expected: number; potential: number }>()
    for (const d of f.details) {
      if (d.date.slice(0, 7) > horizonEnd) continue
      const name = (d as unknown as { company_name: string }).company_name
      const e = byCompany.get(d.companyId) ?? { company_id: d.companyId, company_name: name, expected: 0, potential: 0 }
      e.expected += Math.round(d.balanceXaf * d.probability)
      e.potential += d.balanceXaf
      byCompany.set(d.companyId, e)
    }
    return {
      today,
      buckets: f.buckets,
      total_expected: f.buckets.slice(0, -1).reduce((s, b) => s + b.expected, 0),
      by_company: [...byCompany.values()].sort((a, b) => b.expected - a.expected),
      details: f.details.slice(0, 300) as (typeof f.details[number] & { number: string; company_name: string })[]
    }
  }
}
