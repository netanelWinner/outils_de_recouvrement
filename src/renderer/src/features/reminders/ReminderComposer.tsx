// Rédaction d'une relance (aperçu modifiable) et envoi sur le canal choisi : e-mail, WhatsApp ou courrier PDF.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, Mail, MessageCircle, Scale } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Spinner, Textarea, cx } from '@/components/ui'
import { DateText, LateBadge, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { CHANNELS, CONTACT_ROLES, type Channel } from '@shared/constants'
import type { ComposeParams } from '../workspace'

export function ReminderComposer({ params, onClose }: { params: ComposeParams; onClose: () => void }) {
  const [channel, setChannel] = useState<Channel>(params.channel ?? 'email')
  const [templateId, setTemplateId] = useState<number | null>(params.template_id ?? null)
  const [contactId, setContactId] = useState<number | null>(null)
  const [invoiceIds, setInvoiceIds] = useState<number[]>(params.invoice_ids)
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachPdf, setAttachPdf] = useState(false)
  const [legalOk, setLegalOk] = useState(false)
  const { run, busy } = useRun()

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.reminders.templates() })
  const forChannel = templates.data?.filter((t) => t.channel === channel) ?? []

  // Modèle par défaut du canal si aucun n'est imposé
  useEffect(() => {
    if (!templates.data) return
    if (templateId && templates.data.some((t) => t.id === templateId && t.channel === channel)) return
    setTemplateId(forChannel[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, templates.data])

  const composed = useQuery({
    queryKey: ['compose', params.company_id, params.invoice_ids, templateId, channel, contactId],
    queryFn: () => api.reminders.compose({ company_id: params.company_id, invoice_ids: params.invoice_ids, template_id: templateId, channel, contact_id: contactId }),
    enabled: templates.isSuccess
  })
  const c = composed.data

  // Pré-remplissage quand le modèle / l'interlocuteur change (l'utilisatrice peut ensuite modifier)
  useEffect(() => {
    if (!c) return
    setSubject(c.subject)
    setBody(c.body)
    setRecipient(c.recipient ?? '')
    if (contactId === null && c.contact_id) setContactId(c.contact_id)
    setLegalOk(false)
    if (invoiceIds.length !== params.invoice_ids.length) void recompose(invoiceIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c])

  // Le texte reflète toutes les factures : on recompose si la sélection change
  const recompose = async (ids: number[]) => {
    setInvoiceIds(ids)
    if (!ids.length) return
    const r = await api.reminders.compose({ company_id: params.company_id, invoice_ids: ids, template_id: templateId, channel, contact_id: contactId })
    setSubject(r.subject)
    setBody(r.body)
  }

  const send = async (mode: 'smtp' | 'eml' | 'whatsapp' | 'pdf') => {
    const r = await run(
      () =>
        api.reminders.send({
          task_id: params.task_id ?? null,
          company_id: params.company_id,
          invoice_ids: invoiceIds,
          template_id: templateId,
          channel,
          contact_id: contactId,
          recipient,
          subject,
          body,
          mode,
          attach_pdf: attachPdf
        }),
      (res) =>
        res.cancelled
          ? null
          : {
              smtp: `E-mail envoyé à ${recipient}.`,
              eml: 'Brouillon ouvert dans votre messagerie. Vérifiez-le puis cliquez sur « Envoyer ».',
              whatsapp: 'WhatsApp ouvert avec le message. Vérifiez le contact puis envoyez.',
              pdf: 'Lettre PDF créée. Imprimez-la, signez-la si besoin, et envoyez-la.'
            }[mode] + '\nLa relance est enregistrée dans l’historique.'
    )
    if (r && !r.cancelled) onClose()
  }

  const needsLegal = !!c?.needs_legal_review
  const blocked = invoiceIds.length === 0 || (needsLegal && !legalOk) || !body.trim()
  const smtpOk = !!settings.data?.smtp_configured

  return (
    <Modal open size="xl" onClose={onClose} title={c ? `Relance – ${c.company.name}` : 'Relance'}>
      {!c ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-[1fr_320px] gap-5">
          <div className="space-y-4">
            <div className="flex gap-2">
              {(Object.keys(CHANNELS) as Channel[]).map((ch) => {
                const Icon = ch === 'email' ? Mail : ch === 'whatsapp' ? MessageCircle : FileDown
                return (
                  <button
                    key={ch}
                    onClick={() => setChannel(ch)}
                    className={cx(
                      'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium',
                      channel === ch ? 'border-brand-700 bg-brand-50 text-brand-900 ring-1 ring-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    <Icon className="size-4" /> {CHANNELS[ch]}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Modèle">
                <Select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}>
                  {forChannel.length === 0 && <option value="">Aucun modèle pour ce canal</option>}
                  {forChannel.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Interlocuteur">
                <Select value={contactId ?? ''} onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Aucun (Madame, Monsieur) —</option>
                  {c.contacts.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.full_name} – {CONTACT_ROLES[ct.role]}
                    </option>
                  ))}
                </Select>
              </Field>
              {channel !== 'courrier' && (
                <Field label={channel === 'email' ? 'Adresse e-mail du destinataire' : 'N° WhatsApp du destinataire'} className="col-span-2">
                  <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={channel === 'email' ? 'compta@entreprise.com' : '+242 06 123 45 67'} />
                </Field>
              )}
              {channel !== 'whatsapp' && (
                <Field label="Objet" className="col-span-2">
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="Message (modifiable avant envoi)">
              <Textarea rows={16} className="font-[inherit] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            {needsLegal && (
              <Alert tone="warning" title="Mise en demeure : validation juridique requise">
                <p>Ce modèle n’a pas encore été validé par le service juridique de l’hôpital. Le PDF portera la mention « PROJET – à faire valider par le service juridique ».</p>
                <div className="mt-2">
                  <Checkbox checked={legalOk} onChange={setLegalOk} label="J’ai fait relire ce courrier par le service juridique (ou je génère un projet à lui soumettre)." />
                </div>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {channel === 'email' && (
                <>
                  <Checkbox checked={attachPdf} onChange={setAttachPdf} label="Joindre la lettre en PDF (avec signature)" />
                  <div className="ml-auto flex gap-2">
                    <Button loading={busy} disabled={blocked} icon={<Mail className="size-4" />} onClick={() => void send('eml')}>
                      Préparer un brouillon
                    </Button>
                    <Button
                      variant="primary"
                      loading={busy}
                      disabled={blocked || !smtpOk}
                      title={smtpOk ? '' : 'Configurez l’envoi d’e-mails dans Paramètres → E-mail'}
                      icon={<Mail className="size-4" />}
                      onClick={() => void send('smtp')}
                    >
                      Envoyer maintenant
                    </Button>
                  </div>
                </>
              )}
              {channel === 'whatsapp' && (
                <Button variant="success" className="ml-auto" loading={busy} disabled={blocked} icon={<MessageCircle className="size-4" />} onClick={() => void send('whatsapp')}>
                  Ouvrir dans WhatsApp
                </Button>
              )}
              {channel === 'courrier' && (
                <Button variant="primary" className="ml-auto" loading={busy} disabled={blocked} icon={needsLegal ? <Scale className="size-4" /> : <FileDown className="size-4" />} onClick={() => void send('pdf')}>
                  Générer la lettre PDF
                </Button>
              )}
            </div>
            {channel === 'email' && !smtpOk && (
              <p className="text-xs text-slate-500">L’envoi direct n’est pas configuré : « Préparer un brouillon » ouvre le message dans Outlook ou Thunderbird.</p>
            )}
          </div>

          <aside className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Factures concernées ({invoiceIds.length})</h3>
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
              {c.invoices.map((i) => {
                const on = invoiceIds.includes(i.id)
                return (
                  <li key={i.id} className={cx('rounded-md border bg-white p-2 text-xs', on ? 'border-slate-200' : 'border-dashed border-slate-200 opacity-50')}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-brand-700"
                        checked={on}
                        onChange={() => void recompose(on ? invoiceIds.filter((x) => x !== i.id) : [...invoiceIds, i.id])}
                      />
                      <span className="flex-1">
                        <span className="flex justify-between font-semibold text-slate-800">
                          {i.number} <Money minor={i.balance_minor} currency={i.currency} />
                        </span>
                        <span className="flex justify-between text-slate-500">
                          <span>
                            Échéance <DateText iso={i.due_date} />
                          </span>
                          <LateBadge days={i.days_late} />
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </aside>
        </div>
      )}
    </Modal>
  )
}
