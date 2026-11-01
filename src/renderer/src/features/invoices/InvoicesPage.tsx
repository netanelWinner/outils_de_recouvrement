// Liste des factures : recherche, filtres, tri, sélection multiple, actions groupées, pagination, export.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Download, FileText, Send, Trash2, X } from 'lucide-react'
import { api, type InvoiceRow } from '@/lib/api'
import { Button, Card, EmptyState, Input, PageHeader, Pagination, SearchSelect, Select, cx } from '@/components/ui'
import { DateText, LateBadge, Money, MoneyByCurrency, StatusBadge } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { AGING_BUCKETS, CURRENCIES, INVOICE_STATUSES, STATUS_INFO, type AgingBucket, type Currency, type InvoiceAction, type InvoiceStatus } from '@shared/constants'
import { formatDate } from '@shared/dates'
import { useWorkspace } from '../workspace'
import { ActionDialog } from './dialogs'

type Sort = 'number' | 'company' | 'issue_date' | 'due_date' | 'amount' | 'balance' | 'status' | 'days_late'

interface Filters {
  search: string
  company_id: number | null
  statuses: InvoiceStatus[]
  currency: Currency | null
  aging: AgingBucket | null
  overdue_only: boolean
  kind: 'facture' | 'avoir' | 'all'
  issue_from: string
  issue_to: string
}

export function InvoicesPage() {
  const [params] = useSearchParams()
  const initial: Partial<Filters> = {
    statuses: params.get('statut') ? (params.get('statut')!.split(',') as InvoiceStatus[]) : [],
    aging: (params.get('anciennete') as AgingBucket) || null,
    overdue_only: params.get('retard') === '1',
    company_id: params.get('entreprise') ? Number(params.get('entreprise')) : null
  }
  const key = params.toString()
  return (
    <>
      <PageHeader title="Factures" subtitle="Toutes les factures et avoirs. Cliquez sur une ligne pour ouvrir la fiche." />
      <InvoiceTable key={key} initial={initial} />
    </>
  )
}

