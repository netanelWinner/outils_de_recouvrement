// Corbeille : rien n'est supprimé définitivement d'un coup. Restauration ou suppression définitive.
import { db } from '../db/connection'
import { audit, tx } from '../db/util'
import { AppError } from '../errors'
import { formatMoney } from '@shared/money'
import type { Currency } from '@shared/constants'
import { invoices } from './invoices'
import { attachments } from './attachments'

export const TRASH_TYPES = ['company', 'contact', 'convention', 'voucher', 'litigation', 'activity', 'invoice', 'payment', 'template', 'attachment'] as const
export type TrashType = (typeof TRASH_TYPES)[number]

export interface TrashItem {
  type: TrashType
  id: number
  label: string
  detail: string | null
  deleted_at: string
}

const TABLES: Record<TrashType, string> = {
  company: 'companies',
  contact: 'contacts',
  convention: 'conventions',
  voucher: 'coverage_vouchers',
  litigation: 'litigation_cases',
  activity: 'activities',
  invoice: 'invoices',
  payment: 'payments',
  template: 'reminder_templates',
  attachment: 'attachments'
}

function deletedRow<T>(type: TrashType, id: number): T & { deleted_at: string } {
  const r = db().prepare(`SELECT * FROM ${TABLES[type]} WHERE id = ? AND deleted_at IS NOT NULL`).get(id)
  if (!r) throw new AppError('Élément introuvable dans la corbeille.')
  return r as T & { deleted_at: string }
}

function companyActive(id: number): boolean {
  return !!db().prepare('SELECT id FROM companies WHERE id = ? AND deleted_at IS NULL').get(id)
}

