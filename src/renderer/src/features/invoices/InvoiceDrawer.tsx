// Fiche détaillée d'une facture : informations, actions, historique, paiements, avoirs, relances, pièces.
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Ban, FileMinus, MessageSquarePlus, Pencil, Send, Trash2, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, FitText, HelpTip, Modal, Spinner, Tabs } from '@/components/ui'
import { ChannelIcon, DateText, LateBadge, Money, StatusBadge, ToneBadge } from '@/components/display'
import { Attachments } from '@/components/Attachments'
import { useFeedback, useRun } from '@/components/feedback'
import { ACTIVITY_TYPES, REJECTION_REASONS, type ActivityType, type PromiseStatus, type RejectionReason, BENEFICIARY_TYPES, DELIVERY_LABELS, INVOICE_ACTIONS, PAYMENT_METHODS, type BeneficiaryType, type InvoiceAction, type PaymentMethod, type Tone, type Channel, type Delivery } from '@shared/constants'
import { formatDate } from '@shared/dates'
import { useWorkspace } from '../workspace'
import { ActionDialog, CreditNoteDialog } from './dialogs'
import { RejectionStatusBadge } from '../followup/RejectionsPage'
import { PromiseBadge } from '../followup/FollowupPage'

export function InvoiceDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.invoices.get(id) })
  const [tab, setTab] = useState<'historique' | 'paiements' | 'relances' | 'rejets' | 'echanges' | 'pieces'>('historique')
  const [action, setAction] = useState<InvoiceAction | null>(null)
  const [credit, setCredit] = useState(false)
  const ws = useWorkspace()
  const navigate = useNavigate()
  const { run } = useRun()
  const { confirm } = useFeedback()

  if (q.error)
    return (
      <Modal open side onClose={onClose} title="Facture">
        <Alert tone="danger">{(q.error as Error).message}</Alert>
      </Modal>
    )
  if (!q.data)
    return (
      <Modal open side onClose={onClose} title="Facture">
        <Spinner />
      </Modal>
    )

  const { invoice: i, convention, voucher, allocations, creditNotes, events, reminders, penalty, correctsInvoice, rejections, batches, litigations, activities } = q.data
  const isAvoir = i.kind === 'avoir'
  const actions = (Object.keys(INVOICE_ACTIONS) as InvoiceAction[]).filter((a) => !isAvoir && (INVOICE_ACTIONS[a].from as readonly string[]).includes(i.workflow_status))
  const covered = i.paid_minor + i.credited_minor

  const remove = async () => {
    if (!(await confirm({ title: 'Mettre à la corbeille ?', message: `La facture ${i.number} sera placée dans la corbeille. Vous pourrez la restaurer pendant 30 jours.`, confirmLabel: 'Mettre à la corbeille', danger: true })))
      return
    const r = await run(
      () => api.invoices.remove([id]),
      (res) => (res.done ? 'Facture mise à la corbeille.' : `Impossible : ${res.blocked[0]?.reason}`),
      () => api.trash.restore('invoice', id)
    )
    if (r?.done) onClose()
  }

  return (
    <Modal
      open
      side
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          {isAvoir ? 'Avoir' : 'Facture'} <span className="tabular">{i.number}</span> <StatusBadge status={i.status} />
          {i.is_demo ? <span className="text-xs font-normal text-amber-700">(démo)</span> : null}
        </span>
      }
    >
      <div className="space-y-5">
        {i.status === 'rejetee' && (
          <Alert tone="danger" title="Facture rejetée par le client">
            Corrigez le problème (pièce manquante, PO…), puis utilisez « Redéposer » : le délai de paiement repartira de la date de re-dépôt.
          </Alert>
        )}
        {isAvoir && correctsInvoice && (
          <Alert tone="info">
            Avoir sur la facture{' '}
            <button className="font-semibold underline" onClick={() => ws.openInvoice(correctsInvoice.id)}>
              {correctsInvoice.number}
            </button>
            .
          </Alert>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Amount label="Montant" value={<Money minor={i.amount_minor} currency={i.currency} />} />
          <Amount label="Payé + avoirs" value={<Money minor={covered} currency={i.currency} />} />
          <Amount label="Reste dû" value={<Money minor={isAvoir ? 0 : i.balance_minor} currency={i.currency} strong />} highlight={!isAvoir && i.balance_minor > 0} />
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
          <Info label="Entreprise">
            <button className="text-brand-700 hover:underline" onClick={() => (onClose(), navigate(`/entreprises/${i.company_id}`))}>
              {i.company_name}
            </button>
          </Info>
          <Info label="Convention" tip="convention">
            {convention ? `${convention.reference as string}` : '—'}
          </Info>
          <Info label="Patient">{i.patient_name || '—'}</Info>
          <Info label="Matricule">{i.patient_matricule || '—'}</Info>
          <Info label="Bénéficiaire">{BENEFICIARY_TYPES[i.beneficiary_type as BeneficiaryType] ?? '—'}{i.subcontractor_name ? ` (${i.subcontractor_name as string})` : ''}</Info>
          <Info label="Bon de prise en charge" tip="bon">
            {voucher ? (
              <>
                {voucher.number as string}
                {voucher.ceiling_minor ? (
                  <span className="text-slate-500">
                    {' '}
                    · plafond <Money minor={voucher.ceiling_minor as number} currency={i.currency} />
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-amber-700">Non renseigné</span>
            )}
          </Info>
          <Info label="PO / bon de commande" tip="po">
            {i.po_number || <span className="text-amber-700">Non renseigné</span>}
          </Info>
          <Info label="Date des soins">{formatDate(i.service_date as string | null)}</Info>
          <Info label="Émise le">
            <DateText iso={i.issue_date} />
          </Info>
          <Info label="Déposée le" tip="depot">
            <DateText iso={i.deposit_date} />
          </Info>
          <Info label="Échéance" tip="echeance">
            <DateText iso={i.due_date} /> {i.due_date_manual ? <span className="text-xs text-slate-500">(saisie manuelle)</span> : null}
          </Info>
          <Info label="Retard">
            <LateBadge days={i.days_late} />
          </Info>
          {penalty > 0 && (
            <Info label="Pénalités de retard" tip="penalites">
              <Money minor={penalty} currency={i.currency} /> <span className="text-xs text-slate-500">(selon la convention)</span>
            </Info>
          )}
          {batches.length > 0 && (
            <Info label="Bordereau de dépôt" tip="bordereau">
              {batches.map((b) => b.reference).join(', ')}
            </Info>
          )}
          {litigations.length > 0 && (
            <Info label="Dossier de contentieux" tip="contentieux">
              {litigations.map((l) => `${l.reference}${l.handler_name ? ' (' + l.handler_name + ')' : ''}`).join(', ')}
            </Info>
          )}
          {i.notes ? <Info label="Observations">{i.notes as string}</Info> : null}
        </dl>

        {convention && convention.required_documents.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <b>Pièces exigées par la convention :</b> {convention.required_documents.join(' · ')}
          </div>
        )}

        {!isAvoir && (
          <div className="flex flex-wrap gap-2 border-y border-slate-100 py-3">
            {actions
              .filter((a) => a !== 'annuler' && a !== 'brouillon')
              .map((a) => (
                <Button key={a} size="sm" variant={a === 'envoyer' || a === 'redeposer' ? 'primary' : 'secondary'} onClick={() => setAction(a)}>
                  {INVOICE_ACTIONS[a].label}
                </Button>
              ))}
            {i.balance_minor > 0 && i.status !== 'annulee' && (
              <>
                <Button size="sm" icon={<Wallet className="size-3.5" />} onClick={() => ws.newPayment({ company_id: i.company_id, invoice_id: i.id })}>
                  Paiement reçu
                </Button>
                <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => ws.compose({ company_id: i.company_id, invoice_ids: [i.id] })}>
                  Relancer
                </Button>
                <Button size="sm" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => ws.logActivity({ company_id: i.company_id, invoice_ids: [i.id] })}>
                  Noter un échange
                </Button>
                <Button size="sm" icon={<FileMinus className="size-3.5" />} onClick={() => setCredit(true)}>
                  Avoir
                </Button>
              </>
            )}
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => ws.editInvoice(i.id)}>
              Modifier
            </Button>
            {actions.includes('brouillon') && (
              <Button size="sm" variant="ghost" onClick={() => setAction('brouillon')}>
                Remettre en brouillon
              </Button>
            )}
            {actions.includes('annuler') && (
              <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => setAction('annuler')}>
                Annuler
              </Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => void remove()}>
              Corbeille
            </Button>
          </div>
        )}
        {isAvoir && (
          <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => void remove()}>
            Supprimer cet avoir
          </Button>
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'historique', label: 'Historique', count: events.length },
            { key: 'paiements', label: 'Paiements et avoirs', count: allocations.length + creditNotes.length },
            { key: 'relances', label: 'Relances', count: reminders.length },
            { key: 'rejets', label: 'Rejets', count: rejections.length },
            { key: 'echanges', label: 'Échanges', count: activities.length },
            { key: 'pieces', label: 'Pièces jointes' }
          ]}
        />
        {tab === 'historique' && (
          <ol className="relative ml-2 border-l border-slate-200">
            {events.map((e) => (
              <li key={e.id} className="mb-3 ml-4">
                <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-white bg-brand-600" />
                <div className="text-xs text-slate-500">{e.at.slice(0, 16).replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1 à')}</div>
                <div className="text-sm text-slate-800">{e.message}</div>
              </li>
            ))}
          </ol>
        )}
        {tab === 'paiements' && (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">Date</th>
                  <th>Mode</th>
                  <th>Référence</th>
                  <th className="text-right">Imputé sur cette facture</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => ws.editPayment(a.payment_id)}>
                    <td className="py-1.5">
                      <DateText iso={a.received_at} />
                    </td>
                    <td>{PAYMENT_METHODS[a.method as PaymentMethod]}</td>
                    <td>{a.reference}</td>
                    <td className="text-right">
                      <Money minor={a.amount_minor} currency={a.currency} />
                    </td>
                  </tr>
                ))}
                {creditNotes.map((c) => (
                  <tr key={`c${c.id}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => ws.openInvoice(c.id)}>
                    <td className="py-1.5">
                      <DateText iso={c.issue_date} />
                    </td>
                    <td>Avoir</td>
                    <td>
                      {c.number} – {c.notes}
                    </td>
                    <td className="text-right">
                      <Money minor={c.amount_minor} currency={c.currency} />
                    </td>
                  </tr>
                ))}
                {allocations.length + creditNotes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      Aucun paiement ni avoir.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'relances' && (
          <ul className="divide-y divide-slate-100 text-sm">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <ChannelIcon channel={r.channel as Channel} />
                <span className="text-slate-500">{r.sent_at.slice(0, 10).split('-').reverse().join('/')}</span>
                <span>{DELIVERY_LABELS[r.delivery as Delivery]}</span>
                <ToneBadge tone={r.tone as Tone | null} />
                <span className="truncate text-slate-500">{r.recipient}</span>
              </li>
            ))}
            {reminders.length === 0 && <li className="py-4 text-center text-slate-500">Aucune relance envoyée pour cette facture.</li>}
          </ul>
        )}
        {tab === 'rejets' && (
          <ul className="space-y-2">
            {rejections.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <b>{REJECTION_REASONS[r.reason_code as RejectionReason]}</b>
                  <RejectionStatusBadge status={r.status} />
                </div>
                <div className="text-xs text-slate-500">
                  Rejetée le <DateText iso={r.rejected_at} />
                  {r.redeposited_at ? <> · redéposée le <DateText iso={r.redeposited_at} /></> : r.redeposit_due ? <> · re-dépôt prévu le <DateText iso={r.redeposit_due} /></> : null}
                </div>
                {r.missing_document && <div className="mt-1 text-red-700">Pièce manquante : {r.missing_document}</div>}
                {r.reason_text && <div className="mt-1 text-slate-600">{r.reason_text}</div>}
                {r.corrective_action && <div className="mt-1 text-slate-600">Action : {r.corrective_action}</div>}
                {r.contact_name && <div className="mt-1 text-xs text-slate-500">Interlocuteur : {r.contact_name}</div>}
              </li>
            ))}
            {rejections.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Aucun rejet pour cette facture.</li>}
          </ul>
        )}
        {tab === 'echanges' && (
          <ul className="divide-y divide-slate-100 text-sm">
            {activities.map((a) => (
              <li key={a.id} className="py-2">
                <div className="text-xs text-slate-500">
                  <DateText iso={a.occurred_at} /> · {ACTIVITY_TYPES[a.type as ActivityType]}
                </div>
                <div>{a.summary}</div>
                {a.promise_status && (
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    Promesse de <Money minor={a.promised_minor!} currency={a.promised_currency!} /> au <DateText iso={a.promised_date} />
                    <PromiseBadge status={a.promise_status as PromiseStatus} />
                  </div>
                )}
              </li>
            ))}
            {activities.length === 0 && <li className="py-4 text-center text-slate-500">Aucun échange noté.</li>}
          </ul>
        )}
        {tab === 'pieces' && <Attachments owner="invoice" id={i.id} />}
      </div>
      {action && <ActionDialog ids={[i.id]} action={action} companyId={i.company_id} onClose={() => setAction(null)} />}
      {credit && <CreditNoteDialog invoiceId={i.id} number={i.number} balance={i.balance_minor} currency={i.currency} onClose={() => setCredit(false)} />}
    </Modal>
  )
}

function Amount({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div className={highlight ? 'rounded-lg border border-red-200 bg-red-50 p-3' : 'rounded-lg border border-slate-200 bg-slate-50 p-3'}>
      <div className="text-xs text-slate-500">{label}</div>
      <FitText className="mt-0.5 text-base">{value}</FitText>
    </div>
  )
}

function Info({ label, children, tip }: { label: string; children: ReactNode; tip?: Parameters<typeof HelpTip>[0]['k'] }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs text-slate-500">
        {label} {tip && <HelpTip k={tip} />}
      </dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  )
}
