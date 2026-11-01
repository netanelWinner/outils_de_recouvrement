// Recherche globale (Ctrl+K) : n° de facture, patient, matricule, bon, PO, entreprise, référence de paiement.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, FileText, Search, Ticket, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { Money, StatusBadge } from '@/components/display'
import { formatDate } from '@shared/dates'
import { cx } from '@/components/ui'
import { useWorkspace } from './workspace'

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hi, setHi] = useState(0)
  const ws = useWorkspace()
  const navigate = useNavigate()
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150)
    return () => clearTimeout(t)
  }, [q])
  const res = useQuery({ queryKey: ['search', debounced], queryFn: () => api.search.global(debounced), enabled: debounced.trim().length >= 2 })

  const items = [
    ...(res.data?.invoices ?? []).map((i) => ({ key: `i${i.id}`, run: () => ws.openInvoice(i.id), node: <InvoiceItem i={i} /> })),
    ...(res.data?.companies ?? []).map((c) => ({
      key: `c${c.id}`,
      run: () => navigate(`/entreprises/${c.id}`),
      node: (
        <span className="flex items-center gap-2">
          <Building2 className="size-4 text-slate-400" /> {c.name}
        </span>
      )
    })),
    ...(res.data?.vouchers ?? []).map((v) => ({
      key: `v${v.id}`,
      run: () => ws.openVoucher(v.id),
      node: (
        <span className="flex items-center gap-2">
          <Ticket className="size-4 text-slate-400" /> Bon <b>{v.number}</b> – {v.company_name} · {v.patient_name || v.patient_matricule}
        </span>
      )
    })),
    ...(res.data?.payments ?? []).map((p) => ({
      key: `p${p.id}`,
      run: () => ws.editPayment(p.id),
      node: (
        <span className="flex items-center gap-2">
          <Wallet className="size-4 text-slate-400" /> Paiement {p.reference} – {p.company_name} – {formatDate(p.received_at)} –{' '}
          <Money minor={p.amount_minor} currency={p.currency} />
        </span>
      )
    }))
  ]

  const choose = (k: number) => {
    const it = items[k]
    if (!it) return
    onClose()
    it.run()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <Search className="size-5 text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setHi(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, items.length - 1))
              if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0))
              if (e.key === 'Enter') choose(hi)
            }}
            placeholder="N° de facture, nom ou matricule du patient, n° de bon, entreprise…"
            className="w-full py-3.5 text-base outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {debounced.trim().length < 2 && <p className="px-4 py-6 text-center text-sm text-slate-500">Tapez au moins 2 caractères.</p>}
          {debounced.trim().length >= 2 && res.data && items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">Aucun résultat pour « {debounced} ».</p>}
          {items.map((it, k) => (
            <div
              key={it.key}
              onMouseEnter={() => setHi(k)}
              onMouseDown={() => choose(k)}
              className={cx('cursor-pointer px-4 py-2 text-sm', k === hi ? 'bg-brand-50' : '')}
            >
              {it.node}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer</div>
      </div>
    </div>
  )
}

function InvoiceItem({ i }: { i: Awaited<ReturnType<typeof api.search.global>>['invoices'][number] }) {
  return (
    <span className="flex items-center gap-2">
      <FileText className="size-4 shrink-0 text-slate-400" />
      <b className="tabular">{i.number}</b>
      <span className="truncate text-slate-600">
        {i.company_name} · {i.patient_name || i.patient_matricule}
        {i.voucher_number ? ` · bon ${i.voucher_number}` : ''}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Money minor={i.amount_minor} currency={i.currency} />
        <StatusBadge status={i.status} />
      </span>
    </span>
  )
}
