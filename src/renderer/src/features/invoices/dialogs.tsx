// Dialogues liés aux factures : changement de situation (dépôt, rejet…), avoir.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { AmountInput, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { CONTACT_ROLES, INVOICE_ACTIONS, REJECTION_REASONS, type Currency, type InvoiceAction, type RejectionReason } from '@shared/constants'
import { addDays, todayISO } from '@shared/dates'

const NEEDS_DATE: InvoiceAction[] = ['envoyer', 'redeposer', 'rejeter', 'contentieux']

export function ActionDialog({ ids, action, companyId, onClose }: { ids: number[]; action: InvoiceAction; companyId?: number; onClose: () => void }) {
  const [date, setDate] = useState(todayISO())
  const [reason, setReason] = useState<RejectionReason | ''>('')
  const [text, setText] = useState('')
  const [rej, setRej] = useState({ missing_document: '', corrective_action: '', client_contact_id: null as number | null, redeposit_due: addDays(todayISO(), 7) })
  const [err, setErr] = useState<string | null>(null)
  const { run, busy } = useRun()
  const def = INVOICE_ACTIONS[action]
  const contacts = useQuery({ queryKey: ['company', companyId], queryFn: () => api.companies.get(companyId!), enabled: action === 'rejeter' && !!companyId })

  const submit = async () => {
    if (action === 'rejeter' && !reason) return setErr('Choisissez le motif du rejet.')
    const r = await run(
      () => api.invoices.applyAction({ ids, action, date, reason_code: reason || null, reason_text: text, ...(action === 'rejeter' ? rej : {}) }),
      (res) =>
        res.skipped.length
          ? `${res.done} facture(s) mise(s) à jour.\nNon modifiées : ${res.skipped.map((s) => `${s.number} (${s.reason})`).join(', ')}`
          : `${res.done} facture(s) mise(s) à jour.`
    )
    if (r) onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={def.label}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant={action === 'annuler' ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
            Valider
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {ids.length > 1 && <Alert tone="info">{ids.length} factures sélectionnées. Celles qui ne sont pas dans la bonne situation seront ignorées.</Alert>}
        {action === 'redeposer' && <Alert tone="info">Après correction, la facture est redéposée : le délai de paiement repart de cette date.</Alert>}
        {action === 'rejeter' && <Alert tone="warning">Notez précisément le motif : il vous servira à corriger et à éviter de nouveaux rejets.</Alert>}
        {NEEDS_DATE.includes(action) && (
          <Field label={action === 'envoyer' || action === 'redeposer' ? 'Date de dépôt chez le client' : 'Date'}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        {action === 'rejeter' && (
          <Field label="Motif du rejet" required error={err}>
            <Select value={reason} onChange={(e) => setReason(e.target.value as RejectionReason)}>
              <option value="">— Choisir —</option>
              {Object.entries(REJECTION_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {action === 'rejeter' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pièce manquante">
              <Input value={rej.missing_document} onChange={(e) => setRej({ ...rej, missing_document: e.target.value })} placeholder="Ex. : bon de commande" />
            </Field>
            <Field label="Re-dépôt prévu le">
              <Input type="date" value={rej.redeposit_due} onChange={(e) => setRej({ ...rej, redeposit_due: e.target.value })} />
            </Field>
            <Field label="Action corrective" className="col-span-2">
              <Input value={rej.corrective_action} onChange={(e) => setRej({ ...rej, corrective_action: e.target.value })} placeholder="Ex. : demander le PO au service achats" />
            </Field>
            {companyId && (
              <Field label="Responsable chez le client" className="col-span-2">
                <Select value={rej.client_contact_id ?? ''} onChange={(e) => setRej({ ...rej, client_contact_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {contacts.data?.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} – {CONTACT_ROLES[c.role]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
        <Field label={action === 'rejeter' ? 'Détail du rejet' : 'Commentaire (facultatif)'}>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function CreditNoteDialog({ invoiceId, number, balance, currency, onClose }: { invoiceId: number; number: string; balance: number; currency: Currency; onClose: () => void }) {
  const [f, setF] = useState({ number: `AV-${number}`, issue_date: todayISO(), amount: balance as number | null, notes: '' })
  const { run, busy } = useRun()
  const submit = async () => {
    const r = await run(
      () => api.invoices.createCreditNote({ invoice_id: invoiceId, number: f.number, issue_date: f.issue_date, amount_minor: f.amount ?? 0, notes: f.notes }),
      'Avoir enregistré : le reste dû de la facture a été réduit.'
    )
    if (r) onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Avoir sur la facture ${number}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Créer l’avoir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">
          Reste dû actuel : <Money minor={balance} currency={currency} strong />. Pour corriger entièrement une facture erronée : avoir du montant total, puis nouvelle
          facture.
        </Alert>
        <Field label="N° de l’avoir" required>
          <Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required>
            <Input type="date" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} />
          </Field>
          <Field label={`Montant (${currency})`} required>
            <AmountInput value={f.amount} currency={currency} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
        </div>
        <Field label="Motif" required>
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ex. erreur de montant, remise accordée, prestation contestée…" />
        </Field>
      </div>
    </Modal>
  )
}
