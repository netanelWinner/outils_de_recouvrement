// Rejets et litiges de facturation : suivi des corrections et des re-dépôts, statistiques par motif.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileWarning, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Textarea, cx } from '@/components/ui'
import { DateText, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { CONTACT_ROLES, REJECTION_REASONS, REJECTION_STATUS, type RejectionReason, type RejectionStatus } from '@shared/constants'
import { useWorkspace } from '../workspace'
import { ActionDialog } from '../invoices/dialogs'
import { todayISO } from '@shared/dates'

type Row = Awaited<ReturnType<typeof api.rejections.list>>['rows'][number]

export function RejectionStatusBadge({ status }: { status: RejectionStatus }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', REJECTION_STATUS[status].color)}>{REJECTION_STATUS[status].label}</span>
}

export function RejectionsPage() {
  const ws = useWorkspace()
  const { run } = useRun()
  const [status, setStatus] = useState<RejectionStatus | null>('ouvert')
  const [page, setPage] = useState(1)
  const [edit, setEdit] = useState<Row | null>(null)
  const [redeposit, setRedeposit] = useState<number | null>(null)
  const list = useQuery({ queryKey: ['rejections', status, page], queryFn: () => api.rejections.list({ status, page }) })
  const stats = useQuery({ queryKey: ['rejections', 'stats'], queryFn: () => api.rejections.stats() })
  const maxStat = Math.max(1, ...(stats.data ?? []).map((s) => s.n))
  const today = todayISO()

  return (
    <>
      <PageHeader
        title="Rejets de factures"
        subtitle="Chaque rejet fait repartir le délai de paiement : corrigez et redéposez au plus vite."
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('rejets'), (p) => (p ? 'Export Excel créé.' : null))}>
            Exporter
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
        <Card padded={false}>
          <div className="flex gap-2 border-b border-slate-100 p-3">
            {([null, 'ouvert', 'redepose', 'clos'] as (RejectionStatus | null)[]).map((s) => (
              <Button key={s ?? 'all'} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => (setStatus(s), setPage(1))}>
                {s ? REJECTION_STATUS[s].label : 'Tous'}
              </Button>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Rejetée le</th>
                <th>Facture</th>
                <th>Motif / pièce manquante</th>
                <th>Action corrective</th>
                <th>Re-dépôt prévu</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <DateText iso={r.rejected_at} />
                    <div className="text-xs text-slate-400">{r.days_open} j</div>
                  </td>
                  <td>
                    <button className="font-medium text-brand-700 hover:underline" onClick={() => ws.openInvoice(r.invoice_id)}>
                      {r.invoice_number}
                    </button>
                    <div className="max-w-48 truncate text-xs text-slate-500">{r.company_name}</div>
                    <Money minor={r.amount_minor} currency={r.currency} className="text-xs" />
                  </td>
                  <td className="max-w-56">
                    <div>{REJECTION_REASONS[r.reason_code]}</div>
                    {r.missing_document && <div className="text-xs text-red-700">Manque : {r.missing_document}</div>}
                    {r.reason_text && <div className="text-xs text-slate-500">{r.reason_text}</div>}
                  </td>
                  <td className="max-w-56 text-xs text-slate-600">
                    {r.corrective_action ?? '—'}
                    {r.contact_name && <div className="text-slate-400">Interlocuteur : {r.contact_name}</div>}
                  </td>
                  <td className={cx('whitespace-nowrap', r.status === 'ouvert' && r.redeposit_due && r.redeposit_due <= today && 'font-semibold text-red-700')}>
                    {r.status === 'ouvert' ? <DateText iso={r.redeposit_due} /> : <span className="text-xs text-slate-500">le <DateText iso={r.redeposited_at} /></span>}
                  </td>
                  <td>
                    <RejectionStatusBadge status={r.status} />
                  </td>
                  <td className="px-2 whitespace-nowrap">
                    {r.status === 'ouvert' && (
                      <Button size="sm" variant="primary" onClick={() => setRedeposit(r.invoice_id)}>
                        Redéposer
                      </Button>
                    )}{' '}
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(r)} title="Compléter le suivi" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.rows.length === 0 && (
            <EmptyState icon={<FileWarning className="size-10" />} title={status === 'ouvert' ? 'Aucun rejet à traiter' : 'Aucun rejet'} text="Pour enregistrer un rejet : ouvrez la facture → « Enregistrer un rejet »." />
          )}
          {list.data && list.data.total > list.data.page_size && (
            <div className="border-t border-slate-200 p-3">
              <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
            </div>
          )}
        </Card>
        <Card title="Motifs de rejet les plus fréquents">
          {stats.data?.length === 0 && <p className="text-sm text-slate-500">Pas encore de rejet.</p>}
          <ul className="space-y-2.5 text-sm">
            {stats.data?.map((s) => (
              <li key={s.reason_code}>
                <div className="flex justify-between">
                  <span>{REJECTION_REASONS[s.reason_code]}</span>
                  <b className="tabular">{s.n}</b>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${(s.n / maxStat) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">Astuce : si un motif revient souvent (PO manquant…), vérifiez systématiquement cette pièce avant le dépôt.</p>
        </Card>
      </div>
      {edit && <RejectionEditDialog row={edit} onClose={() => setEdit(null)} />}
      {redeposit !== null && <ActionDialog ids={[redeposit]} action="redeposer" onClose={() => setRedeposit(null)} />}
    </>
  )
}

function RejectionEditDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const [f, setF] = useState({
    reason_code: row.reason_code as RejectionReason,
    reason_text: row.reason_text ?? '',
    missing_document: row.missing_document ?? '',
    corrective_action: row.corrective_action ?? '',
    client_contact_id: row.client_contact_id,
    redeposit_due: row.redeposit_due ?? '',
    status: row.status
  })
  const { run, busy } = useRun()
  const contacts = useQuery({ queryKey: ['company', row.company_id], queryFn: () => api.companies.get(row.company_id) })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Suivi du rejet – facture ${row.invoice_number}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void run(() => api.rejections.update(row.id, f), 'Suivi enregistré.').then((r) => r && onClose())}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Motif">
          <Select value={f.reason_code} onChange={(e) => setF({ ...f, reason_code: e.target.value as RejectionReason })}>
            {Object.entries(REJECTION_REASONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pièce manquante">
          <Input value={f.missing_document} onChange={(e) => setF({ ...f, missing_document: e.target.value })} />
        </Field>
        <Field label="Détail du rejet" className="col-span-2">
          <Textarea rows={2} value={f.reason_text} onChange={(e) => setF({ ...f, reason_text: e.target.value })} />
        </Field>
        <Field label="Action corrective" className="col-span-2">
          <Textarea rows={2} value={f.corrective_action} onChange={(e) => setF({ ...f, corrective_action: e.target.value })} />
        </Field>
        <Field label="Responsable chez le client">
          <Select value={f.client_contact_id ?? ''} onChange={(e) => setF({ ...f, client_contact_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {contacts.data?.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} – {CONTACT_ROLES[c.role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Re-dépôt prévu le">
          <Input type="date" value={f.redeposit_due} onChange={(e) => setF({ ...f, redeposit_due: e.target.value })} />
        </Field>
        <Field label="Statut du suivi">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RejectionStatus })}>
            {Object.entries(REJECTION_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {f.status === 'clos' && row.status === 'ouvert' && (
        <div className="mt-3">
          <Alert tone="info">« Clos » sert pour un rejet abandonné (facture annulée par avoir…). Pour une facture corrigée, utilisez plutôt « Redéposer ».</Alert>
        </div>
      )}
    </Modal>
  )
}
