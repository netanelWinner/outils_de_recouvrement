// Liste des paiements reçus.
import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, Checkbox, EmptyState, Input, PageHeader, Pagination, SearchSelect, Select } from '@/components/ui'
import { DateText, Money, MoneyByCurrency } from '@/components/display'
import { useRun } from '@/components/feedback'
import { PAYMENT_METHODS, type PaymentMethod } from '@shared/constants'
import { useWorkspace } from '../workspace'

export function PaymentsPage() {
  const ws = useWorkspace()
  const { run } = useRun()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [company, setCompany] = useState<number | null>(null)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unallocated, setUnallocated] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])
  const query = useMemo(
    () => ({ search: debounced, company_id: company, method, from: from || null, to: to || null, unallocated_only: unallocated, page, page_size: pageSize }),
    [debounced, company, method, from, to, unallocated, page, pageSize]
  )
  useEffect(() => setPage(1), [debounced, company, method, from, to, unallocated, pageSize])
  const list = useQuery({ queryKey: ['payments', query], queryFn: () => api.payments.list(query), placeholderData: keepPreviousData })
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })

  return (
    <>
      <PageHeader
        title="Paiements"
        subtitle="Virements, chèques et espèces reçus, et les factures qu’ils règlent."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('paiements', query), (p) => (p ? 'Export Excel créé.' : null))}>
              Exporter
            </Button>
            <Button variant="primary" icon={<Wallet className="size-4" />} onClick={() => ws.newPayment()}>
              Enregistrer un paiement
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <Input className="max-w-xs" placeholder="Référence, entreprise, n° de facture…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="w-64">
            <SearchSelect options={[{ id: 0, name: 'Toutes les entreprises' }, ...(companies.data ?? [])]} value={company ?? 0} onChange={(id) => setCompany(id || null)} />
          </div>
          <Select className="w-36" value={method ?? ''} onChange={(e) => setMethod((e.target.value as PaymentMethod) || null)}>
            <option value="">Tous modes</option>
            {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <span className="text-xs text-slate-500">du</span>
          <Input type="date" className="w-36 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-slate-500">au</span>
          <Input type="date" className="w-36 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
          <Checkbox checked={unallocated} onChange={setUnallocated} label="Non entièrement imputés" />
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th>Entreprise</th>
              <th>Mode</th>
              <th>Référence</th>
              <th className="text-right">Montant</th>
              <th className="text-right">Non imputé</th>
              <th className="px-3">Factures réglées</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.editPayment(p.id)}>
                <td className="px-3 py-2">
                  <DateText iso={p.received_at} />
                </td>
                <td className="max-w-60 truncate">{p.company_name}</td>
                <td>{PAYMENT_METHODS[p.method]}</td>
                <td className="text-slate-600">{p.reference}</td>
                <td className="text-right">
                  <Money minor={p.amount_minor} currency={p.currency} strong />
                </td>
                <td className="text-right">{p.unallocated_minor > 0 ? <Money minor={p.unallocated_minor} currency={p.currency} className="text-amber-700" /> : <span className="text-slate-400">—</span>}</td>
                <td className="max-w-72 truncate px-3 text-xs text-slate-600">{p.invoice_numbers}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.rows.length === 0 && (
          <EmptyState icon={<Wallet className="size-10" />} title="Aucun paiement" text="Enregistrez chaque virement, chèque ou versement en espèces reçu, et rattachez-le aux factures qu’il règle." />
        )}
        {list.data && list.data.total > 0 && (
          <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-sm text-slate-600">
              Total encaissé : <b className="text-slate-900"><MoneyByCurrency items={list.data.totals} /></b>
            </div>
            <Pagination page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
          </div>
        )}
      </Card>
    </>
  )
}
