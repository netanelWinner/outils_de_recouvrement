// Fragments SQL réutilisés par plusieurs services.
import { OPEN_STATUSES } from '@shared/constants'
import { xafSql } from '@shared/money'
import { getSettings } from '../services/settings'

export const OPEN_IN = `(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`
/** Reste dû d'une facture (alias « i »). */
export const BALANCE = '(i.amount_minor - i.paid_minor - i.credited_minor)'
/** Factures réclamables : non supprimées, pas des avoirs, statut ouvert. */
export const RECEIVABLE = `i.deleted_at IS NULL AND i.kind = 'facture' AND i.status IN ${OPEN_IN}`

export function usdRate(): number {
  return getSettings().currency.usd_rate
}

/** Reste dû converti en FCFA, en SQL. */
export function balanceXafSql(): string {
  return xafSql(BALANCE, 'i.currency', usdRate())
}

/** Échappe une saisie pour un LIKE ... ESCAPE '\\'. */
export function likeParam(q: string): string {
  return '%' + q.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}
