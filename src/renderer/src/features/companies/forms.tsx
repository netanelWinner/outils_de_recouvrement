// Formulaires : entreprise, interlocuteur, convention.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type CompanyRow, type ContactRow, type ConventionRow } from '@/lib/api'
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { AmountInput, CurrencySelect } from '@/components/display'
import { useRun } from '@/components/feedback'
import { COMPANY_TYPES, CONTACT_ROLES, PENALTY_TYPES, TERMS_START, type CompanyType, type ContactRole, type Currency, type PenaltyType, type TermsStart } from '@shared/constants'
import { todayISO } from '@shared/dates'

const errMap = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CompanyForm({ company, onClose, onSaved }: { company: CompanyRow | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const [f, setF] = useState({
    name: company?.name ?? '',
    short_name: company?.short_name ?? '',
    type: (company?.type ?? 'petrolier') as CompanyType,
    parent_company_id: company?.parent_company_id ?? null,
    niu: company?.niu ?? '',
    rccm: company?.rccm ?? '',
    address: company?.address ?? '',
    city: company?.city ?? 'Pointe-Noire',
    phone: company?.phone ?? '',
    email: company?.email ?? '',
    default_currency: (company?.default_currency ?? 'XAF') as Currency,
    payment_terms_days: company?.payment_terms_days ?? 60,
    billing_notes: company?.billing_notes ?? '',
    notes: company?.notes ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const { run, busy } = useRun()
  const options = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    if (!f.name.trim()) return setError('Le nom de l’entreprise est obligatoire.')
    setError(null)
    const r = await run(() => (company ? api.companies.update(company.id, f).then(() => ({ id: company.id })) : api.companies.create(f)), company ? 'Entreprise modifiée.' : 'Entreprise créée.')
    if (r) {
      onSaved?.(r.id)
      onClose()
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={company ? `Modifier ${company.name}` : 'Nouvelle entreprise'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Raison sociale" required error={error} className="col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Nom court / sigle">
          <Input value={f.short_name} onChange={(e) => set('short_name', e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => set('type', e.target.value as CompanyType)}>
            {Object.entries(COMPANY_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {f.type === 'sous_traitant' && (
          <Field label="Donneur d’ordre (compagnie pétrolière)" className="col-span-2" help="Les paiements du donneur d’ordre pourront être imputés sur les factures de ce sous-traitant.">
            <Select value={f.parent_company_id ?? ''} onChange={(e) => set('parent_company_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Aucun —</option>
              {options.data
                ?.filter((o) => o.id !== company?.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Délai de paiement par défaut (jours)" tip="echeance" help="Utilisé quand la facture n’est liée à aucune convention.">
          <Input type="number" min={0} max={365} value={f.payment_terms_days} onChange={(e) => set('payment_terms_days', Number(e.target.value))} />
        </Field>
        <Field label="Devise habituelle">
          <CurrencySelect value={f.default_currency} onChange={(c) => set('default_currency', c)} />
        </Field>
        <Field label="NIU">
          <Input value={f.niu} onChange={(e) => set('niu', e.target.value)} />
        </Field>
        <Field label="RCCM">
          <Input value={f.rccm} onChange={(e) => set('rccm', e.target.value)} />
        </Field>
        <Field label="Adresse" className="col-span-2">
          <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Ville">
          <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Téléphone (standard)">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="E-mail générique" className="col-span-2">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Conditions de facturation (portail, format, adresse de dépôt…)" className="col-span-2">
          <Textarea rows={2} value={f.billing_notes} onChange={(e) => set('billing_notes', e.target.value)} />
        </Field>
        <Field label="Notes internes" className="col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function ContactForm({ companyId, contact, onClose }: { companyId: number; contact: ContactRow | null; onClose: () => void }) {
  const [f, setF] = useState({
    role: (contact?.role ?? 'compta_fournisseurs') as ContactRole,
    full_name: contact?.full_name ?? '',
    job_title: contact?.job_title ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    whatsapp: contact?.whatsapp ?? '',
    third_party_name: contact?.third_party_name ?? '',
    is_primary: !!contact?.is_primary,
    notes: contact?.notes ?? ''
  })
  const [error, setError] = useState<string | null>(null)
  const { busy, run } = useRun()
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    try {
      setError(null)
      const r = await run(() => api.companies.saveContact(contact?.id ?? null, { ...f, company_id: companyId }), 'Interlocuteur enregistré.')
      if (r) onClose()
    } catch (e) {
      setError(errMap(e))
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? 'Modifier l’interlocuteur' : 'Nouvel interlocuteur'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Rôle" required>
          <Select value={f.role} onChange={(e) => set('role', e.target.value as ContactRole)}>
            {Object.entries(CONTACT_ROLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nom complet" required error={error}>
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} autoFocus />
        </Field>
        <Field label="Fonction">
          <Input value={f.job_title} onChange={(e) => set('job_title', e.target.value)} />
        </Field>
        {f.role === 'gestionnaire_tiers' && (
          <Field label="Société de gestion">
            <Input value={f.third_party_name} onChange={(e) => set('third_party_name', e.target.value)} />
          </Field>
        )}
        <Field label="E-mail" className="col-span-2">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Téléphone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+242 06 …" />
        </Field>
        <Field label="WhatsApp" help="Format : 06 123 45 67 ou +242 06 123 45 67">
          <Input value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <Checkbox checked={f.is_primary} onChange={(v) => set('is_primary', v)} label="Interlocuteur principal pour ce rôle" help="Proposé en premier pour les relances." />
        </div>
        <Field label="Notes" className="col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function ConventionForm({ companyId, convention, onClose }: { companyId: number; convention: ConventionRow | null; onClose: () => void }) {
  const [f, setF] = useState({
    reference: convention?.reference ?? '',
    title: convention?.title ?? '',
    start_date: convention?.start_date ?? todayISO(),
    end_date: convention?.end_date ?? '',
    payment_terms_days: convention?.payment_terms_days ?? 60,
    terms_start: (convention?.terms_start ?? 'depot') as TermsStart,
    required_documents: (convention?.required_documents ?? ['Bon de prise en charge', 'Bon de commande (PO)']).join('\n'),
    billing_format_notes: convention?.billing_format_notes ?? '',
    penalty_type: (convention?.penalty_type ?? 'aucune') as PenaltyType,
    penalty_rate: convention?.penalty_rate ?? 0,
    penalty_fixed_minor: convention?.penalty_fixed_minor ?? 0,
    penalty_grace_days: convention?.penalty_grace_days ?? 0,
    currency: (convention?.currency ?? 'XAF') as Currency,
    status: (convention?.status ?? 'active') as 'active' | 'expiree' | 'suspendue'
  })
  const { busy, run } = useRun()
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const input = {
      ...f,
      company_id: companyId,
      end_date: f.end_date || null,
      required_documents: f.required_documents
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const r = await run(
      () => api.companies.saveConvention(convention?.id ?? null, input),
      (res) => `Convention enregistrée.${res.recomputed ? `\n${res.recomputed} échéance(s) de facture recalculée(s).` : ''}`
    )
    if (r) onClose()
  }
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={convention ? `Convention ${convention.reference}` : 'Nouvelle convention'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <Field label="Référence" required>
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} autoFocus />
        </Field>
        <Field label="Intitulé" className="col-span-2">
          <Input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Début" required>
          <Input type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Fin">
          <Input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />
        </Field>
        <Field label="Statut">
          <Select value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>
            <option value="active">Active</option>
            <option value="suspendue">Suspendue</option>
            <option value="expiree">Expirée</option>
          </Select>
        </Field>
        <Field label="Délai de paiement (jours)" required tip="echeance">
          <Input type="number" min={0} max={365} value={f.payment_terms_days} onChange={(e) => set('payment_terms_days', Number(e.target.value))} />
        </Field>
        <Field label="Le délai court à partir de" className="col-span-2">
          <Select value={f.terms_start} onChange={(e) => set('terms_start', e.target.value as TermsStart)}>
            {Object.entries(TERMS_START).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pièces exigées avec chaque facture (une par ligne)" className="col-span-2" help="Rappelées à la saisie de chaque facture, pour éviter les rejets.">
          <Textarea rows={4} value={f.required_documents} onChange={(e) => set('required_documents', e.target.value)} />
        </Field>
        <Field label="Format / mode de dépôt">
          <Textarea rows={4} value={f.billing_format_notes} onChange={(e) => set('billing_format_notes', e.target.value)} placeholder="Portail fournisseur, adresse e-mail, nombre d’exemplaires…" />
        </Field>
        <Field label="Pénalités de retard" tip="penalites">
          <Select value={f.penalty_type} onChange={(e) => set('penalty_type', e.target.value as PenaltyType)}>
            {Object.entries(PENALTY_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {(f.penalty_type === 'taux_annuel' || f.penalty_type === 'taux_mensuel') && (
          <Field label="Taux (%)">
            <Input type="number" step="0.1" min={0} max={100} value={f.penalty_rate} onChange={(e) => set('penalty_rate', Number(e.target.value))} />
          </Field>
        )}
        {f.penalty_type === 'forfait' && (
          <Field label="Montant forfaitaire">
            <AmountInput value={f.penalty_fixed_minor} currency={f.currency} onChange={(v) => set('penalty_fixed_minor', v ?? 0)} />
          </Field>
        )}
        {f.penalty_type !== 'aucune' && (
          <Field label="Jours de tolérance">
            <Input type="number" min={0} value={f.penalty_grace_days} onChange={(e) => set('penalty_grace_days', Number(e.target.value))} />
          </Field>
        )}
        <Field label="Devise">
          <CurrencySelect value={f.currency} onChange={(c) => set('currency', c)} />
        </Field>
      </div>
    </Modal>
  )
}
