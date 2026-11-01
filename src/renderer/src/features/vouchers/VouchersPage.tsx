// Liste des bons de prise en charge : validité, plafond, consommation.
import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Plus, Ticket } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, EmptyState, HelpTip, Input, PageHeader, Pagination, SearchSelect, cx } from '@/components/ui'
import { DateText, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { VOUCHER_STATES, type VoucherState } from '@shared/constants'
import { useWorkspace } from '../workspace'
import { VoucherStateBadge } from './VoucherForm'

export function VouchersPage() {
  const ws = useWorkspace()
  const { run } = useRun()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [company, setCompany] = useState<number | null>(null)
  const [state, setState] = useState<VoucherState | null>(null)
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search), setPage(1)), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuery({
    queryKey: ['vouchers', debounced, company, state, page],
    queryFn: () => api.vouchers.list({ search: debounced, company_id: company, state, page }),
    placeholderData: keepPreviousData
  })
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Bons de prise en charge <HelpTip k="bon" />
          </span>
        }
        subtitle="Garanties de paiement émises par les entreprises. Les bons sont aussi créés automatiquement à la saisie des factures."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('bons'), (p) => (p ? 'Export Excel créé.' : null))}>
              Exporter
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ws.openVoucher(null)}>
              Nouveau bon
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <Input className="max-w-xs" placeholder="N° de bon, patient, matricule, PO…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="w-64">
            <SearchSelect options={[{ id: 0, name: 'Toutes les entreprises' }, ...(companies.data ?? [])]} value={company ?? 0} onChange={(id) => (setCompany(id || null), setPage(1))} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VOUCHER_STATES) as VoucherState[]).map((s) => (
              <button
                key={s}
                onClick={() => (setState(state === s ? null : s), setPage(1))}
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                  state === s ? VOUCHER_STATES[s].color + ' ring-2' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                )}
              >
                {VOUCHER_STATES[s].label}
                {list.data?.counts[s] ? <span className="ml-1 opacity-70">{list.data.counts[s]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">N° bon</th>
              <th>Entreprise</th>
              <th>Patient</th>
              <th>Valable jusqu’au</th>
              <th className="text-right">Plafond</th>
              <th className="text-right">Facturé</th>
              <th className="text-right">Factures</th>
              <th className="px-3">État</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((v) => (
              <tr key={v.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.openVoucher(v.id)}>
                <td className="tabular px-3 py-2 font-medium whitespace-nowrap">{v.number}</td>
                <td className="max-w-56 truncate">{v.company_name}</td>
                <td className="text-slate-600">{v.patient_name || v.patient_matricule}</td>
                <td>
                  <DateText iso={v.valid_until} />
                </td>
                <td className="text-right">{v.ceiling_minor ? <Money minor={v.ceiling_minor} currency={v.currency} /> : <span className="text-slate-400">—</span>}</td>
                <td className="text-right">
                  <Money minor={v.used_minor} currency={v.currency} />
                </td>
                <td className="tabular text-right">{v.invoice_count}</td>
                <td className="px-3">
                  <VoucherStateBadge state={v.state} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.rows.length === 0 && <EmptyState icon={<Ticket className="size-10" />} title="Aucun bon" text="Les bons saisis dans les factures apparaissent ici automatiquement." />}
        {list.data && list.data.total > list.data.page_size && (
          <div className="border-t border-slate-200 p-3">
            <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </>
  )
}
