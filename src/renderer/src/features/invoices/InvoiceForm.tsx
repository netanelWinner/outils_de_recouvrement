// Saisie / modification d'une facture, liée à l'entreprise, à la convention et au bon de prise en charge.
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Checkbox, Field, Input, Modal, SearchSelect, Select, Spinner, Textarea } from '@/components/ui'
import { AmountInput, CurrencySelect, DateText, Money } from '@/components/display'
import { VoucherStateBadge } from '../vouchers/VoucherForm'
import { useFeedback, useRun } from '@/components/feedback'
import { invoiceSchema, type InvoiceInput } from '@shared/schemas'
import { BENEFICIARY_TYPES, MEDICAL_WARNING, type BeneficiaryType, type Currency } from '@shared/constants'
import { formatDate, todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { findMedicalTerms } from '@shared/medical'

type Form = {
  number: string
  company_id: number | null
  convention_id: number | null
  voucher_number: string
  voucher_ceiling_minor: number | null
  po_number: string
  patient_name: string
  patient_matricule: string
  beneficiary_type: BeneficiaryType
  subcontractor_name: string
  service_date: string
  issue_date: string
  deposit_date: string
  due_date: string
  due_date_manual: boolean
  amount_minor: number | null
  currency: Currency
  notes: string
  workflow_status: 'brouillon' | 'envoyee' | 'acceptee'
}

const empty = (): Form => ({
  number: '',
  company_id: null,
  convention_id: null,
  voucher_number: '',
  voucher_ceiling_minor: null,
  po_number: '',
  patient_name: '',
  patient_matricule: '',
  beneficiary_type: 'salarie',
  subcontractor_name: '',
  service_date: '',
  issue_date: todayISO(),
  deposit_date: '',
  due_date: '',
  due_date_manual: false,
  amount_minor: null,
  currency: 'XAF',
  notes: '',
  workflow_status: 'envoyee'
})

export function InvoiceForm({
  id,
  defaultCompanyId,
  onClose,
  onSaved
}: {
  id: number | null
  defaultCompanyId?: number
  onClose: () => void
  onSaved: (id: number, isNew: boolean) => void
}) {
  const [f, setF] = useState<Form>(() => ({ ...empty(), company_id: defaultCompanyId ?? null }))
  const [loaded, setLoaded] = useState(id === null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dupe, setDupe] = useState(false)
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const conventions = useQuery({
    queryKey: ['conventions', f.company_id],
    queryFn: () => api.companies.conventionOptions(f.company_id!),
    enabled: !!f.company_id
  })

  // Chargement d'une facture existante
  useEffect(() => {
    if (id === null) return
    void api.invoices.get(id).then((d) => {
      const i = d.invoice
      setF({
        number: i.number,
        company_id: i.company_id,
        convention_id: i.convention_id,
        voucher_number: (d.voucher?.number as string) ?? '',
        voucher_ceiling_minor: (d.voucher?.ceiling_minor as number | null) ?? null,
        po_number: i.po_number ?? '',
        patient_name: i.patient_name ?? '',
        patient_matricule: i.patient_matricule ?? '',
        beneficiary_type: (i.beneficiary_type as BeneficiaryType) ?? 'salarie',
        subcontractor_name: (i.subcontractor_name as string) ?? '',
        service_date: (i.service_date as string) ?? '',
        issue_date: i.issue_date,
        deposit_date: i.deposit_date ?? '',
        due_date: i.due_date,
        due_date_manual: !!i.due_date_manual,
        amount_minor: i.amount_minor,
        currency: i.currency,
        notes: (i.notes as string) ?? '',
        workflow_status: 'envoyee'
      })
      setLoaded(true)
    })
  }, [id])

  // Devise par défaut de l'entreprise et convention active proposée
  const company = companies.data?.find((c) => c.id === f.company_id)
  useEffect(() => {
    if (id !== null || !conventions.data) return
    const active = conventions.data.find((c) => c.status === 'active')
    setF((x) => ({ ...x, convention_id: x.convention_id && conventions.data!.some((c) => c.id === x.convention_id) ? x.convention_id : (active?.id ?? null) }))
  }, [conventions.data, id])
  useEffect(() => {
    if (id === null && company) setF((x) => ({ ...x, currency: company.default_currency }))
  }, [company, id])

  // Échéance calculée automatiquement
  const depositForDue = f.workflow_status === 'brouillon' && id === null ? f.deposit_date || null : f.deposit_date || (id === null ? f.issue_date : null)
  const preview = useQuery({
    queryKey: ['dueDate', f.company_id, f.convention_id, f.issue_date, depositForDue],
    queryFn: () => api.invoices.previewDueDate({ company_id: f.company_id!, convention_id: f.convention_id, issue_date: f.issue_date, deposit_date: depositForDue }),
    enabled: !!f.company_id && /^\d{4}-\d{2}-\d{2}$/.test(f.issue_date)
  })
  const convention = conventions.data?.find((c) => c.id === f.convention_id)
  const companyVouchers = useQuery({ queryKey: ['vouchers', 'company', f.company_id], queryFn: () => api.vouchers.forCompany(f.company_id!), enabled: !!f.company_id })
  const knownVoucher = f.voucher_number.trim()
    ? (companyVouchers.data?.find((v) => v.number.toLowerCase() === f.voucher_number.trim().toLowerCase()) ?? null)
    : null

  const checkNumber = async () => {
    if (!f.number.trim()) return
    setDupe(await api.invoices.numberExists(f.number, id))
  }

  const save = async () => {
    const input: InvoiceInput = {
      ...f,
      company_id: f.company_id ?? 0,
      amount_minor: f.amount_minor ?? 0,
      due_date: f.due_date_manual ? f.due_date : null
    }
    const parsed = invoiceSchema.safeParse(input)
    if (!parsed.success) {
      const errs: Record<string, string> = {}
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? '_')] ??= i.message
      if (!f.company_id) errs.company_id = 'Choisissez l’entreprise'
      setErrors(errs)
      return
    }
    setErrors({})
    const terms = findMedicalTerms(f.notes, f.patient_name, f.subcontractor_name)
    if (terms.length) {
      const ok = await confirm({
        title: 'Information médicale détectée ?',
        message: (
          <>
            <p>
              Le texte saisi contient : <b>{terms.join(', ')}</b>.
            </p>
            <p className="mt-2">{MEDICAL_WARNING}</p>
            <p className="mt-2">Voulez-vous quand même enregistrer ? (Choisissez « Annuler » pour corriger.)</p>
          </>
        ),
        confirmLabel: 'Enregistrer quand même',
        danger: true
      })
      if (!ok) return
    }
    const r = await run(() => (id ? api.invoices.update(id, input) : api.invoices.create(input)), id ? 'Facture modifiée.' : 'Facture enregistrée.')
    if (r) onSaved(r.id, id === null)
  }

  const companyOptions = useMemo(() => companies.data ?? [], [companies.data])

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={id ? `Modifier la facture ${f.number}` : 'Nouvelle facture'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      {!loaded ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-brand-800">1. Client</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Entreprise qui paie" required error={errors.company_id}>
                <SearchSelect
                  options={companyOptions}
                  value={f.company_id}
                  invalid={!!errors.company_id}
                  onChange={(v) => setF((x) => ({ ...x, company_id: v, convention_id: null }))}
                  placeholder="Choisir l’entreprise…"
                />
                {companies.data?.length === 0 && <p className="mt-1 text-xs text-amber-700">Créez d’abord une entreprise (menu Entreprises).</p>}
              </Field>
              <Field label="Convention" tip="convention" help={convention ? `Délai : ${convention.payment_terms_days} jours à partir ${convention.terms_start === 'depot' ? 'du dépôt' : 'de l’émission'}` : company ? `Sans convention : délai de ${company.payment_terms_days} jours après émission` : undefined}>
                <Select value={f.convention_id ?? ''} onChange={(e) => set('convention_id', e.target.value ? Number(e.target.value) : null)} disabled={!f.company_id}>
                  <option value="">— Aucune —</option>
                  {conventions.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.reference}
                      {c.status !== 'active' ? ` (${c.status})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {convention && convention.required_documents.length > 0 && (
              <Alert tone="info" title="Pièces exigées par la convention (pour éviter un rejet)">
                {convention.required_documents.join(' · ')}
              </Alert>
            )}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-800">2. Patient et bon de prise en charge</h3>
            <p className="mb-3 flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" /> {MEDICAL_WARNING}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Nom du patient" error={errors.patient_name} help="Nom OU matricule obligatoire">
                <Input value={f.patient_name} onChange={(e) => set('patient_name', e.target.value)} invalid={!!errors.patient_name} />
              </Field>
              <Field label="Matricule">
                <Input value={f.patient_matricule} onChange={(e) => set('patient_matricule', e.target.value)} />
              </Field>
              <Field label="Bénéficiaire">
                <Select value={f.beneficiary_type} onChange={(e) => set('beneficiary_type', e.target.value as BeneficiaryType)}>
                  {Object.entries(BENEFICIARY_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              {f.beneficiary_type === 'sous_traitant' && (
                <Field label="Société sous-traitante" className="col-span-3">
                  <Input value={f.subcontractor_name} onChange={(e) => set('subcontractor_name', e.target.value)} placeholder="Nom de l’employeur du patient" />
                </Field>
              )}
              <Field label="N° du bon de prise en charge" tip="bon">
                <Input
                  list="vouchers-list"
                  value={f.voucher_number}
                  onChange={(e) => {
                    const v = companyVouchers.data?.find((x) => x.number === e.target.value)
                    // Bon existant choisi : on reprend le patient et le PO s'ils ne sont pas saisis
                    if (v)
                      setF((x) => ({
                        ...x,
                        voucher_number: v.number,
                        patient_name: x.patient_name || v.patient_name || '',
                        patient_matricule: x.patient_matricule || v.patient_matricule || '',
                        po_number: x.po_number || v.po_number || '',
                        beneficiary_type: v.beneficiary_type
                      }))
                    else set('voucher_number', e.target.value)
                  }}
                />
                <datalist id="vouchers-list">
                  {companyVouchers.data?.map((v) => (
                    <option key={v.id} value={v.number}>
                      {v.patient_name || v.patient_matricule}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="Plafond du bon" help="Facultatif : bloque tout dépassement">
                <AmountInput value={f.voucher_ceiling_minor} currency={f.currency} onChange={(v) => set('voucher_ceiling_minor', v)} placeholder="Aucun plafond" />
              </Field>
              <Field label="N° PO / bon de commande" tip="po">
                <Input value={f.po_number} onChange={(e) => set('po_number', e.target.value)} />
              </Field>
            </div>
            {knownVoucher && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="font-semibold">Bon n° {knownVoucher.number}</span>
                <VoucherStateBadge state={knownVoucher.state} />
                {knownVoucher.valid_until && (
                  <span>
                    valable jusqu’au <DateText iso={knownVoucher.valid_until} />
                  </span>
                )}
                {knownVoucher.ceiling_minor ? (
                  <span>
                    plafond <Money minor={knownVoucher.ceiling_minor} currency={knownVoucher.currency} /> · déjà facturé{' '}
                    <Money minor={knownVoucher.used_minor} currency={knownVoucher.currency} /> · reste{' '}
                    <b>
                      <Money minor={Math.max(0, knownVoucher.ceiling_minor - knownVoucher.used_minor)} currency={knownVoucher.currency} />
                    </b>
                  </span>
                ) : null}
              </div>
            )}
            {knownVoucher?.valid_until && f.service_date && f.service_date > knownVoucher.valid_until && (
              <Alert tone="warning">Les soins sont postérieurs à la fin de validité du bon : risque de rejet. Demandez un nouveau bon ou une prolongation.</Alert>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-brand-800">3. Facture</h3>
            <div className="grid grid-cols-3 gap-4">
              <Field label="N° de facture" required error={errors.number ?? (dupe ? 'Ce numéro existe déjà (vérifiez aussi la corbeille).' : null)}>
                <Input
                  value={f.number}
                  invalid={!!errors.number || dupe}
                  onChange={(e) => {
                    set('number', e.target.value)
                    setDupe(false)
                  }}
                  onBlur={() => void checkNumber()}
                  autoFocus={id === null}
                />
              </Field>
              <Field label="Montant" required error={errors.amount_minor} className="col-span-2">
                <div className="flex gap-2">
                  <AmountInput value={f.amount_minor} currency={f.currency} onChange={(v) => set('amount_minor', v)} invalid={!!errors.amount_minor} />
                  <CurrencySelect value={f.currency} onChange={(c) => set('currency', c)} />
                </div>
              </Field>
              <Field label="Date des soins">
                <Input type="date" value={f.service_date} onChange={(e) => set('service_date', e.target.value)} />
              </Field>
              <Field label="Date d’émission" required error={errors.issue_date}>
                <Input type="date" value={f.issue_date} onChange={(e) => set('issue_date', e.target.value)} />
              </Field>
              {id === null ? (
                <Field label="Situation" help="Où en est cette facture aujourd’hui ?">
                  <Select value={f.workflow_status} onChange={(e) => set('workflow_status', e.target.value as Form['workflow_status'])}>
                    <option value="brouillon">Brouillon (pas encore déposée)</option>
                    <option value="envoyee">Déposée / envoyée au client</option>
                    <option value="acceptee">Acceptée par le client</option>
                  </Select>
                </Field>
              ) : (
                <div />
              )}
              <Field label="Date de dépôt chez le client" tip="depot" error={errors.deposit_date} help={id === null && f.workflow_status !== 'brouillon' && !f.deposit_date ? 'Vide = date d’émission' : undefined}>
                <Input type="date" value={f.deposit_date} onChange={(e) => set('deposit_date', e.target.value)} disabled={id === null && f.workflow_status === 'brouillon'} />
              </Field>
              <Field label="Échéance" tip="echeance" error={errors.due_date}>
                {f.due_date_manual ? (
                  <Input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
                ) : (
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
                    {preview.data ? (
                      <>
                        <b>{formatDate(preview.data.due_date)}</b> <span className="text-xs text-slate-500">(calculée)</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Choisissez l’entreprise</span>
                    )}
                  </div>
                )}
                <div className="mt-1">
                  <Checkbox
                    checked={f.due_date_manual}
                    onChange={(v) => setF((x) => ({ ...x, due_date_manual: v, due_date: v ? x.due_date || preview.data?.due_date || '' : x.due_date }))}
                    label={<span className="text-xs">Saisir l’échéance manuellement</span>}
                  />
                </div>
              </Field>
              <Field label="Observations (sans information médicale)" className="col-span-3">
                <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
            {f.voucher_ceiling_minor !== null && f.amount_minor !== null && f.amount_minor > f.voucher_ceiling_minor && (
              <Alert tone="danger">Le montant dépasse le plafond du bon ({formatMoney(f.voucher_ceiling_minor, f.currency)}).</Alert>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
