// Enregistrement d'un paiement reçu et imputation sur une ou plusieurs factures.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wand2, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Field, HelpTip, Input, Modal, SearchSelect, Select, Spinner } from '@/components/ui'
import { AmountInput, CurrencySelect, DateText, Money, StatusBadge } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { PAYMENT_METHODS, type Currency, type PaymentMethod } from '@shared/constants'
import { todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'

export function PaymentForm({ id, company_id, invoice_id, onClose }: { id: number | null; company_id?: number; invoice_id?: number; onClose: () => void }) {
  const [f, setF] = useState({
    company_id: company_id ?? (null as number | null),
    received_at: todayISO(),
    method: 'virement' as PaymentMethod,
    reference: '',
    bank_name: '',
    amount: null as number | null,
    currency: 'XAF' as Currency,
    notes: ''
  })
  const [alloc, setAlloc] = useState<Map<number, number | null>>(new Map())
  const [loaded, setLoaded] = useState(id === null)
  const [err, setErr] = useState<string | null>(null)
  const { run, busy } = useRun()
  const { confirm } = useFeedback()

  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const open = useQuery({
    queryKey: ['openForPayment', f.company_id, f.currency, id],
    queryFn: () => api.invoices.openForPayment(f.company_id!, f.currency, id),
    enabled: !!f.company_id
  })

  useEffect(() => {
    if (id === null) return
    void api.payments.get(id).then(({ payment: p, allocations }) => {
      setF({
        company_id: p.company_id,
        received_at: p.received_at,
        method: p.method,
        reference: p.reference ?? '',
        bank_name: p.bank_name ?? '',
        amount: p.amount_minor,
        currency: p.currency,
        notes: p.notes ?? ''
      })
      setAlloc(new Map(allocations.map((a) => [a.invoice_id, a.amount_minor])))
      setLoaded(true)
    })
  }, [id])

  // Nouveau paiement depuis une facture : devise de la facture, montant = reste dû
  useEffect(() => {
    if (id !== null || !invoice_id) return
    void api.invoices.get(invoice_id).then((d) => {
      setF((x) => ({ ...x, company_id: x.company_id ?? d.invoice.company_id, currency: d.invoice.currency, amount: d.invoice.balance_minor }))
      setAlloc(new Map([[invoice_id, d.invoice.balance_minor]]))
    })
  }, [id, invoice_id])

  const company = companies.data?.find((c) => c.id === f.company_id)
  useEffect(() => {
    if (id === null && !invoice_id && company) setF((x) => ({ ...x, currency: company.default_currency }))
  }, [company, id, invoice_id])

  const total = [...alloc.values()].reduce<number>((s, v) => s + (v ?? 0), 0)
  const remaining = (f.amount ?? 0) - total

  const suggest = async () => {
    if (!f.company_id || !f.amount) return setErr('Indiquez d’abord l’entreprise et le montant reçu.')
    setErr(null)
    const s = await api.payments.suggest({ company_id: f.company_id, currency: f.currency, amount_minor: f.amount, payment_id: id })
    setAlloc(new Map(s.allocations.map((a) => [a.invoice_id, a.amount_minor])))
  }

  const save = async () => {
    if (!f.company_id) return setErr('Choisissez l’entreprise qui a payé.')
    if (!f.amount || f.amount <= 0) return setErr('Indiquez le montant reçu.')
    if (total > f.amount) return setErr('Le total imputé dépasse le montant du paiement.')
    const balances = new Map((open.data ?? []).map((o) => [o.id, o.balance_minor]))
    for (const [inv, v] of alloc) if ((v ?? 0) > (balances.get(inv) ?? 0)) return setErr('Un montant imputé dépasse le reste dû de sa facture.')
    setErr(null)
    if (remaining > 0) {
      const ok = await confirm({
        title: 'Paiement non entièrement imputé',
        message: `${formatMoney(remaining, f.currency)} ne sont rattachés à aucune facture. Ce montant restera visible comme « non imputé » et vous pourrez l’imputer plus tard. Continuer ?`,
        confirmLabel: 'Enregistrer'
      })
      if (!ok) return
    }
    const input = {
      company_id: f.company_id,
      received_at: f.received_at,
      method: f.method,
      reference: f.reference,
      bank_name: f.bank_name,
      amount_minor: f.amount,
      currency: f.currency,
      notes: f.notes,
      allocations: [...alloc.entries()].filter(([, v]) => (v ?? 0) > 0).map(([invoice_id, v]) => ({ invoice_id, amount_minor: v! }))
    }
    const r = await run(() => (id ? api.payments.update(id, input) : api.payments.create(input)), id ? 'Paiement modifié.' : 'Paiement enregistré, factures mises à jour.')
    if (r) onClose()
  }

  const remove = async () => {
    if (!id) return
    if (!(await confirm({ title: 'Supprimer ce paiement ?', message: 'Il sera placé dans la corbeille et les factures concernées redeviendront dues.', danger: true, confirmLabel: 'Mettre à la corbeille' }))) return
    const r = await run(() => api.payments.remove(id), 'Paiement mis à la corbeille.', () => api.trash.restore('payment', id))
    if (r) onClose()
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={id ? 'Modifier le paiement' : 'Paiement reçu'}
      footer={
        <>
          {id && (
            <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              Corbeille
            </Button>
          )}
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      {!loaded ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Entreprise qui a payé" required className="col-span-2">
              <SearchSelect
                options={companies.data ?? []}
                value={f.company_id}
                onChange={(v) => {
                  setF((x) => ({ ...x, company_id: v }))
                  setAlloc(new Map())
                }}
                placeholder="Choisir l’entreprise…"
              />
            </Field>
            <Field label="Date de réception" required>
              <Input type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} />
            </Field>
            <Field label="Montant reçu" required className="col-span-2">
              <div className="flex gap-2">
                <AmountInput value={f.amount} currency={f.currency} onChange={(v) => setF({ ...f, amount: v })} />
                <CurrencySelect
                  value={f.currency}
                  onChange={(c) => {
                    setF({ ...f, currency: c })
                    setAlloc(new Map())
                  }}
                />
              </div>
            </Field>
            <Field label="Mode">
              <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={f.method === 'cheque' ? 'N° de chèque' : 'Référence du virement'}>
              <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
            </Field>
            <Field label="Banque">
              <Input value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1 text-sm font-semibold text-brand-800">
                Factures réglées par ce paiement <HelpTip k="imputation" />
              </h3>
              <Button size="sm" icon={<Wand2 className="size-3.5" />} onClick={() => void suggest()}>
                Imputer automatiquement (plus anciennes d’abord)
              </Button>
            </div>
            {!f.company_id ? (
              <p className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">Choisissez l’entreprise pour voir ses factures en attente.</p>
            ) : open.data?.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">Aucune facture en attente de paiement en {f.currency} pour cette entreprise.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">N°</th>
                      <th>Patient</th>
                      <th>Échéance</th>
                      <th>Statut</th>
                      <th className="text-right">Reste dû</th>
                      <th className="w-44 px-3 text-right">Montant imputé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.data?.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="tabular px-3 py-1.5 font-medium">{o.number}</td>
                        <td className="max-w-40 truncate text-slate-600">
                          {o.patient_name || o.patient_matricule}
                          {o.company_name !== company?.name && <span className="block text-xs text-slate-400">{o.company_name}</span>}
                        </td>
                        <td>
                          <DateText iso={o.due_date} />
                        </td>
                        <td>
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="text-right">
                          <Money minor={o.balance_minor} currency={o.currency} />
                        </td>
                        <td className="px-3 py-1">
                          <div className="flex items-center gap-1">
                            <button
                              className="rounded px-1.5 py-1 text-xs text-brand-700 hover:bg-brand-50"
                              title="Imputer le reste dû"
                              onClick={() => setAlloc((m) => new Map(m).set(o.id, o.balance_minor))}
                            >
                              Tout
                            </button>
                            <AmountInput value={alloc.get(o.id) ?? null} currency={f.currency} onChange={(v) => setAlloc((m) => new Map(m).set(o.id, v))} placeholder="—" />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 flex justify-end gap-6 text-sm">
              <span>
                Total imputé : <Money minor={total} currency={f.currency} strong />
              </span>
              <span className={remaining < 0 ? 'font-semibold text-red-600' : remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                {remaining < 0 ? 'Dépassement : ' : 'Non imputé : '}
                <Money minor={Math.abs(remaining)} currency={f.currency} />
              </span>
            </div>
          </div>
          {err && <Alert tone="danger">{err}</Alert>}
        </div>
      )}
    </Modal>
  )
}
