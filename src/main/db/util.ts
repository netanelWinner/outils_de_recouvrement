// Petits utilitaires d'accès aux données : horodatage, audit, historique de facture.
import { db } from './connection'

export function nowLocal(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Trace toute action dans le journal d'audit (avant / après en JSON). */
export function audit(action: string, entity: string, entityId: number | null, summary: string, before?: unknown, after?: unknown): void {
  db()
    .prepare('INSERT INTO audit_log (action, entity, entity_id, summary, before_json, after_json) VALUES (?,?,?,?,?,?)')
    .run(action, entity, entityId, summary, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after))
}

export function invoiceEvent(
  invoiceId: number,
  type: string,
  message: string,
  opts: { from?: string | null; to?: string | null; details?: unknown } = {}
): void {
  db()
    .prepare('INSERT INTO invoice_events (invoice_id, type, from_status, to_status, message, details) VALUES (?,?,?,?,?,?)')
    .run(invoiceId, type, opts.from ?? null, opts.to ?? null, message, opts.details === undefined ? null : JSON.stringify(opts.details))
}

/** Exécute fn dans une transaction (tout ou rien). */
export function tx<T>(fn: () => T): T {
  return db().transaction(fn)()
}

export const bool = (v: boolean | null | undefined) => (v ? 1 : 0)
