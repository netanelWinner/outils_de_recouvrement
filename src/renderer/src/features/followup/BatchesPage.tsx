// Bordereaux de dépôt : regrouper les factures d'une entreprise sur une période, les déposer ensemble, imprimer le bordereau.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, PackageCheck, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, EmptyState, Field, HelpTip, Input, Modal, PageHeader, SearchSelect, Select } from '@/components/ui'
import { DateText, Money, MoneyByCurrency, StatusBadge } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { DEPOSIT_MODES, type Currency, type DepositMode, type InvoiceStatus } from '@shared/constants'
import { addMonths, todayISO } from '@shared/dates'

export function BatchesPage() {
  const [creating, setCreating] = useState(false)
  const [ack, setAck] = useState<{ id: number; value: string } | null>(null)
  const list = useQuery({ queryKey: ['batches'], queryFn: () => api.batches.list() })
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Bordereaux de dépôt <HelpTip k="bordereau" />
          </span>
        }
        subtitle="Facturation groupée : déposez ensemble les factures d’une entreprise sur une période, avec un bordereau à faire tamponner."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nouveau bordereau
          </Button>
        }
      />
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Référence</th>
              <th>Entreprise</th>
              <th>Déposé le</th>
              <th>Mode</th>
              <th className="text-right">Factures</th>
              <th className="text-right">Total</th>
              <th className="px-3">Accusé de réception</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((b) => (
              <tr key={b.id} className="border-b border-slate-100">
                <td className="tabular px-3 py-2 font-medium">{b.reference}</td>
                <td className="max-w-56 truncate">{b.company_name}</td>
                <td>
                  <DateText iso={b.deposit_date} />
                </td>
                <td>{DEPOSIT_MODES[b.deposit_mode]}</td>
                <td className="tabular text-right">{b.invoice_count}</td>
                <td className="text-right">{b.currency && b.total_minor ? <Money minor={b.total_minor} currency={b.currency} /> : '—'}</td>
                <td className="px-3">
                  {b.acknowledgment_ref ? (
                    <span className="text-emerald-700">✓ {b.acknowledgment_ref}</span>
                  ) : (
                    <button className="text-xs text-amber-700 underline" onClick={() => setAck({ id: b.id, value: '' })}>
                      À noter
                    </button>
                  )}
                </td>
                <td className="px-2 text-right whitespace-nowrap">
                  <Button size="sm" icon={<FileDown className="size-3.5" />} loading={busy} onClick={() => void run(() => api.batches.pdf(b.id), (p) => (p ? 'Bordereau PDF créé.' : null))}>
                    PDF
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void confirm({ title: 'Supprimer ce bordereau ?', message: 'Le bordereau est supprimé ; les factures restent déposées.', danger: true }).then(
                        (ok) => ok && run(() => api.batches.remove(b.id), 'Bordereau supprimé.')
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && (
          <EmptyState icon={<PackageCheck className="size-10" />} title="Aucun bordereau" text="Créez un bordereau pour déposer en une fois toutes les factures d’une entreprise sur une période." />
        )}
      </Card>
      {creating && <BatchWizard onClose={() => setCreating(false)} />}
      {ack && (
        <Modal
          open
          size="sm"
          onClose={() => setAck(null)}
          title="Accusé de réception"
          footer={
            <Button variant="primary" onClick={() => void run(() => api.batches.update(ack.id, { acknowledgment_ref: ack.value, notes: null }), 'Accusé de réception noté.').then((r) => r && setAck(null))}>
              Enregistrer
            </Button>
          }
        >
          <Field label="Référence ou date du tampon de réception" help="Ex. : « Reçu le 05/11 par M. X, cachet courrier n° 1234 »">
            <Input autoFocus value={ack.value} onChange={(e) => setAck({ ...ack, value: e.target.value })} />
          </Field>
        </Modal>
      )}
    </>
  )
}

