// Création / modification d'un bon de prise en charge, et sa fiche (factures liées, pièces jointes).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Field, Input, Modal, SearchSelect, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { AmountInput, CurrencySelect, DateText, Money, StatusBadge } from '@/components/display'
import { Attachments } from '@/components/Attachments'
import { useFeedback, useRun } from '@/components/feedback'
import { BENEFICIARY_TYPES, MEDICAL_WARNING, VOUCHER_STATES, type BeneficiaryType, type Currency, type InvoiceStatus } from '@shared/constants'
import { useWorkspace } from '../workspace'
import { cx } from '@/components/ui'

export function VoucherStateBadge({ state }: { state: keyof typeof VOUCHER_STATES }) {
  const s = VOUCHER_STATES[state]
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', s.color)}>{s.label}</span>
}

type Voucher = Awaited<ReturnType<typeof api.vouchers.get>>['voucher']

export function VoucherForm({ id, defaultCompanyId, onClose }: { id: number | null; defaultCompanyId?: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['voucher', id], queryFn: () => api.vouchers.get(id!), enabled: id !== null })
  if (id !== null && !q.data)
    return (
      <Modal open onClose={onClose} title="Bon de prise en charge">
        <Spinner />
      </Modal>
    )
  return <VoucherEditor v={q.data?.voucher ?? null} invoices={q.data?.invoices ?? []} defaultCompanyId={defaultCompanyId} onClose={onClose} />
}

