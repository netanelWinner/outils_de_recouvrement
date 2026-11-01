// Contentieux : dossiers confiés à un avocat ou un huissier, étapes, frais, documents ; alertes de prescription.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, Download, Gavel, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, EmptyState, Field, HelpTip, Input, Modal, PageHeader, SearchSelect, Select, Spinner, Tabs, Textarea, cx } from '@/components/ui'
import { AmountInput, CurrencySelect, DateText, Money, MoneyByCurrency, StatusBadge } from '@/components/display'
import { Attachments } from '@/components/Attachments'
import { useFeedback, useRun } from '@/components/feedback'
import {
  LITIGATION_HANDLERS,
  LITIGATION_PROCEDURES,
  LITIGATION_STATUS,
  type Currency,
  type InvoiceStatus,
  type LitigationHandler,
  type LitigationProcedure,
  type LitigationStatus
} from '@shared/constants'
import { todayISO } from '@shared/dates'
import { useWorkspace } from '../workspace'

export function LitigationBadge({ status }: { status: LitigationStatus }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', LITIGATION_STATUS[status].color)}>{LITIGATION_STATUS[status].label}</span>
}

export function LitigationPage() {
  const ws = useWorkspace()
  const { run } = useRun()
  const [filter, setFilter] = useState<'ouverts' | null>('ouverts')
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const list = useQuery({ queryKey: ['litigation', filter], queryFn: () => api.litigation.list({ status: filter }) })
  const presc = useQuery({ queryKey: ['litigation', 'prescriptions'], queryFn: () => api.litigation.prescriptions() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Contentieux <HelpTip k="contentieux" />
          </span>
        }
        subtitle="Dossiers transmis à un avocat ou un huissier, après échec des relances amiables."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('contentieux'), (p) => (p ? 'Export Excel créé.' : null))}>
              Exporter
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nouveau dossier
            </Button>
          </>
        }
      />
      {presc.data && presc.data.length > 0 && (
        <div className="mb-5">
          <Card
            title={
              <>
                <AlertTriangle className="size-4 text-red-600" /> Créances proches de la prescription ({settings.data?.legal.prescription_years ?? 5} ans) <HelpTip k="prescription" />
              </>
            }
            padded={false}
          >
            <table className="w-full text-sm">
              <tbody>
                {presc.data.map((p) => (
                  <tr key={p.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.openInvoice(p.id)}>
                    <td className="px-4 py-2 font-medium">{p.number}</td>
                    <td>{p.company_name}</td>
                    <td>
                      échéance <DateText iso={p.due_date} />
                    </td>
                    <td className="text-right">
                      <Money minor={p.balance_minor} currency={p.currency} strong />
                    </td>
                    <td className="px-4 text-right">
                      <span className={cx('rounded px-2 py-0.5 text-xs font-semibold', p.level === 'prescrite' ? 'bg-slate-800 text-white' : p.level === 'critique' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800')}>
                        {p.level === 'prescrite' ? 'Prescrite (à vérifier)' : `Prescription le ${p.date.split('-').reverse().join('/')} (${p.daysLeft} j)`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-xs text-slate-500">Une action en justice (ou une reconnaissance écrite de la dette par le client) interrompt en principe la prescription : à confirmer avec le service juridique.</p>
          </Card>
        </div>
      )}
      <Card padded={false}>
        <div className="flex gap-2 border-b border-slate-100 p-3">
          <Button size="sm" variant={filter === 'ouverts' ? 'primary' : 'secondary'} onClick={() => setFilter('ouverts')}>
            En cours
          </Button>
          <Button size="sm" variant={filter === null ? 'primary' : 'secondary'} onClick={() => setFilter(null)}>
            Tous
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Dossier</th>
              <th>Entreprise</th>
              <th>Confié à</th>
              <th>Procédure</th>
              <th className="text-right">Reste dû</th>
              <th>Prochaine étape</th>
              <th className="px-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((l) => (
              <tr key={l.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(l.id)}>
                <td className="px-3 py-2 font-medium">
                  {l.reference}
                  <div className="text-xs font-normal text-slate-500">
                    ouvert le <DateText iso={l.opened_at} /> · {l.invoice_count} facture(s)
                  </div>
                </td>
                <td className="max-w-48 truncate">{l.company_name}</td>
                <td className="text-slate-600">
                  {LITIGATION_HANDLERS[l.handler_type]}
                  {l.handler_name && <div className="text-xs">{l.handler_name}</div>}
                </td>
                <td className="text-slate-600">{LITIGATION_PROCEDURES[l.procedure]}</td>
                <td className="text-right">
                  <MoneyByCurrency items={l.due.map((d) => ({ currency: d.currency, amount: d.balance }))} empty="0" />
                </td>
                <td className="max-w-56 text-xs">
                  {l.next_step ?? '—'}
                  {l.next_step_due && (
                    <div className={l.next_step_due <= todayISO() ? 'font-semibold text-red-700' : 'text-slate-500'}>
                      pour le <DateText iso={l.next_step_due} />
                    </div>
                  )}
                </td>
                <td className="px-3">
                  <LitigationBadge status={l.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <EmptyState icon={<Gavel className="size-10" />} title="Aucun dossier de contentieux" text="Quand les relances et la mise en demeure restent sans effet, ouvrez un dossier pour le confier à un avocat ou un huissier." />}
      </Card>
      {creating && <NewCaseDialog onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), setOpen(id))} />}
      {open !== null && <CaseDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function NewCaseDialog({ onClose, onCreated, companyId }: { onClose: () => void; onCreated: (id: number) => void; companyId?: number }) {
  const [company, setCompany] = useState<number | null>(companyId ?? null)
  const [selected, setSelected] = useState<number[]>([])
  const [f, setF] = useState({
    reference: `CTX-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
    opened_at: todayISO(),
    handler_type: 'avocat' as LitigationHandler,
    handler_name: '',
    handler_contact: '',
    procedure: 'injonction_de_payer' as LitigationProcedure,
    notes: ''
  })
  const { run, busy } = useRun()
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const invs = useQuery({
    queryKey: ['invoices', 'litigable', company],
    queryFn: () => api.invoices.list({ company_id: company!, statuses: ['envoyee', 'acceptee', 'rejetee', 'partiellement_payee', 'contentieux'], sort: 'due_date', dir: 'asc', page_size: 300 }),
    enabled: !!company
  })
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Nouveau dossier de contentieux"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!company || !selected.length}
            onClick={() => void run(() => api.litigation.create({ ...f, company_id: company!, invoice_ids: selected }), 'Dossier ouvert : les factures sont passées en contentieux.').then((r) => r && onCreated(r.id))}
          >
            Ouvrir le dossier ({selected.length})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">Avant toute action en justice, assurez-vous qu’une mise en demeure (validée par le service juridique) a bien été envoyée.</Alert>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Entreprise" required className="col-span-2">
            <SearchSelect options={companies.data ?? []} value={company} onChange={(v) => (setCompany(v), setSelected([]))} />
          </Field>
          <Field label="Référence">
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Confié à">
            <Select value={f.handler_type} onChange={(e) => setF({ ...f, handler_type: e.target.value as LitigationHandler })}>
              {Object.entries(LITIGATION_HANDLERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nom (cabinet, étude)">
            <Input value={f.handler_name} onChange={(e) => setF({ ...f, handler_name: e.target.value })} />
          </Field>
          <Field label="Contact">
            <Input value={f.handler_contact} onChange={(e) => setF({ ...f, handler_contact: e.target.value })} />
          </Field>
          <Field label="Procédure">
            <Select value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value as LitigationProcedure })}>
              {Object.entries(LITIGATION_PROCEDURES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date d’ouverture">
            <Input type="date" value={f.opened_at} onChange={(e) => setF({ ...f, opened_at: e.target.value })} />
          </Field>
        </div>
        {company && (
          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
            {invs.data?.rows.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" className="accent-brand-700" checked={selected.includes(r.id)} onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} />
                <span className="tabular w-36 font-medium">{r.number}</span>
                <span className="w-24 text-xs text-slate-500">{r.days_late} j de retard</span>
                <StatusBadge status={r.status} />
                <span className="ml-auto">
                  <Money minor={r.balance_minor} currency={r.currency} />
                </span>
              </label>
            ))}
            {invs.data?.rows.length === 0 && <p className="p-3 text-sm text-slate-500">Aucune facture impayée.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}

function CaseDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['litigation', 'case', id], queryFn: () => api.litigation.get(id) })
  const [tab, setTab] = useState<'suivi' | 'factures' | 'frais' | 'documents' | 'fiche'>('suivi')
  const [step, setStep] = useState({ title: '', due_date: '' })
  const [cost, setCost] = useState({ date: todayISO(), label: '', amount: null as number | null, currency: 'XAF' as Currency })
  const ws = useWorkspace()
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  if (!q.data)
    return (
      <Modal open side onClose={onClose} title="Dossier">
        <Spinner />
      </Modal>
    )
  const { case: c, invoices, steps, costs, due, cost_totals } = q.data

  return (
    <Modal
      open
      side
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Dossier {c.reference} <LitigationBadge status={c.status} />
        </span>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Entreprise</div>
          {c.company_name}
        </div>
        <div className="rounded-lg bg-red-50 p-3">
          <div className="text-xs text-slate-500">Reste dû</div>
          <b>
            <MoneyByCurrency items={due.map((d) => ({ currency: d.currency, amount: d.balance }))} empty="0" />
          </b>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Frais engagés</div>
          <MoneyByCurrency items={cost_totals.map((d) => ({ currency: d.currency, amount: d.total }))} empty="0" />
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'suivi', label: 'Étapes et échéances', count: steps.filter((s) => !s.done_at).length },
          { key: 'factures', label: 'Factures', count: invoices.length },
          { key: 'frais', label: 'Frais' },
          { key: 'documents', label: 'Documents' },
          { key: 'fiche', label: 'Fiche et clôture' }
        ]}
      />
      {tab === 'suivi' && (
        <div className="space-y-3">
          <ul className="divide-y divide-slate-100">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                <button
                  onClick={() => void run(() => api.litigation.toggleStep(s.id))}
                  className={cx('flex size-5 items-center justify-center rounded border', s.done_at ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}
                  title={s.done_at ? 'Marquer à faire' : 'Marquer fait'}
                >
                  {s.done_at && <Check className="size-3.5" />}
                </button>
                <span className={cx('flex-1', s.done_at && 'text-slate-400 line-through')}>{s.title}</span>
                {s.due_date && (
                  <span className={cx('text-xs', !s.done_at && s.due_date <= todayISO() ? 'font-semibold text-red-700' : 'text-slate-500')}>
                    <DateText iso={s.due_date} />
                  </span>
                )}
                <button className="text-slate-400 hover:text-red-600" onClick={() => void run(() => api.litigation.removeStep(s.id))}>
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <Field label="Nouvelle étape" className="flex-1">
              <Input value={step.title} onChange={(e) => setStep({ ...step, title: e.target.value })} placeholder="Ex. : audience au tribunal de commerce" />
            </Field>
            <Field label="Échéance">
              <Input type="date" className="w-40" value={step.due_date} onChange={(e) => setStep({ ...step, due_date: e.target.value })} />
            </Field>
            <Button
              disabled={!step.title.trim()}
              onClick={() => void run(() => api.litigation.addStep(id, { title: step.title, due_date: step.due_date || null }), 'Étape ajoutée.').then((r) => r && setStep({ title: '', due_date: '' }))}
            >
              Ajouter
            </Button>
          </div>
        </div>
      )}
      {tab === 'factures' && (
        <table className="w-full text-sm">
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-slate-100">
                <td className="py-2">
                  <button className="font-medium text-brand-700 hover:underline" onClick={() => ws.openInvoice(i.id)}>
                    {i.number}
                  </button>
                </td>
                <td>
                  échéance <DateText iso={i.due_date} />
                </td>
                <td>
                  <StatusBadge status={i.status as InvoiceStatus} />
                </td>
                <td className="text-right">
                  <Money minor={i.balance_minor} currency={i.currency} strong />
                </td>
                <td className="pl-2 text-right">
                  <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => void run(() => api.litigation.removeInvoice(id, i.id), 'Facture retirée du dossier.')}>
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === 'frais' && (
        <div className="space-y-3">
          <table className="w-full text-sm">
            <tbody>
              {costs.map((k) => (
                <tr key={k.id} className="border-b border-slate-100">
                  <td className="py-2">
                    <DateText iso={k.date} />
                  </td>
                  <td>{k.label}</td>
                  <td className="text-right">
                    <Money minor={k.amount_minor} currency={k.currency} />
                  </td>
                  <td className="pl-2 text-right">
                    <button className="text-slate-400 hover:text-red-600" onClick={() => void run(() => api.litigation.removeCost(k.id))}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {costs.length === 0 && (
                <tr>
                  <td className="py-4 text-center text-slate-500">Aucun frais enregistré.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="grid grid-cols-[130px_1fr_200px_auto] items-end gap-2">
            <Field label="Date">
              <Input type="date" value={cost.date} onChange={(e) => setCost({ ...cost, date: e.target.value })} />
            </Field>
            <Field label="Libellé">
              <Input value={cost.label} onChange={(e) => setCost({ ...cost, label: e.target.value })} placeholder="Honoraires, frais d’huissier…" />
            </Field>
            <Field label="Montant">
              <div className="flex gap-1">
                <AmountInput value={cost.amount} currency={cost.currency} onChange={(v) => setCost({ ...cost, amount: v })} />
                <CurrencySelect value={cost.currency} onChange={(cur) => setCost({ ...cost, currency: cur })} />
              </div>
            </Field>
            <Button
              disabled={!cost.label.trim() || !cost.amount}
              onClick={() =>
                void run(() => api.litigation.addCost(id, { date: cost.date, label: cost.label, amount_minor: cost.amount!, currency: cost.currency }), 'Frais ajoutés.').then(
                  (r) => r && setCost({ ...cost, label: '', amount: null })
                )
              }
            >
              Ajouter
            </Button>
          </div>
        </div>
      )}
      {tab === 'documents' && <Attachments owner="litigation" id={id} />}
      {tab === 'fiche' && (
        <CaseForm
          c={c}
          busy={busy}
          onSave={(input) => void run(() => api.litigation.update(id, input), 'Dossier mis à jour.')}
          onDelete={() =>
            void confirm({ title: 'Supprimer ce dossier ?', message: 'Il sera placé dans la corbeille. Les factures restent en contentieux.', danger: true }).then(
              (ok) => ok && run(() => api.litigation.remove(id), 'Dossier mis à la corbeille.', () => api.trash.restore('litigation', id)).then((r) => r && onClose())
            )
          }
        />
      )}
    </Modal>
  )
}

function CaseForm({
  c,
  busy,
  onSave,
  onDelete
}: {
  c: Awaited<ReturnType<typeof api.litigation.get>>['case']
  busy: boolean
  onSave: (input: Parameters<typeof api.litigation.update>[1]) => void
  onDelete: () => void
}) {
  const [f, setF] = useState({
    reference: c.reference,
    opened_at: c.opened_at,
    handler_type: c.handler_type,
    handler_name: c.handler_name ?? '',
    handler_contact: c.handler_contact ?? '',
    procedure: c.procedure,
    status: c.status,
    outcome_notes: c.outcome_notes ?? '',
    notes: c.notes ?? ''
  })
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Référence">
          <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as LitigationStatus })}>
            {Object.entries(LITIGATION_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Confié à">
          <Select value={f.handler_type} onChange={(e) => setF({ ...f, handler_type: e.target.value as LitigationHandler })}>
            {Object.entries(LITIGATION_HANDLERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Procédure">
          <Select value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value as LitigationProcedure })}>
            {Object.entries(LITIGATION_PROCEDURES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nom (cabinet, étude)">
          <Input value={f.handler_name} onChange={(e) => setF({ ...f, handler_name: e.target.value })} />
        </Field>
        <Field label="Contact">
          <Input value={f.handler_contact} onChange={(e) => setF({ ...f, handler_contact: e.target.value })} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <Field label="Issue du dossier" className="col-span-2">
          <Textarea rows={2} value={f.outcome_notes} onChange={(e) => setF({ ...f, outcome_notes: e.target.value })} placeholder="Ex. : protocole transactionnel signé, paiement en 3 fois…" />
        </Field>
      </div>
      {f.status === 'clos_perdu' && <Alert tone="info">Créance irrécouvrable : les factures restent en contentieux. Pour les sortir des sommes dues, créez un avoir (validé par la direction).</Alert>}
      <div className="flex justify-between">
        <Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={onDelete}>
          Corbeille
        </Button>
        <Button variant="primary" loading={busy} onClick={() => onSave({ ...f, company_id: c.company_id, invoice_ids: [] })}>
          Enregistrer
        </Button>
      </div>
    </div>
  )
}