export function BatchWizard({ companyId, onClose }: { companyId?: number; onClose: () => void }) {
  const today = todayISO()
  const [company, setCompany] = useState<number | null>(companyId ?? null)
  const [from, setFrom] = useState(addMonths(today, -1))
  const [to, setTo] = useState(today)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [f, setF] = useState({ reference: '', deposit_date: today, deposit_mode: 'main_propre' as DepositMode, acknowledgment_ref: '' })
  const { run, busy } = useRun()
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const cands = useQuery({ queryKey: ['batches', 'candidates', company, from, to], queryFn: () => api.batches.candidates({ company_id: company!, from: from || null, to: to || null }), enabled: !!company })
  const ref = useQuery({ queryKey: ['batches', 'ref', company], queryFn: () => api.batches.nextReference(company!), enabled: !!company })
  useEffect(() => {
    if (ref.data) setF((x) => ({ ...x, reference: ref.data! }))
  }, [ref.data])
  useEffect(() => setSelected(new Set(cands.data?.map((c) => c.id) ?? [])), [cands.data])
  const totals = useMemo(() => {
    const m = new Map<Currency, number>()
    cands.data?.filter((c) => selected.has(c.id)).forEach((c) => m.set(c.currency, (m.get(c.currency) ?? 0) + c.amount_minor))
    return [...m].map(([currency, amount]) => ({ currency, amount }))
  }, [cands.data, selected])

  const create = async () => {
    const r = await run(
      () => api.batches.create({ company_id: company!, invoice_ids: [...selected], reference: f.reference, period_start: from || null, period_end: to || null, deposit_date: f.deposit_date, deposit_mode: f.deposit_mode, acknowledgment_ref: f.acknowledgment_ref || null }),
      'Bordereau créé : les factures sont marquées déposées.'
    )
    if (r) {
      await run(() => api.batches.pdf(r.id), (p) => (p ? 'Bordereau PDF prêt à imprimer.' : null))
      onClose()
    }
  }

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="Nouveau bordereau de dépôt"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} disabled={!company || selected.size === 0} onClick={() => void create()}>
            Créer le bordereau et l’imprimer ({selected.size})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <Field label="Entreprise" required className="col-span-2">
            <SearchSelect options={companies.data ?? []} value={company} onChange={(v) => setCompany(v)} disabled={!!companyId} />
          </Field>
          <Field label="Factures émises du">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="au">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Référence du bordereau">
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Date de dépôt">
            <Input type="date" value={f.deposit_date} onChange={(e) => setF({ ...f, deposit_date: e.target.value })} />
          </Field>
          <Field label="Mode de dépôt">
            <Select value={f.deposit_mode} onChange={(e) => setF({ ...f, deposit_mode: e.target.value as DepositMode })}>
              {Object.entries(DEPOSIT_MODES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Accusé de réception (si déjà reçu)">
            <Input value={f.acknowledgment_ref} onChange={(e) => setF({ ...f, acknowledgment_ref: e.target.value })} />
          </Field>
        </div>
        {!company ? (
          <p className="rounded-md bg-slate-50 p-4 text-center text-sm text-slate-500">Choisissez l’entreprise.</p>
        ) : cands.data?.length === 0 ? (
          <Alert tone="info">Aucune facture brouillon ou déposée hors bordereau sur cette période.</Alert>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-brand-700"
                      checked={!!cands.data && selected.size === cands.data.length}
                      onChange={(e) => setSelected(new Set(e.target.checked ? cands.data?.map((c) => c.id) : []))}
                    />
                  </th>
                  <th>N°</th>
                  <th>Émise</th>
                  <th>Patient</th>
                  <th>Bon</th>
                  <th>PO</th>
                  <th className="text-right">Montant</th>
                  <th className="px-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {cands.data?.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        className="accent-brand-700"
                        checked={selected.has(c.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s)
                            if (n.has(c.id)) n.delete(c.id)
                            else n.add(c.id)
                            return n
                          })
                        }
                      />
                    </td>
                    <td className="tabular font-medium whitespace-nowrap">{c.number}</td>
                    <td>
                      <DateText iso={c.issue_date} />
                    </td>
                    <td className="text-slate-600">{c.patient_name || c.patient_matricule}</td>
                    <td className={c.voucher_number ? '' : 'text-amber-700'}>{c.voucher_number ?? 'manquant'}</td>
                    <td className={c.po_number ? '' : 'text-amber-700'}>{c.po_number ?? 'manquant'}</td>
                    <td className="text-right">
                      <Money minor={c.amount_minor} currency={c.currency} />
                    </td>
                    <td className="px-3">
                      <StatusBadge status={c.status as InvoiceStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected.size > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Les brouillons passeront au statut « Envoyée » à la date de dépôt (l’échéance est recalculée).</span>
            <span>
              Total : <b><MoneyByCurrency items={totals} /></b>
            </span>
          </div>
        )}
        {cands.data?.some((c) => selected.has(c.id) && (!c.voucher_number || !c.po_number)) && (
          <Alert tone="warning">Certaines factures n’ont pas de n° de bon ou de PO : risque de rejet par le client. Complétez-les avant le dépôt si possible.</Alert>
        )}
      </div>
    </Modal>
  )
}
