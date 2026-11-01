// Fiche d'une entreprise : synthèse, factures, interlocuteurs, conventions, relances, pièces jointes.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileDown, Mail, MessageCircle, MessageSquarePlus, PackageCheck, Pencil, Phone, Plus, Send, Star, Trash2, Wallet } from 'lucide-react'
import { api, type ContactRow, type ConventionRow } from '@/lib/api'
import { ActionMenu, Alert, Badge, Button, Card, EmptyState, Spinner, Stat, Tabs } from '@/components/ui'
import { DateText, Money, MoneyByCurrency } from '@/components/display'
import { Attachments } from '@/components/Attachments'
import { useFeedback, useRun } from '@/components/feedback'
import { COMPANY_TYPES, CONTACT_ROLES, PENALTY_TYPES, TERMS_START } from '@shared/constants'
import { InvoiceTable } from '../invoices/InvoicesPage'
import { ReminderHistory } from '../reminders/RemindersPage'
import { useWorkspace } from '../workspace'
import { CompanyForm, ContactForm, ConventionForm } from './forms'
import { ActivityJournal, PromisesList } from '../followup/FollowupPage'
import { BatchWizard } from '../followup/BatchesPage'
import { VoucherStateBadge } from '../vouchers/VoucherForm'
import { GradeBadge, ReliabilityCard } from '../analytics/AnalyticsPages'

