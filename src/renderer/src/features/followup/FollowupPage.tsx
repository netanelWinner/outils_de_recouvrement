// Journal des échanges (appels, visites, e-mails reçus…) et suivi des promesses de paiement.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Check, Download, MessageSquarePlus, Send, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, EmptyState, HelpTip, PageHeader, Pagination, Select, Tabs, cx } from '@/components/ui'
import { DateText, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { ACTIVITY_TYPES, PROMISE_STATUS, type ActivityType, type PromiseStatus } from '@shared/constants'
import { useWorkspace } from '../workspace'

export function PromiseBadge({ status }: { status: PromiseStatus }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', PROMISE_STATUS[status].color)}>{PROMISE_STATUS[status].label}</span>
}

export function FollowupPage() {
  const ws = useWorkspace()
  const { run } = useRun()
  const [tab, setTab] = useState<'promesses' | 'journal'>('promesses')
  const alerts = useQuery({ queryKey: ['promises', 'alertes'], queryFn: () => api.activities.promises({ status: 'alertes' }) })
  return (
    <>
      <PageHeader
        title="Échanges et promesses"
        subtitle="Notez chaque appel, visite ou e-mail reçu. Une promesse de paiement suspend les relances jusqu’à la date promise."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('echanges'), (p) => (p ? 'Export Excel créé.' : null))}>
              Exporter
            </Button>
            <Button variant="primary" icon={<MessageSquarePlus className="size-4" />} onClick={() => ws.logActivity()}>
              Noter un échange
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'promesses', label: 'Promesses de paiement', count: alerts.data?.length },
          { key: 'journal', label: 'Journal des échanges' }
        ]}
      />
      {tab === 'promesses' ? <PromisesList /> : <ActivityJournal />}
    </>
  )
}

export function PromisesList({ companyId }: { companyId?: number }) {
  const ws = useWorkspace()
  const { run } = useRun()
  const [status, setStatus] = useState<PromiseStatus | 'alertes' | null>(companyId ? null : 'en_attente')
  const list = useQuery({ queryKey: ['promises', status, companyId], queryFn: () => api.activities.promises({ status, company_id: companyId }) })
  return (
    <Card padded={false}>
      <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
        {(
          [
            ['alertes', 'Non tenues à traiter'],
            ['en_attente', 'En attente'],
            ['tenue', 'Tenues'],
            [null, 'Toutes']
          ] as [PromiseStatus | 'alertes' | null, string][]
        ).map(([k, label]) => (
          <Button key={label} size="sm" variant={status === k ? 'primary' : 'secondary'} onClick={() => setStatus(k)}>
            {label}
          </Button>
        ))}
        <HelpTip k="promesse" />
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">Date promise</th>
            {!companyId && <th>Entreprise</th>}
            <th className="text-right">Montant promis</th>
            <th className="text-right">Reçu depuis</th>
            <th>Échange</th>
            <th>Statut</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.map((p) => (
            <tr key={p.id} className="border-b border-slate-100 align-top">
              <td className="px-3 py-2">
                <DateText iso={p.promised_date} />
              </td>
              {!companyId && <td className="max-w-48 truncate">{p.company_name}</td>}
              <td className="text-right">
                <Money minor={p.amount_minor} currency={p.currency} strong />
              </td>
              <td className="text-right">
                <Money minor={p.paid_since_minor} currency={p.currency} />
              </td>
              <td className="max-w-72 text-xs text-slate-600">
                <DateText iso={p.occurred_at} /> {p.contact_name ? `· ${p.contact_name}` : ''}
                <div className="line-clamp-2">{p.summary}</div>
              </td>
              <td>
                <PromiseBadge status={p.status} />
              </td>
              <td className="px-2 text-right whitespace-nowrap">
                {(p.status === 'non_tenue' || p.status === 'partielle') && (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Send className="size-3.5" />}
                      onClick={async () => {
                        const ids = p.invoice_ids ? p.invoice_ids.split(',').map(Number) : await api.invoices.listIds({ company_id: p.company_id, overdue_only: true })
                        ws.compose({ company_id: p.company_id, invoice_ids: ids })
                      }}
                    >
                      Relancer
                    </Button>{' '}
                    {!p.acknowledged_at && (
                      <Button size="sm" icon={<Check className="size-3.5" />} title="Retirer l’alerte" onClick={() => void run(() => api.activities.acknowledge(p.id), 'Alerte traitée.')}>
                        Vu
                      </Button>
                    )}
                  </>
                )}
                {p.status === 'en_attente' && (
                  <Button size="sm" variant="ghost" icon={<Ban className="size-3.5" />} onClick={() => void run(() => api.activities.cancelPromise(p.id), 'Promesse annulée : les relances reprennent.')}>
                    Annuler
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.length === 0 && <EmptyState title="Aucune promesse" text="Quand un client promet de payer, notez-le avec « Noter un échange »." />}
    </Card>
  )
}

export function ActivityJournal({ companyId }: { companyId?: number }) {
  const { run } = useRun()
  const [type, setType] = useState<ActivityType | null>(null)
  const [page, setPage] = useState(1)
  const list = useQuery({ queryKey: ['activities', companyId, type, page], queryFn: () => api.activities.list({ company_id: companyId, type, page }) })
  return (
    <Card padded={false}>
      <div className="border-b border-slate-100 p-3">
        <Select className="w-56" value={type ?? ''} onChange={(e) => (setType((e.target.value as ActivityType) || null), setPage(1))}>
          <option value="">Tous les types</option>
          {Object.entries(ACTIVITY_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <ul className="divide-y divide-slate-100">
        {list.data?.rows.map((a) => (
          <li key={a.id} className="flex gap-4 px-4 py-3 text-sm">
            <div className="w-24 shrink-0 text-slate-500">
              <DateText iso={a.occurred_at} />
              <div className="text-xs">{ACTIVITY_TYPES[a.type]}</div>
            </div>
            <div className="flex-1">
              {!companyId && <div className="font-medium text-slate-900">{a.company_name}</div>}
              <div className="text-slate-700">{a.summary}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                {a.contact_name && <span>Avec {a.contact_name}</span>}
                {a.invoice_numbers && <span>Factures : {a.invoice_numbers}</span>}
                {a.promise_status && (
                  <span className="flex items-center gap-1">
                    Promesse de <Money minor={a.promised_minor!} currency={a.promised_currency!} /> au <DateText iso={a.promised_date} /> <PromiseBadge status={a.promise_status} />
                  </span>
                )}
              </div>
            </div>
            <button
              className="self-start rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Mettre à la corbeille"
              onClick={() => void run(() => api.activities.remove(a.id), 'Échange mis à la corbeille.', () => api.trash.restore('activity', a.id))}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {list.data?.rows.length === 0 && <EmptyState title="Aucun échange noté" />}
      {list.data && list.data.total > list.data.page_size && (
        <div className="border-t border-slate-200 p-3">
          <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
        </div>
      )}
    </Card>
  )
}
