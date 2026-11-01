// Client typé vers le processus principal : api.factures.list(...) → appel IPC « invoices.list ».
import type { Api } from '../../../main/api'

type AnyFn = (...args: never[]) => unknown
type Client<T> = {
  [K in keyof T]: T[K] extends AnyFn ? (...args: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> : T[K] extends object ? Client<T[K]> : never
}

interface Bridge {
  call: (method: string, args: unknown[]) => Promise<{ ok: boolean; data?: unknown; error?: string; locked?: boolean }>
  onLocked: (cb: () => void) => () => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

let lockedHandler: () => void = () => {}
export function setLockedHandler(fn: () => void): void {
  lockedHandler = fn
}

export const api = new Proxy({} as Client<Api>, {
  get: (_t, ns: string) =>
    new Proxy(
      {},
      {
        get:
          (_t2, fn: string) =>
          async (...args: unknown[]) => {
            const res = await window.bridge.call(`${ns}.${fn}`, args)
            if (!res.ok) {
              if (res.locked) lockedHandler()
              throw new Error(res.error ?? 'Erreur inconnue')
            }
            return res.data
          }
      }
    )
}) as Client<Api>

/** Types utiles côté interface, déduits du processus principal. */
export type InvoiceList = Awaited<ReturnType<Api['invoices']['list']>>
export type InvoiceRow = InvoiceList['rows'][number]
export type InvoiceDetail = Awaited<ReturnType<Api['invoices']['get']>>
export type CompanyRow = Awaited<ReturnType<Api['companies']['list']>>[number]
export type CompanyDetail = Awaited<ReturnType<Api['companies']['get']>>
export type ContactRow = CompanyDetail['contacts'][number]
export type ConventionRow = CompanyDetail['conventions'][number]
export type PaymentRow = Awaited<ReturnType<Api['payments']['list']>>['rows'][number]
export type TaskRow = Awaited<ReturnType<Api['reminders']['tasks']>>[number]
export type TemplateRow = Awaited<ReturnType<Api['reminders']['templates']>>[number]
export type AppSettings = Awaited<ReturnType<Api['settings']['get']>>
export type DashboardSummary = Awaited<ReturnType<Api['dashboard']['summary']>>