function VoucherEditor({
  v,
  invoices,
  defaultCompanyId,
  onClose
}: {
  v: Voucher | null
  invoices: Awaited<ReturnType<typeof api.vouchers.get>>['invoices']
  defaultCompanyId?: number
  onClose: () => void
}) {
  const [tab, setTab] = useState<'fiche' | 'factures' | 'pieces'>('fiche')
  const [f, setF] = useState({
    company_id: v?.company_id ?? defaultCompanyId ?? (null as number | null),
    convention_id: v?.convention_id ?? (null as number | null),
    number: v?.number ?? '',
    patient_name: v?.patient_name ?? '',
    patient_matricule: v?.patient_matricule ?? '',
    beneficiary_type: (v?.beneficiary_type ?? 'salarie') as BeneficiaryType,
    subcontractor_name: v?.subcontractor_name ?? '',
    po_number: v?.po_number ?? '',
    issue_date: v?.issue_date ?? '',
    valid_until: v?.valid_until ?? '',
    ceiling_minor: v?.ceiling_minor ?? (null as number | null),
    currency: (v?.currency ?? 'XAF') as Currency,
    status: (v?.status ?? 'actif') as 'actif' | 'annule',
    notes: v?.notes ?? ''
  })
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  const ws = useWorkspace()
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const conventions = useQuery({ queryKey: ['conventions', f.company_id], queryFn: () => api.companies.conventionOptions(f.company_id!), enabled: !!f.company_id })
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF((x) => ({ ...x, [k]: val }))

  const save = async () => {
    const r = await run(() => api.vouchers.save(v?.id ?? null, { ...f, company_id: f.company_id ?? 0 }), v ? 'Bon modifié.' : 'Bon enregistré.')
    if (r) onClose()
  }
  const remove = async () => {
    if (!v) return
    if (!(await confirm({ title: 'Supprimer ce bon ?', message: 'Il sera placé dans la corbeille.', danger: true, confirmLabel: 'Mettre à la corbeille' }))) return
    const r = await run(() => api.vouchers.remove(v.id), 'Bon mis à la corbeille.', () => api.trash.restore('voucher', v.id))
    if (r) onClose()
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {v ? `Bon n° ${v.number}` : 'Nouveau bon de prise en charge'} {v && <VoucherStateBadge state={v.state} />}
        </span>
      }
      footer={
        <>
          {v && (
            <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              Corbeille
            </Button>
          )}
          <Button onClick={onClose}>Fermer</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      {v && (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'fiche', label: 'Fiche' },
            { key: 'factures', label: 'Factures', count: invoices.length },
            { key: 'pieces', label: 'Scan du bon' }
          ]}
        />
      )}
      {tab === 'fiche' && (
        <div className="space-y-4">
          {v && v.ceiling_minor ? (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Plafond</div>
                <Money minor={v.ceiling_minor} currency={v.currency} strong />
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Déjà facturé</div>
                <Money minor={v.used_minor} currency={v.currency} />
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Reste disponible</div>
                <Money minor={Math.max(0, v.ceiling_minor - v.used_minor)} currency={v.currency} strong />
              </div>
            </div>
          ) : null}
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {MEDICAL_WARNING}
          </p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Entreprise" required className="col-span-2">
              <SearchSelect options={companies.data ?? []} value={f.company_id} onChange={(id) => setF((x) => ({ ...x, company_id: id, convention_id: null }))} />
            </Field>
            <Field label="N° du bon" required>
              <Input value={f.number} onChange={(e) => set('number', e.target.value)} />
            </Field>
            <Field label="Nom du patient">
              <Input value={f.patient_name} onChange={(e) => set('patient_name', e.target.value)} />
            </Field>
            <Field label="Matricule">
              <Input value={f.patient_matricule} onChange={(e) => set('patient_matricule', e.target.value)} />
            </Field>
            <Field label="Bénéficiaire">
              <Select value={f.beneficiary_type} onChange={(e) => set('beneficiary_type', e.target.value as BeneficiaryType)}>
                {Object.entries(BENEFICIARY_TYPES).map(([k, val]) => (
                  <option key={k} value={k}>
                    {val}
                  </option>
                ))}
              </Select>
            </Field>
            {f.beneficiary_type === 'sous_traitant' && (
              <Field label="Société sous-traitante" className="col-span-3">
                <Input value={f.subcontractor_name} onChange={(e) => set('subcontractor_name', e.target.value)} />
              </Field>
            )}
            <Field label="Émis le">
              <Input type="date" value={f.issue_date} onChange={(e) => set('issue_date', e.target.value)} />
            </Field>
            <Field label="Valable jusqu’au" help="Une alerte apparaît 15 jours avant">
              <Input type="date" value={f.valid_until} onChange={(e) => set('valid_until', e.target.value)} />
            </Field>
            <Field label="N° PO">
              <Input value={f.po_number} onChange={(e) => set('po_number', e.target.value)} />
            </Field>
            <Field label="Plafond" className="col-span-2" help="Facultatif : aucune facture ne pourra le dépasser">
              <div className="flex gap-2">
                <AmountInput value={f.ceiling_minor} currency={f.currency} onChange={(val) => set('ceiling_minor', val)} placeholder="Aucun plafond" />
                <CurrencySelect value={f.currency} onChange={(c) => set('currency', c)} />
              </div>
            </Field>
            <Field label="Convention">
              <Select value={f.convention_id ?? ''} onChange={(e) => set('convention_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {conventions.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Statut">
              <Select value={f.status} onChange={(e) => set('status', e.target.value as 'actif' | 'annule')}>
                <option value="actif">Actif</option>
                <option value="annule">Annulé</option>
              </Select>
            </Field>
            <Field label="Notes" className="col-span-2">
              <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
      )}
      {tab === 'factures' && (
        <table className="w-full text-sm">
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.openInvoice(i.id)}>
                <td className="py-2 font-medium">{i.number}</td>
                <td>
                  <DateText iso={i.issue_date} />
                </td>
                <td className="text-right">
                  <Money minor={i.amount_minor} currency={i.currency} />
                </td>
                <td className="pl-3">
                  <StatusBadge status={i.status as InvoiceStatus} />
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td className="py-6 text-center text-slate-500">Aucune facture sur ce bon.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {tab === 'pieces' && v && (
        <>
          <Alert tone="info">Joignez le scan du bon signé par l’entreprise : il vous sera demandé en cas de rejet.</Alert>
          <div className="mt-3">
            <Attachments owner="voucher" id={v.id} />
          </div>
        </>
      )}
    </Modal>
  )
}