export const trash = {
  list(): TrashItem[] {
    const q = (sql: string) => db().prepare(sql).all() as TrashItem[]
    return [
      ...q(`SELECT 'company' AS type, id, name AS label, NULL AS detail, deleted_at FROM companies WHERE deleted_at IS NOT NULL`),
      ...q(`SELECT 'contact' AS type, ct.id, ct.full_name AS label, c.name AS detail, ct.deleted_at FROM contacts ct JOIN companies c ON c.id = ct.company_id
        WHERE ct.deleted_at IS NOT NULL AND (c.deleted_at IS NULL OR c.deleted_at <> ct.deleted_at)`),
      ...q(`SELECT 'convention' AS type, v.id, v.reference AS label, c.name AS detail, v.deleted_at FROM conventions v JOIN companies c ON c.id = v.company_id
        WHERE v.deleted_at IS NOT NULL AND (c.deleted_at IS NULL OR c.deleted_at <> v.deleted_at)`),
      ...(db()
        .prepare(`SELECT 'invoice' AS type, i.id, (CASE i.kind WHEN 'avoir' THEN 'Avoir ' ELSE 'Facture ' END) || i.number AS label,
          c.name AS detail, i.deleted_at, i.amount_minor, i.currency FROM invoices i JOIN companies c ON c.id = i.company_id WHERE i.deleted_at IS NOT NULL`)
        .all() as (TrashItem & { amount_minor: number; currency: Currency })[]).map((r) => ({
        type: r.type,
        id: r.id,
        label: r.label,
        detail: `${r.detail} – ${formatMoney(r.amount_minor, r.currency)}`,
        deleted_at: r.deleted_at
      })),
      ...(db()
        .prepare(`SELECT 'payment' AS type, p.id, p.received_at, p.reference, c.name AS company, p.deleted_at, p.amount_minor, p.currency
          FROM payments p JOIN companies c ON c.id = p.company_id WHERE p.deleted_at IS NOT NULL`)
        .all() as { type: 'payment'; id: number; received_at: string; reference: string | null; company: string; deleted_at: string; amount_minor: number; currency: Currency }[]).map(
        (r) => ({
          type: r.type,
          id: r.id,
          label: `Paiement ${formatMoney(r.amount_minor, r.currency)}${r.reference ? ' – ' + r.reference : ''}`,
          detail: r.company,
          deleted_at: r.deleted_at
        })
      ),
      ...q(`SELECT 'voucher' AS type, v.id, 'Bon ' || v.number AS label, c.name AS detail, v.deleted_at FROM coverage_vouchers v JOIN companies c ON c.id = v.company_id WHERE v.deleted_at IS NOT NULL`),
      ...q(`SELECT 'litigation' AS type, l.id, 'Dossier ' || l.reference AS label, c.name AS detail, l.deleted_at FROM litigation_cases l JOIN companies c ON c.id = l.company_id WHERE l.deleted_at IS NOT NULL`),
      ...q(`SELECT 'activity' AS type, a.id, substr(a.summary, 1, 80) AS label, c.name AS detail, a.deleted_at FROM activities a JOIN companies c ON c.id = a.company_id WHERE a.deleted_at IS NOT NULL`),
      ...q(`SELECT 'template' AS type, id, name AS label, NULL AS detail, deleted_at FROM reminder_templates WHERE deleted_at IS NOT NULL`),
      ...q(`SELECT 'attachment' AS type, id, original_name AS label, owner_type AS detail, deleted_at FROM attachments WHERE deleted_at IS NOT NULL`)
    ].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at))
  },

  restore(type: TrashType, id: number) {
    if (!TRASH_TYPES.includes(type)) throw new AppError('Type inconnu.')
    tx(() => {
      switch (type) {
        case 'company': {
          const c = deletedRow<{ name: string }>(type, id)
          if (db().prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL').get(c.name))
            throw new AppError(`Une autre entreprise nommée « ${c.name} » existe déjà : renommez-la avant de restaurer.`)
          db().prepare('UPDATE companies SET deleted_at = NULL WHERE id = ?').run(id)
          db().prepare('UPDATE contacts SET deleted_at = NULL WHERE company_id = ? AND deleted_at = ?').run(id, c.deleted_at)
          db().prepare('UPDATE conventions SET deleted_at = NULL WHERE company_id = ? AND deleted_at = ?').run(id, c.deleted_at)
          break
        }
        case 'voucher': {
          const v = deletedRow<{ company_id: number; number: string }>(type, id)
          if (db().prepare('SELECT id FROM coverage_vouchers WHERE company_id = ? AND number = ? COLLATE NOCASE AND deleted_at IS NULL').get(v.company_id, v.number))
            throw new AppError(`Un autre bon n° ${v.number} existe déjà pour cette entreprise.`)
          if (!companyActive(v.company_id)) throw new AppError('Restaurez d’abord l’entreprise concernée.')
          db().prepare('UPDATE coverage_vouchers SET deleted_at = NULL WHERE id = ?').run(id)
          break
        }
        case 'contact':
        case 'convention':
        case 'litigation':
        case 'activity': {
          const r = deletedRow<{ company_id: number }>(type, id)
          if (!companyActive(r.company_id)) throw new AppError('Restaurez d’abord l’entreprise concernée.')
          db().prepare(`UPDATE ${TABLES[type]} SET deleted_at = NULL WHERE id = ?`).run(id)
          break
        }
        case 'invoice': {
          const r = deletedRow<{ company_id: number; kind: string; corrects_invoice_id: number | null; amount_minor: number; currency: Currency }>(type, id)
          if (!companyActive(r.company_id)) throw new AppError('Restaurez d’abord l’entreprise concernée.')
          if (r.kind === 'avoir' && r.corrects_invoice_id) {
            const t = db().prepare('SELECT amount_minor - paid_minor - credited_minor AS bal FROM invoices WHERE id = ? AND deleted_at IS NULL').get(r.corrects_invoice_id) as
              | { bal: number }
              | undefined
            if (!t) throw new AppError('Restaurez d’abord la facture à laquelle cet avoir se rapporte.')
            if (t.bal < r.amount_minor) throw new AppError('Le reste dû de la facture est désormais inférieur au montant de cet avoir.')
          }
          db().prepare('UPDATE invoices SET deleted_at = NULL WHERE id = ?').run(id)
          if (r.kind === 'avoir' && r.corrects_invoice_id) invoices.recompute(r.corrects_invoice_id)
          else invoices.recompute(id)
          break
        }
        case 'payment': {
          const p = deletedRow<{ company_id: number; currency: Currency }>(type, id)
          if (!companyActive(p.company_id)) throw new AppError('Restaurez d’abord l’entreprise concernée.')
          const allocs = db()
            .prepare(`SELECT pa.invoice_id, pa.amount_minor, i.number, i.deleted_at, i.amount_minor - i.paid_minor - i.credited_minor AS bal
              FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = ?`)
            .all(id) as { invoice_id: number; amount_minor: number; number: string; deleted_at: string | null; bal: number }[]
          for (const a of allocs) {
            if (a.deleted_at) throw new AppError(`La facture ${a.number} imputée sur ce paiement est dans la corbeille : restaurez-la d’abord.`)
            if (a.bal < a.amount_minor) throw new AppError(`La facture ${a.number} a été réglée entre-temps : ce paiement ne peut plus y être imputé.`)
          }
          db().prepare('UPDATE payments SET deleted_at = NULL WHERE id = ?').run(id)
          for (const a of allocs) invoices.recompute(a.invoice_id)
          break
        }
        case 'template':
        case 'attachment':
          deletedRow(type, id)
          db().prepare(`UPDATE ${TABLES[type]} SET deleted_at = NULL WHERE id = ?`).run(id)
          break
      }
      audit('restauration', type, id, `Élément restauré depuis la corbeille (${type} n° ${id})`)
    })
    return true
  },

  /** Suppression DÉFINITIVE d'un élément de la corbeille. */
  purge(type: TrashType, id: number) {
    if (!TRASH_TYPES.includes(type)) throw new AppError('Type inconnu.')
    tx(() => {
      deletedRow(type, id)
      switch (type) {
        case 'company': {
          const n = db()
            .prepare('SELECT (SELECT count(*) FROM invoices WHERE company_id = @id) + (SELECT count(*) FROM payments WHERE company_id = @id) AS n')
            .get({ id }) as { n: number }
          if (n.n > 0) throw new AppError('Supprimez d’abord définitivement les factures et paiements de cette entreprise.')
          db().prepare('DELETE FROM reminder_invoices WHERE reminder_id IN (SELECT id FROM reminders WHERE company_id = ?)').run(id)
          db().prepare('DELETE FROM reminders WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM reminder_tasks WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM promises WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM activities WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM litigation_cases WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM deposit_batches WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM coverage_vouchers WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM conventions WHERE company_id = ?').run(id)
          db().prepare('DELETE FROM contacts WHERE company_id = ?').run(id)
          db().prepare('UPDATE companies SET parent_company_id = NULL WHERE parent_company_id = ?').run(id)
          db().prepare('DELETE FROM companies WHERE id = ?').run(id)
          break
        }
        case 'contact':
          db().prepare('UPDATE reminders SET contact_id = NULL WHERE contact_id = ?').run(id)
          db().prepare('DELETE FROM contacts WHERE id = ?').run(id)
          break
        case 'voucher':
          if (db().prepare('SELECT id FROM invoices WHERE voucher_id = ?').get(id)) throw new AppError('Ce bon est référencé par des factures : il est conservé.')
          db().prepare('DELETE FROM coverage_vouchers WHERE id = ?').run(id)
          break
        case 'litigation':
          for (const a of db().prepare(`SELECT id FROM attachments WHERE owner_type = 'litigation' AND owner_id = ?`).all(id) as { id: number }[]) attachments.purgeFile(a.id)
          db().prepare('DELETE FROM litigation_cases WHERE id = ?').run(id)
          break
        case 'activity':
          db().prepare('DELETE FROM promises WHERE activity_id = ?').run(id)
          db().prepare('DELETE FROM activities WHERE id = ?').run(id)
          break
        case 'convention':
          if (db().prepare('SELECT id FROM invoices WHERE convention_id = ? AND deleted_at IS NULL').get(id))
            throw new AppError('Des factures actives utilisent encore cette convention.')
          db().prepare('UPDATE invoices SET convention_id = NULL WHERE convention_id = ?').run(id)
          db().prepare('UPDATE coverage_vouchers SET convention_id = NULL WHERE convention_id = ?').run(id)
          db().prepare('DELETE FROM conventions WHERE id = ?').run(id)
          break
        case 'invoice': {
          if (db().prepare(`SELECT id FROM invoices WHERE corrects_invoice_id = ? AND kind = 'avoir'`).get(id))
            throw new AppError('Supprimez d’abord définitivement les avoirs rattachés à cette facture.')
          db().prepare('DELETE FROM payment_allocations WHERE invoice_id = ?').run(id)
          db().prepare('DELETE FROM invoice_events WHERE invoice_id = ?').run(id)
          db().prepare('DELETE FROM reminder_invoices WHERE invoice_id = ?').run(id)
          db().prepare('DELETE FROM reminder_task_invoices WHERE invoice_id = ?').run(id)
          for (const a of db().prepare(`SELECT id FROM attachments WHERE owner_type = 'invoice' AND owner_id = ?`).all(id) as { id: number }[])
            attachments.purgeFile(a.id)
          db().prepare('DELETE FROM invoices WHERE id = ?').run(id)
          break
        }
        case 'payment':
          db().prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(id)
          for (const a of db().prepare(`SELECT id FROM attachments WHERE owner_type = 'payment' AND owner_id = ?`).all(id) as { id: number }[])
            attachments.purgeFile(a.id)
          db().prepare('DELETE FROM payments WHERE id = ?').run(id)
          break
        case 'template':
          if (db().prepare('SELECT id FROM reminder_steps WHERE template_id = ?').get(id))
            throw new AppError('Ce modèle a été utilisé par le scénario de relance : il est conservé pour l’historique.')
          db().prepare('UPDATE reminders SET template_id = NULL WHERE template_id = ?').run(id)
          db().prepare('DELETE FROM reminder_templates WHERE id = ?').run(id)
          break
        case 'attachment':
          attachments.purgeFile(id)
          break
      }
      audit('suppression_definitive', type, id, `Élément supprimé définitivement (${type} n° ${id})`)
    })
    return true
  },

  /** Vide les éléments présents dans la corbeille depuis plus de `days` jours (ignore ceux qui sont bloqués). */
  purgeOlderThan(days = 30) {
    const limit = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    let n = 0
    // Ordre : pièces, paiements, avoirs puis factures, puis le reste
    const items = trash
      .list()
      .filter((i) => i.deleted_at.slice(0, 10) < limit)
      .sort((a, b) => TRASH_TYPES.indexOf(b.type) - TRASH_TYPES.indexOf(a.type))
    for (const it of items) {
      try {
        trash.purge(it.type, it.id)
        n++
      } catch {
        /* élément bloqué : on le laisse */
      }
    }
    return n
  }
}

export const auditLog = {
  list(q: { search?: string; page?: number; page_size?: number } = {}) {
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 200)
    const page = Math.max(1, q.page ?? 1)
    const where = q.search?.trim() ? `WHERE summary LIKE @s OR entity LIKE @s OR action LIKE @s` : ''
    const p = { s: `%${q.search?.trim() ?? ''}%` }
    const rows = db()
      .prepare(`SELECT id, at, action, entity, entity_id, summary FROM audit_log ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...p, limit: pageSize, offset: (page - 1) * pageSize }) as {
      id: number
      at: string
      action: string
      entity: string
      entity_id: number | null
      summary: string
    }[]
    const total = (db().prepare(`SELECT count(*) AS n FROM audit_log ${where}`).get(p) as { n: number }).n
    return { rows, total, page, page_size: pageSize }
  }
}