function CompanyVouchers({ companyId }: { companyId: number }) {
  const ws = useWorkspace()
  const list = useQuery({ queryKey: ['vouchers', 'of', companyId], queryFn: () => api.vouchers.list({ company_id: companyId, page_size: 500 }) })
  return (
    <Card
      title="Bons de prise en charge"
      padded={false}
      actions={
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => ws.openVoucher(null, companyId)}>
          Nouveau bon
        </Button>
      }
    >
      <table className="w-full text-sm">
        <tbody>
          {list.data?.rows.map((v) => (
            <tr key={v.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.openVoucher(v.id)}>
              <td className="px-4 py-2 font-medium">{v.number}</td>
              <td className="text-slate-600">{v.patient_name || v.patient_matricule}</td>
              <td>{v.valid_until ? <>jusqu’au <DateText iso={v.valid_until} /></> : '—'}</td>
              <td className="text-right">{v.ceiling_minor ? <Money minor={v.ceiling_minor - v.used_minor} currency={v.currency} /> : null}</td>
              <td className="px-4 text-right"><VoucherStateBadge state={v.state} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.rows.length === 0 && <EmptyState title="Aucun bon pour cette entreprise" />}
    </Card>
  )
}

type Tab = 'factures' | 'echanges' | 'bons' | 'contacts' | 'conventions' | 'relances' | 'pieces' | 'fiche'

export function CompanyDetailPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const ws = useWorkspace()
  const { run, busy } = useRun()
  const { confirm, toast } = useFeedback()
  const [tab, setTab] = useState<Tab>('factures')
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<ContactRow | null | 'new'>(null)
  const [convention, setConvention] = useState<ConventionRow | null | 'new'>(null)
  const [batch, setBatch] = useState(false)
  const q = useQuery({ queryKey: ['company', id], queryFn: () => api.companies.get(id) })
  const rel = useQuery({ queryKey: ['reliability', id], queryFn: () => api.analytics.reliabilityOf(id) })

  if (q.error) return <Alert tone="danger">{(q.error as Error).message}</Alert>
  if (!q.data) return <Spinner />
  const { company: c, contacts, conventions, subcontractors, byCurrency, paid12 } = q.data

  const relaunch = async () => {
    const ids = await api.invoices.listIds({ company_id: id, overdue_only: true })
    if (!ids.length) return toast({ tone: 'info', message: 'Aucune facture en retard pour cette entreprise.' })
    ws.compose({ company_id: id, invoice_ids: ids })
  }

  const remove = async () => {
    if (!(await confirm({ title: `Supprimer ${c.name} ?`, message: 'L’entreprise, ses interlocuteurs et ses conventions iront dans la corbeille (restaurables 30 jours).', danger: true, confirmLabel: 'Mettre à la corbeille' })))
      return
    const r = await run(() => api.companies.remove(id), 'Entreprise mise à la corbeille.', () => api.trash.restore('company', id))
    if (r) navigate('/entreprises')
  }

  return (
    <>
      <button className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800" onClick={() => navigate('/entreprises')}>
        <ArrowLeft className="size-4" /> Entreprises
      </button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            {c.name} <Badge>{COMPANY_TYPES[c.type]}</Badge>
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {[c.city, c.phone, c.email].filter(Boolean).join(' · ') || 'Coordonnées non renseignées'}
            {c.parent_name && (
              <>
                {' · '}Sous-traitant de{' '}
                <button className="text-brand-700 hover:underline" onClick={() => navigate(`/entreprises/${c.parent_company_id}`)}>
                  {c.parent_name}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionMenu
            items={[
              { label: 'Relevé de compte (PDF)', icon: <FileDown className="size-4" />, onClick: () => void run(() => api.documents.statement(id), (p) => (p ? 'Relevé de compte PDF créé.' : null)) },
              { label: 'Bordereau de dépôt', icon: <PackageCheck className="size-4" />, onClick: () => setBatch(true) },
              { label: 'Noter un échange', icon: <MessageSquarePlus className="size-4" />, onClick: () => ws.logActivity({ company_id: id }) },
              { label: 'Paiement reçu', icon: <Wallet className="size-4" />, onClick: () => ws.newPayment({ company_id: id }) }
            ]}
          />
          <Button icon={<Send className="size-4" />} loading={busy} onClick={() => void relaunch()}>
            Relancer les retards
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ws.newInvoice({ company_id: id })}>
            Nouvelle facture
          </Button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total dû" value={<MoneyByCurrency items={byCurrency.map((b) => ({ currency: b.currency, amount: b.balance }))} empty="0" />} sub={`${c.open_count} facture(s) ouvertes`} />
        <Stat label="Dont en retard (équiv. FCFA)" value={<Money minor={c.overdue_xaf} currency="XAF" />} tone={c.overdue_xaf > 0 ? 'danger' : 'default'} />
        <Stat label="Encaissé sur 12 mois" value={<MoneyByCurrency items={paid12.map((p) => ({ currency: p.currency, amount: p.total }))} empty="0" />} tone="success" />
        <Stat label="Délai de paiement" value={`${c.payment_terms_days} jours`} sub={conventions.length ? `${conventions.length} convention(s)` : 'Aucune convention'} tip="convention" />
        <Stat label="Fiabilité" tip="fiabilite" value={<GradeBadge grade={rel.data?.grade ?? null} score={rel.data?.score} insufficient={rel.data?.insufficient} />} sub={rel.data?.avgLatenessDays != null ? `retard moyen : ${rel.data.avgLatenessDays} j` : undefined} onClick={() => setTab('fiche')} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'factures', label: 'Factures' },
          { key: 'echanges', label: 'Échanges et promesses' },
          { key: 'bons', label: 'Bons' },
          { key: 'contacts', label: 'Interlocuteurs', count: contacts.length },
          { key: 'conventions', label: 'Conventions', count: conventions.length },
          { key: 'relances', label: 'Relances' },
          { key: 'pieces', label: 'Pièces jointes' },
          { key: 'fiche', label: 'Fiche' }
        ]}
      />

      {tab === 'factures' && <InvoiceTable fixedCompanyId={id} />}

      {tab === 'contacts' && (
        <Card
          title="Interlocuteurs par rôle"
          actions={
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setContact('new')}>
              Ajouter
            </Button>
          }
        >
          {contacts.length === 0 ? (
            <EmptyState title="Aucun interlocuteur" text="Ajoutez au moins le contact de la comptabilité fournisseurs : c’est lui qui recevra les relances." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {contacts.map((ct) => (
                <div key={ct.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 font-medium text-slate-900">
                        {ct.full_name} {ct.is_primary ? <Star className="size-3.5 fill-amber-400 text-amber-400" /> : null}
                      </div>
                      <div className="text-xs text-slate-500">
                        {CONTACT_ROLES[ct.role]}
                        {ct.job_title ? ` · ${ct.job_title}` : ''}
                        {ct.third_party_name ? ` · ${ct.third_party_name}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setContact(ct)} title="Modifier">
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Supprimer"
                        onClick={() => void run(() => api.companies.removeContact(ct.id), 'Interlocuteur mis à la corbeille.', () => api.trash.restore('contact', ct.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                    {ct.email && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="size-3.5 text-slate-400" /> {ct.email}
                      </div>
                    )}
                    {ct.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="size-3.5 text-slate-400" /> {ct.phone}
                      </div>
                    )}
                    {ct.whatsapp && (
                      <div className="flex items-center gap-1.5">
                        <MessageCircle className="size-3.5 text-emerald-500" /> {ct.whatsapp}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'conventions' && (
        <Card
          title="Conventions"
          actions={
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setConvention('new')}>
              Ajouter
            </Button>
          }
        >
          {conventions.length === 0 ? (
            <EmptyState title="Aucune convention" text="Saisissez la convention signée avec l’entreprise : délai de paiement, pièces exigées, pénalités." />
          ) : (
            <div className="space-y-3">
              {conventions.map((cv) => (
                <div key={cv.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-slate-900">
                        {cv.reference} {cv.title && <span className="font-normal text-slate-500">– {cv.title}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Du <DateText iso={cv.start_date} /> {cv.end_date ? <>au <DateText iso={cv.end_date} /></> : '(sans fin)'} · {cv.invoice_count} facture(s) ·{' '}
                        <Badge className={cv.status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : undefined}>{cv.status}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => setConvention(cv)}>
                        Modifier
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void run(() => api.companies.removeConvention(cv.id), 'Convention mise à la corbeille.', () => api.trash.restore('convention', cv.id))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-slate-500">Délai</div>
                      {cv.payment_terms_days} jours à partir de la {TERMS_START[cv.terms_start].toLowerCase().replace('date d’', '').replace('date de ', '')}
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Pénalités</div>
                      {PENALTY_TYPES[cv.penalty_type]}
                      {cv.penalty_type.startsWith('taux') ? ` ${cv.penalty_rate} %` : ''}
                      {cv.penalty_grace_days ? ` (tolérance ${cv.penalty_grace_days} j)` : ''}
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Pièces exigées</div>
                      {cv.required_documents.join(', ') || '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'echanges' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => ws.logActivity({ company_id: id })}>
              Noter un échange
            </Button>
          </div>
          <PromisesList companyId={id} />
          <ActivityJournal companyId={id} />
        </div>
      )}
      {tab === 'bons' && <CompanyVouchers companyId={id} />}
      {tab === 'relances' && <ReminderHistory companyId={id} />}
      {tab === 'pieces' && (
        <Card>
          <Attachments owner="company" id={id} />
        </Card>
      )}
      {tab === 'fiche' && <div className="mb-4"><ReliabilityCard companyId={id} /></div>}
      {tab === 'fiche' && (
        <Card
          actions={
            <>
              <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                Modifier
              </Button>
              <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => void remove()}>
                Supprimer
              </Button>
            </>
          }
          title="Informations"
        >
          <dl className="grid grid-cols-3 gap-4 text-sm">
            {[
              ['Raison sociale', c.name],
              ['Sigle', c.short_name],
              ['NIU', c.niu],
              ['RCCM', c.rccm],
              ['Adresse', [c.address, c.city].filter(Boolean).join(', ')],
              ['Devise habituelle', c.default_currency],
              ['Conditions de facturation', c.billing_notes],
              ['Notes', c.notes],
              ['Sous-traitants rattachés', subcontractors.map((s) => s.name).join(', ')]
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="whitespace-pre-line text-slate-800">{v || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {editing && <CompanyForm company={c} onClose={() => setEditing(false)} />}
      {contact && <ContactForm companyId={id} contact={contact === 'new' ? null : contact} onClose={() => setContact(null)} />}
      {convention && <ConventionForm companyId={id} convention={convention === 'new' ? null : convention} onClose={() => setConvention(null)} />}
      {batch && <BatchWizard companyId={id} onClose={() => setBatch(false)} />}
    </>
  )
}
