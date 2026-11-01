// Fenêtres globales accessibles depuis n'importe quelle page : fiche facture, formulaires, rédaction de relance.
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Channel } from '@shared/constants'
import { InvoiceForm } from './invoices/InvoiceForm'
import { InvoiceDrawer } from './invoices/InvoiceDrawer'
import { PaymentForm } from './payments/PaymentForm'
import { ReminderComposer } from './reminders/ReminderComposer'
import { ActivityForm } from './followup/ActivityForm'
import { VoucherForm } from './vouchers/VoucherForm'

export interface ComposeParams {
  company_id: number
  invoice_ids: number[]
  task_id?: number | null
  channel?: Channel
  template_id?: number | null
}

interface Workspace {
  openInvoice: (id: number) => void
  newInvoice: (prefill?: { company_id?: number }) => void
  editInvoice: (id: number) => void
  newPayment: (prefill?: { company_id?: number; invoice_id?: number }) => void
  editPayment: (id: number) => void
  compose: (p: ComposeParams) => void
  logActivity: (prefill?: { company_id?: number; invoice_ids?: number[] }) => void
  openVoucher: (id: number | null, companyId?: number) => void
}

const Ctx = createContext<Workspace | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState<number | null>(null)
  const [invoiceForm, setInvoiceForm] = useState<{ id: number | null; company_id?: number } | null>(null)
  const [paymentForm, setPaymentForm] = useState<{ id: number | null; company_id?: number; invoice_id?: number } | null>(null)
  const [composer, setComposer] = useState<ComposeParams | null>(null)
  const [activity, setActivity] = useState<{ company_id?: number; invoice_ids?: number[] } | null>(null)
  const [voucher, setVoucher] = useState<{ id: number | null; company_id?: number } | null>(null)

  const ws: Workspace = {
    openInvoice: (id) => setDrawer(id),
    newInvoice: (p) => setInvoiceForm({ id: null, ...p }),
    editInvoice: (id) => setInvoiceForm({ id }),
    newPayment: (p) => setPaymentForm({ id: null, ...p }),
    editPayment: (id) => setPaymentForm({ id }),
    compose: (p) => setComposer(p),
    logActivity: (p) => setActivity(p ?? {}),
    openVoucher: (id, company_id) => setVoucher({ id, company_id })
  }

  return (
    <Ctx.Provider value={ws}>
      {children}
      {drawer !== null && <InvoiceDrawer id={drawer} onClose={() => setDrawer(null)} />}
      {invoiceForm && (
        <InvoiceForm
          id={invoiceForm.id}
          defaultCompanyId={invoiceForm.company_id}
          onClose={() => setInvoiceForm(null)}
          onSaved={(id, isNew) => {
            setInvoiceForm(null)
            if (isNew) setDrawer(id)
          }}
        />
      )}
      {paymentForm && <PaymentForm {...paymentForm} onClose={() => setPaymentForm(null)} />}
      {composer && <ReminderComposer params={composer} onClose={() => setComposer(null)} />}
      {activity && <ActivityForm companyId={activity.company_id} invoiceIds={activity.invoice_ids} onClose={() => setActivity(null)} />}
      {voucher && <VoucherForm id={voucher.id} defaultCompanyId={voucher.company_id} onClose={() => setVoucher(null)} />}
    </Ctx.Provider>
  )
}

export function useWorkspace(): Workspace {
  const c = useContext(Ctx)
  if (!c) throw new Error('WorkspaceProvider manquant')
  return c
}