export function InvoiceTable({ initial, fixedCompanyId }: { initial?: Partial<Filters>; fixedCompanyId?: number }) {
  const ws = useWorkspace()
  const { run } = useRun()
  const { confirm, toast } = useFeedback()
  const [f, setF] = useState<Filters>({
    search: '',
    company_id: fixedCompanyId ?? null,
    statuses: [],
    currency: null,
    aging: null,
    overdue_only: false,
    kind: 'facture',
    issue_from: '',
    issue_to: '',
    ...initial
  })
  const [search, setSearch] = useState(f.search)
  const [sort, setSort] = useState<{ by: Sort; dir: 'asc' | 'desc' }>({ by: f.overdue_only || f.aging ? 'days_late' : 'issue_date', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [action, setAction] = useState<InvoiceAction | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setF((x) => ({ ...x, search })), 250)
    return () => clearTimeout(t)
  }, [search])

  const query = useMemo(
    () => ({
      search: f.search,
      company_id: fixedCompanyId ?? f.company_id,
      statuses: f.statuses,
      currency: f.currency,
      aging: f.aging,
      overdue_only: f.overdue_only,
      kind: f.kind,
      issue_from: f.issue_from || null,
      issue_to: f.issue_to || null,
      sort: sort.by,
      dir: sort.dir,
      page,
      page_size: pageSize
    }),
    [f, sort, page, pageSize, fixedCompanyId]
  )
  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [f, pageSize])

  const list = useQuery({ queryKey: ['invoices', query], queryFn: () => api.invoices.list(query), placeholderData: keepPreviousData })
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options(), enabled: !fixedCompanyId })

  const rows = list.data?.rows ?? []
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }))
  const activeFilters = f.statuses.length + (f.currency ? 1 : 0) + (f.aging ? 1 : 0) + (f.overdue_only ? 1 : 0) + (f.issue_from || f.issue_to ? 1 : 0) + (!fixedCompanyId && f.company_id ? 1 : 0) + (f.kind !== 'facture' ? 1 : 0)

  const sortBy = (by: Sort) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'desc' ? 'asc' : 'desc' }))
  // Colonnes secondaires masquées sur les écrans moyens : xl = 1280 px, 2xl = 1536 px
  const Th = ({ by, children, right, className }: { by?: Sort; children: React.ReactNode; right?: boolean; className?: string }) => (
    <th className={cx('px-2.5 py-2 font-medium whitespace-nowrap', right && 'text-right', className)}>
      {by ? (
        <button className={cx('inline-flex items-center gap-1 hover:text-slate-900', sort.by === by && 'text-brand-800')} onClick={() => sortBy(by)}>
          {children}
          {sort.by === by && (sort.dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
      ) : (
        children
      )}
    </th>
  )

  const selectAllMatching = async () => {
    const ids = await api.invoices.listIds(query)
    setSelected(new Set(ids))
  }

  const relaunch = () => {
    const chosen = rows.filter((r) => selected.has(r.id))
    const companiesSel = new Set(chosen.map((r) => r.company_id))
    if (chosen.length !== selected.size || companiesSel.size !== 1)
      return toast({ tone: 'info', message: 'Une relance groupée concerne une seule entreprise : sélectionnez des factures d’une même entreprise (sur cette page).' })
    ws.compose({ company_id: chosen[0].company_id, invoice_ids: chosen.filter((r) => r.balance_minor > 0).map((r) => r.id) })
  }

  const trash = async () => {
    const ids = [...selected]
    if (!(await confirm({ title: 'Mettre à la corbeille ?', message: `${ids.length} facture(s) seront placées dans la corbeille (restaurables pendant 30 jours). Les factures ayant reçu un paiement seront conservées.`, danger: true, confirmLabel: 'Mettre à la corbeille' })))
      return
    await run(
      () => api.invoices.remove(ids),
      (r) => `${r.done} facture(s) mise(s) à la corbeille.${r.blocked.length ? `\nConservées : ${r.blocked.map((b) => `${b.number} (${b.reason})`).join(' ; ')}` : ''}`
    )
    setSelected(new Set())
  }

  return (
    <div className="space-y-3">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-64 flex-1">
            <Input placeholder="Rechercher : n° de facture, patient, matricule, bon, PO, entreprise…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!fixedCompanyId && (
            <div className="w-64">
              <SearchSelect options={[{ id: 0, name: 'Toutes les entreprises' }, ...(companies.data ?? [])]} value={f.company_id ?? 0} onChange={(id) => set('company_id', id || null)} placeholder="Toutes les entreprises" />
            </div>
          )}
          <Select className="w-44" value={f.aging ?? ''} onChange={(e) => set('aging', (e.target.value as AgingBucket) || null)}>
            <option value="">Toute ancienneté</option>
            {AGING_BUCKETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.key === 'non_echu' ? 'Non échues' : `Retard ${b.label}`}
              </option>
            ))}
          </Select>
          <Select className="w-32" value={f.currency ?? ''} onChange={(e) => set('currency', (e.target.value as Currency) || null)}>
            <option value="">Devises</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={f.kind} onChange={(e) => set('kind', e.target.value as Filters['kind'])}>
            <option value="facture">Factures</option>
            <option value="avoir">Avoirs</option>
            <option value="all">Factures et avoirs</option>
          </Select>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            Émises du
            <Input type="date" className="w-36 py-1.5" value={f.issue_from} onChange={(e) => set('issue_from', e.target.value)} />
            au
            <Input type="date" className="w-36 py-1.5" value={f.issue_to} onChange={(e) => set('issue_to', e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2">
          <button
            onClick={() => set('overdue_only', !f.overdue_only)}
            className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', f.overdue_only ? 'bg-red-600 text-white ring-red-600' : 'bg-white text-red-700 ring-red-300 hover:bg-red-50')}
          >
            En retard uniquement
          </button>
          <span className="mx-1 h-4 border-l border-slate-200" />
          {INVOICE_STATUSES.filter((s) => s !== 'avoir').map((s) => {
            const on = f.statuses.includes(s)
            return (
              <button
                key={s}
                title={STATUS_INFO[s].help}
                onClick={() => set('statuses', on ? f.statuses.filter((x) => x !== s) : [...f.statuses, s])}
                className={cx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', on ? STATUS_INFO[s].color.replace('line-through', '') + ' ring-2' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}
              >
                {STATUS_INFO[s].label}
              </button>
            )
          })}
          {activeFilters > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="size-3.5" />}
              onClick={() => {
                setSearch('')
                setF({ search: '', company_id: fixedCompanyId ?? null, statuses: [], currency: null, aging: null, overdue_only: false, kind: 'facture', issue_from: '', issue_to: '' })
              }}
            >
              Effacer les filtres
            </Button>
          )}
          <Button size="sm" className="ml-auto" icon={<Download className="size-3.5" />} onClick={() => void run(() => api.excel.export('factures', query), (p) => (p ? 'Export Excel créé.' : null))}>
            Exporter (Excel)
          </Button>
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-600/30 bg-brand-50 px-3 py-2 text-sm">
          <b>{selected.size} sélectionnée(s)</b>
          {allOnPage && list.data && list.data.total > rows.length && selected.size < list.data.total && (
            <button className="text-brand-700 underline" onClick={() => void selectAllMatching()}>
              Sélectionner les {list.data.total} factures correspondant aux filtres
            </button>
          )}
          <span className="mx-1 h-4 border-l border-brand-600/30" />
          <Button size="sm" variant="primary" onClick={() => setAction('envoyer')}>
            Marquer déposées
          </Button>
          <Button size="sm" onClick={() => setAction('accepter')}>
            Marquer acceptées
          </Button>
          <Button size="sm" icon={<Send className="size-3.5" />} onClick={relaunch}>
            Relancer (groupé)
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => void trash()}>
            Corbeille
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Désélectionner
          </Button>
        </div>
      )}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="w-8 px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={allOnPage}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s)
                        rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id)))
                        return n
                      })
                    }
                  />
                </th>
                <Th by="number">N°</Th>
                {!fixedCompanyId && <Th by="company">Entreprise</Th>}
                <Th className="hidden xl:table-cell">Patient</Th>
                <Th className="hidden 2xl:table-cell">Bon</Th>
                <Th by="issue_date" className="hidden 2xl:table-cell">
                  Émise
                </Th>
                <Th by="due_date">Échéance</Th>
                <Th by="amount" right className="hidden xl:table-cell">
                  Montant
                </Th>
                <Th by="balance" right>
                  Reste dû
                </Th>
                <Th by="status">Statut</Th>
                <Th by="days_late">Retard</Th>
                <Th className="hidden 2xl:table-cell">Relancée</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: InvoiceRow) => (
                <tr key={r.id} className={cx('cursor-pointer border-b border-slate-100 hover:bg-slate-50', selected.has(r.id) && 'bg-brand-50/60')} onClick={() => ws.openInvoice(r.id)}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="size-4 accent-brand-700" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="tabular px-2.5 py-2 font-medium whitespace-nowrap text-slate-900">
                    {r.number}
                    {r.kind === 'avoir' && <span className="ml-1 text-xs text-teal-700">(avoir)</span>}
                  </td>
                  {!fixedCompanyId && (
                    <td className="w-full max-w-0 truncate px-2.5 py-2" title={r.company_name}>
                      {r.company_name}
                    </td>
                  )}
                  <td className={cx('hidden truncate px-2.5 py-2 text-slate-600 xl:table-cell', fixedCompanyId ? 'w-full max-w-0' : 'max-w-40')}>{r.patient_name || r.patient_matricule}</td>
                  <td className="hidden px-2.5 py-2 whitespace-nowrap text-slate-600 2xl:table-cell">{r.voucher_number ?? <span className="text-amber-600">—</span>}</td>
                  <td className="hidden px-2.5 py-2 2xl:table-cell">
                    <DateText iso={r.issue_date} />
                  </td>
                  <td className="px-2.5 py-2">
                    <DateText iso={r.due_date} />
                  </td>
                  <td className="hidden px-2.5 py-2 text-right xl:table-cell">
                    <Money minor={r.amount_minor} currency={r.currency} />
                  </td>
                  <td className="px-2.5 py-2 text-right whitespace-nowrap">{r.kind === 'facture' && r.balance_minor > 0 ? <Money minor={r.balance_minor} currency={r.currency} strong /> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-2.5 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-2.5 py-2">
                    <LateBadge days={r.days_late} />
                  </td>
                  <td className="hidden px-2.5 py-2 text-xs whitespace-nowrap text-slate-500 2xl:table-cell">{r.last_reminder_at ? formatDate(r.last_reminder_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && rows.length === 0 && (
            <EmptyState
              icon={<FileText className="size-10" />}
              title={activeFilters || f.search ? 'Aucune facture ne correspond à ces critères' : 'Aucune facture pour le moment'}
              text={activeFilters || f.search ? 'Modifiez ou effacez les filtres.' : 'Saisissez votre première facture, ou importez votre fichier Excel existant (menu Import / Export).'}
              action={!activeFilters && !f.search ? <Button variant="primary" onClick={() => ws.newInvoice({ company_id: fixedCompanyId })}>Nouvelle facture</Button> : undefined}
            />
          )}
        </div>
        {list.data && list.data.total > 0 && (
          <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
              <span>
                Total facturé : <MoneyByCurrency items={list.data.totals.map((t) => ({ currency: t.currency, amount: t.amount }))} />
              </span>
              <span>
                Reste dû : <b className="text-slate-900"><MoneyByCurrency items={list.data.totals.map((t) => ({ currency: t.currency, amount: f.kind === 'avoir' ? 0 : t.balance }))} /></b>
              </span>
            </div>
            <Pagination page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} onPageSize={setPageSize} />
          </div>
        )}
      </Card>
      {action && (
        <ActionDialog
          ids={[...selected]}
          action={action}
          onClose={() => {
            setAction(null)
            setSelected(new Set())
          }}
        />
      )}
    </div>
  )
}
