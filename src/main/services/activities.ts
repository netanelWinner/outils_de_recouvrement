// Journal des échanges (appels, visites, e-mails reçus…) et promesses de paiement.
// Une promesse non tenue (date dépassée sans paiement suffisant) déclenche une alerte.
import { db } from '../db/connection'
import { audit, invoiceEvent, nowLocal, tx } from '../db/util'
import { AppError } from '../errors'
import { activitySchema, type ActivityInput } from '@shared/schemas'
import { ACTIVITY_TYPES, type ActivityType, type Currency, type PromiseStatus } from '@shared/constants'
import { formatDate, todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { evaluatePromise } from '@shared/domain/followup'

export interface ActivityRow {
  id: number
  company_id: number
  company_name: string
  contact_id: number | null
  contact_name: string | null
  type: ActivityType
  occurred_at: string
  summary: string
  invoice_numbers: string | null
  promise_id: number | null
  promised_minor: number | null
  promised_currency: Currency | null
  promised_date: string | null
  promise_status: PromiseStatus | null
  is_demo: number
}

export interface PromiseRow {
  id: number
  activity_id: number
  company_id: number
  company_name: string
  amount_minor: number
  currency: Currency
  promised_date: string
  status: PromiseStatus
  paid_since_minor: number
  acknowledged_at: string | null
  summary: string
  occurred_at: string
  contact_name: string | null
  invoice_ids: string | null
}

const ACT_SELECT = `SELECT a.*, c.name AS company_name, ct.full_name AS contact_name,
  (SELECT group_concat(i.number, ', ') FROM activity_invoices ai JOIN invoices i ON i.id = ai.invoice_id WHERE ai.activity_id = a.id) AS invoice_numbers,
  p.id AS promise_id, p.amount_minor AS promised_minor, p.currency AS promised_currency, p.promised_date, p.status AS promise_status
  FROM activities a JOIN companies c ON c.id = a.company_id LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN promises p ON p.activity_id = a.id`

const PROMISE_SELECT = `SELECT p.*, c.name AS company_name, a.summary, a.occurred_at, ct.full_name AS contact_name,
  (SELECT group_concat(ai.invoice_id) FROM activity_invoices ai WHERE ai.activity_id = p.activity_id) AS invoice_ids
  FROM promises p JOIN activities a ON a.id = p.activity_id JOIN companies c ON c.id = p.company_id LEFT JOIN contacts ct ON ct.id = a.contact_id`

/** Montant payé depuis la promesse : sur les factures visées, ou par l'entreprise si aucune facture n'est précisée. */
function paidSince(p: { activity_id: number; company_id: number; currency: Currency; occurred_at: string }): number {
  const linked = (db().prepare('SELECT invoice_id FROM activity_invoices WHERE activity_id = ?').all(p.activity_id) as { invoice_id: number }[]).map((x) => x.invoice_id)
  if (linked.length) {
    return (db()
      .prepare(`SELECT COALESCE(SUM(pa.amount_minor), 0) AS s FROM payment_allocations pa JOIN payments py ON py.id = pa.payment_id
        WHERE py.deleted_at IS NULL AND py.received_at >= ? AND pa.invoice_id IN (${linked.map(() => '?').join(',')})`)
      .get(p.occurred_at, ...linked) as { s: number }).s
  }
  return (db()
    .prepare(`SELECT COALESCE(SUM(py.amount_minor), 0) AS s FROM payments py JOIN companies c ON c.id = py.company_id
      WHERE py.deleted_at IS NULL AND py.currency = ? AND py.received_at >= ? AND (py.company_id = ? OR c.parent_company_id = ?)`)
    .get(p.currency, p.occurred_at, p.company_id, p.company_id) as { s: number }).s
}

export const activities = {
  list(q: { company_id?: number | null; type?: ActivityType | null; page?: number; page_size?: number } = {}) {
    const w = ['a.deleted_at IS NULL']
    const p: Record<string, unknown> = {}
    if (q.company_id) {
      w.push('a.company_id = @company')
      p.company = q.company_id
    }
    if (q.type) {
      w.push('a.type = @type')
      p.type = q.type
    }
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const rows = db()
      .prepare(`${ACT_SELECT} WHERE ${w.join(' AND ')} ORDER BY a.occurred_at DESC, a.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...p, limit: pageSize, offset: (page - 1) * pageSize }) as ActivityRow[]
    const total = (db().prepare(`SELECT count(*) AS n FROM activities a WHERE ${w.join(' AND ')}`).get(p) as { n: number }).n
    return { rows, total, page, page_size: pageSize }
  },

  create(input: ActivityInput) {
    const d = activitySchema.parse(input)
    const comp = db().prepare('SELECT name FROM companies WHERE id = ? AND deleted_at IS NULL').get(d.company_id) as { name: string } | undefined
    if (!comp) throw new AppError('Entreprise introuvable.')
    return tx(() => {
      const r = db()
        .prepare('INSERT INTO activities (company_id, contact_id, type, occurred_at, summary) VALUES (?,?,?,?,?)')
        .run(d.company_id, d.contact_id, d.type, d.occurred_at, d.summary)
      const id = Number(r.lastInsertRowid)
      const ins = db().prepare('INSERT OR IGNORE INTO activity_invoices (activity_id, invoice_id) VALUES (?,?)')
      for (const inv of d.invoice_ids) {
        ins.run(id, inv)
        invoiceEvent(inv, 'echange', `${ACTIVITY_TYPES[d.type]} : ${d.summary.slice(0, 160)}`)
      }
      if (d.promise) {
        db()
          .prepare('INSERT INTO promises (activity_id, company_id, amount_minor, currency, promised_date) VALUES (?,?,?,?,?)')
          .run(id, d.company_id, d.promise.amount_minor, d.promise.currency, d.promise.promised_date)
        for (const inv of d.invoice_ids)
          invoiceEvent(inv, 'promesse', `Promesse de paiement de ${formatMoney(d.promise.amount_minor, d.promise.currency)} pour le ${formatDate(d.promise.promised_date)} – relances suspendues jusque-là`)
      }
      audit('creation', 'echange', id, `${ACTIVITY_TYPES[d.type]} avec ${comp.name}${d.promise ? ' (promesse de paiement)' : ''}`, undefined, d)
      return { id }
    })
  },

  remove(id: number) {
    const a = db().prepare('SELECT id FROM activities WHERE id = ? AND deleted_at IS NULL').get(id)
    if (!a) throw new AppError('Échange introuvable.')
    tx(() => {
      db().prepare('UPDATE activities SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
      db().prepare(`UPDATE promises SET status = 'annulee' WHERE activity_id = ? AND status = 'en_attente'`).run(id)
      audit('corbeille', 'echange', id, 'Échange mis à la corbeille')
    })
    return true
  },

  // ---------------------------------------------------------------- Promesses
  promises(q: { status?: PromiseStatus | 'alertes' | null; company_id?: number | null } = {}): PromiseRow[] {
    const w = ['a.deleted_at IS NULL']
    const p: Record<string, unknown> = {}
    if (q.status === 'alertes') w.push(`p.status IN ('non_tenue','partielle') AND p.acknowledged_at IS NULL`)
    else if (q.status) {
      w.push('p.status = @status')
      p.status = q.status
    }
    if (q.company_id) {
      w.push('p.company_id = @company')
      p.company = q.company_id
    }
    return db().prepare(`${PROMISE_SELECT} WHERE ${w.join(' AND ')} ORDER BY p.promised_date DESC LIMIT 500`).all(p) as PromiseRow[]
  },

  /** Promesses arrivant à échéance aujourd'hui (à vérifier). */
  promisesDueToday(): PromiseRow[] {
    return db()
      .prepare(`${PROMISE_SELECT} WHERE a.deleted_at IS NULL AND p.status = 'en_attente' AND p.promised_date <= ? ORDER BY p.promised_date`)
      .all(todayISO()) as PromiseRow[]
  },

  /** Recalcule le statut de toutes les promesses en attente. Retourne celles qui viennent d'échouer. */
  evaluatePromises(): PromiseRow[] {
    const today = todayISO()
    const pending = db().prepare(`${PROMISE_SELECT} WHERE a.deleted_at IS NULL AND p.status = 'en_attente'`).all() as PromiseRow[]
    const broken: PromiseRow[] = []
    tx(() => {
      for (const pr of pending) {
        const paid = paidSince({ activity_id: pr.activity_id, company_id: pr.company_id, currency: pr.currency, occurred_at: pr.occurred_at })
        const status = evaluatePromise({ amount: pr.amount_minor, promisedDate: pr.promised_date, paidSince: paid, today })
        if (status !== pr.status || paid !== pr.paid_since_minor) {
          db().prepare('UPDATE promises SET status = ?, paid_since_minor = ?, evaluated_at = ? WHERE id = ?').run(status, paid, nowLocal(), pr.id)
        }
        if (status === 'non_tenue' || status === 'partielle') {
          broken.push({ ...pr, status, paid_since_minor: paid })
          const ids = (pr.invoice_ids ?? '').split(',').filter(Boolean).map(Number)
          for (const inv of ids) invoiceEvent(inv, 'promesse', `Promesse du ${formatDate(pr.promised_date)} ${status === 'partielle' ? 'partiellement tenue' : 'NON tenue'} – les relances reprennent`)
          audit('promesse', 'promesse', pr.id, `Promesse de ${pr.company_name} du ${formatDate(pr.promised_date)} : ${status === 'partielle' ? 'partiellement tenue' : 'non tenue'}`)
        }
      }
    })
    return broken
  },

  acknowledge(promiseId: number) {
    db().prepare('UPDATE promises SET acknowledged_at = ? WHERE id = ?').run(nowLocal(), promiseId)
    return true
  },

  cancelPromise(promiseId: number) {
    db().prepare(`UPDATE promises SET status = 'annulee', evaluated_at = ? WHERE id = ?`).run(nowLocal(), promiseId)
    audit('promesse', 'promesse', promiseId, 'Promesse annulée')
    return true
  },

  /** Factures et entreprises couvertes par une promesse en attente (pour suspendre les relances). */
  pendingPromiseScope(): { invoiceIds: Set<number>; companyIds: Set<number> } {
    const rows = db()
      .prepare(`SELECT p.company_id, (SELECT group_concat(ai.invoice_id) FROM activity_invoices ai WHERE ai.activity_id = p.activity_id) AS ids
        FROM promises p JOIN activities a ON a.id = p.activity_id WHERE a.deleted_at IS NULL AND p.status = 'en_attente' AND p.promised_date >= ?`)
      .all(todayISO()) as { company_id: number; ids: string | null }[]
    const invoiceIds = new Set<number>()
    const companyIds = new Set<number>()
    for (const r of rows) {
      if (r.ids) r.ids.split(',').forEach((x) => invoiceIds.add(Number(x)))
      else companyIds.add(r.company_id)
    }
    return { invoiceIds, companyIds }
  }
}
