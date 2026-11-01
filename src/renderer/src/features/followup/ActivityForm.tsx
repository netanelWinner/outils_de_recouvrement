// Noter un échange (appel, visite, e-mail reçu…) et, éventuellement, une promesse de paiement.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Alert, Button, Checkbox, Field, HelpTip, Input, Modal, SearchSelect, Select, Textarea } from '@/components/ui'
import { AmountInput, CurrencySelect, DateText, Money } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { ACTIVITY_TYPES, CONTACT_ROLES, MEDICAL_WARNING, type ActivityType, type Currency } from '@shared/constants'
import { addDays, todayISO } from '@shared/dates'
import { findMedicalTerms } from '@shared/medical'

export function ActivityForm({ companyId, invoiceIds, onClose }: { companyId?: number; invoiceIds?: number[]; onClose: () => void }) {
  const [company, setCompany] = useState<number | null>(companyId ?? null)
  const [f, setF] = useState({ type: 'appel' as ActivityType, contact_id: null as number | null, occurred_at: todayISO(), summary: '' })
  const [selected, setSelected] = useState<number[]>(invoiceIds ?? [])
  const [promise, setPromise] = useState(false)
  const [p, setP] = useState({ amount: null as number | null, currency: 'XAF' as Currency, date: addDays(todayISO(), 7) })
  const [err, setErr] = useState<string | null>(null)
  const { run, busy } = useRun()
  const { confirm } = useFeedback()

  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const detail = useQuery({ queryKey: ['company', company], queryFn: () => api.companies.get(company!), enabled: !!company })
  const open = useQuery({
    queryKey: ['invoices', 'open', company],
    queryFn: () => api.invoices.list({ company_id: company!, statuses: ['envoyee', 'acceptee', 'rejetee', 'partiellement_payee', 'contentieux'], sort: 'due_date', dir: 'asc', page_size: 200 }),
    enabled: !!company
  })

  // Montant promis proposé = reste dû des factures cochées
  useEffect(() => {
    const rows = open.data?.rows.filter((r) => selected.includes(r.id)) ?? []
    if (rows.length) setP((x) => ({ ...x, amount: rows.reduce((s, r) => s + r.balance_minor, 0), currency: rows[0].currency }))
  }, [selected, open.data])

  const save = async () => {
    if (!company) return setErr('Choisissez l’entreprise.')
    if (!f.summary.trim()) return setErr('Résumez l’échange en quelques mots.')
    if (promise && (!p.amount || !p.date)) return setErr('Indiquez le montant et la date promis.')
    setErr(null)
    const terms = findMedicalTerms(f.summary)
    if (terms.length && !(await confirm({ title: 'Information médicale détectée ?', message: `${MEDICAL_WARNING} (mot détecté : ${terms.join(', ')})`, confirmLabel: 'Enregistrer quand même', danger: true })))
      return
    const r = await run(
      () =>
        api.activities.create({
          company_id: company,
          contact_id: f.contact_id,
          type: f.type,
          occurred_at: f.occurred_at,
          summary: f.summary,
          invoice_ids: selected,
          promise: promise ? { amount_minor: p.amount!, currency: p.currency, promised_date: p.date } : null
        }),
      promise ? 'Échange et promesse enregistrés. Les relances sont suspendues jusqu’à la date promise.' : 'Échange enregistré.'
    )
    if (r) onClose()
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Noter un échange"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Entreprise" required className="col-span-2">
            <SearchSelect options={companies.data ?? []} value={company} onChange={(v) => (setCompany(v), setSelected([]))} disabled={!!companyId} />
          </Field>
          <Field label="Date">
            <Input type="date" value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} />
          </Field>
          <Field label="Type d’échange">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ActivityType })}>
              {Object.entries(ACTIVITY_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Interlocuteur" className="col-span-2">
            <Select value={f.contact_id ?? ''} onChange={(e) => setF({ ...f, contact_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {detail.data?.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} – {CONTACT_ROLES[c.role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ce qui a été dit / convenu" required className="col-span-3">
            <Textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="Ex. : la facture est validée, mise en paiement prévue fin du mois." />
          </Field>
        </div>

        {company && (
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">Factures concernées (facultatif)</div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200">
              {open.data?.rows.length === 0 && <p className="p-3 text-sm text-slate-500">Aucune facture en attente.</p>}
              {open.data?.rows.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="accent-brand-700"
                    checked={selected.includes(r.id)}
                    onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                  />
                  <span className="tabular w-36 font-medium">{r.number}</span>
                  <span className="flex-1 text-slate-500">
                    échéance <DateText iso={r.due_date} />
                  </span>
                  <Money minor={r.balance_minor} currency={r.currency} />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <Checkbox
            checked={promise}
            onChange={setPromise}
            label={
              <span className="inline-flex items-center gap-1 font-medium">
                Le client a promis de payer <HelpTip k="promesse" />
              </span>
            }
            help="Les relances automatiques sont suspendues jusqu’à la date promise ; une alerte apparaît si le paiement n’arrive pas."
          />
          {promise && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Field label="Montant promis" className="col-span-2">
                <div className="flex gap-2">
                  <AmountInput value={p.amount} currency={p.currency} onChange={(v) => setP({ ...p, amount: v })} />
                  <CurrencySelect value={p.currency} onChange={(c) => setP({ ...p, currency: c })} />
                </div>
              </Field>
              <Field label="Date promise">
                <Input type="date" value={p.date} min={f.occurred_at} onChange={(e) => setP({ ...p, date: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Modal>
  )
}
