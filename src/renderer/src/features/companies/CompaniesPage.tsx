// Liste des entreprises clientes avec leur encours.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, Download, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui'
import { Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { COMPANY_TYPES, type CompanyType } from '@shared/constants'
import { CompanyForm } from './forms'
import { GradeBadge } from '../analytics/AnalyticsPages'

export function CompaniesPage() {
  const navigate = useNavigate()
  const { run } = useRun()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<CompanyType | null>(null)
  const [sort, setSort] = useState<'name' | 'outstanding' | 'overdue'>('outstanding')
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['companies', search, type, sort], queryFn: () => api.companies.list({ search, type, sort }) })
  const rel = useQuery({ queryKey: ['reliability'], queryFn: () => api.analytics.reliability() })
  const grades = new Map(rel.data?.map((r) => [r.company_id, r]) ?? [])

  return (
    <>
      <PageHeader
        title="Entreprises"
        subtitle="Compagnies pétrolières, sous-traitants et autres clients."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('entreprises'), (p) => (p ? 'Export Excel créé.' : null))}>
              Exporter
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nouvelle entreprise
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-3">
          <Input className="max-w-xs" placeholder="Rechercher une entreprise…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="w-52" value={type ?? ''} onChange={(e) => setType((e.target.value as CompanyType) || null)}>
            <option value="">Tous les types</option>
            {Object.entries(COMPANY_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select className="w-56" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="outstanding">Trier par total dû</option>
            <option value="overdue">Trier par montant en retard</option>
            <option value="name">Trier par nom</option>
          </Select>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Entreprise</th>
              <th>Type</th>
              <th>Fiabilité</th>
              <th className="text-right">Délai</th>
              <th className="text-right">Factures ouvertes</th>
              <th className="text-right">Total dû (équiv. FCFA)</th>
              <th className="px-4 text-right">Dont en retard</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/entreprises/${c.id}`)}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">{c.name}</div>
                  {c.parent_name && <div className="text-xs text-slate-500">Sous-traitant de {c.parent_name}</div>}
                </td>
                <td>
                  <Badge>{COMPANY_TYPES[c.type]}</Badge>
                </td>
                <td>
                  <GradeBadge grade={grades.get(c.id)?.grade ?? null} score={grades.get(c.id)?.score} insufficient={grades.get(c.id)?.insufficient} />
                </td>
                <td className="tabular text-right">{c.payment_terms_days} j</td>
                <td className="tabular text-right">{c.open_count || '—'}</td>
                <td className="text-right">{c.outstanding_xaf > 0 ? <Money minor={c.outstanding_xaf} currency="XAF" strong /> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 text-right">{c.overdue_xaf > 0 ? <Money minor={c.overdue_xaf} currency="XAF" className="font-semibold text-red-700" /> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && (
          <EmptyState
            icon={<Building2 className="size-10" />}
            title={search || type ? 'Aucune entreprise trouvée' : 'Aucune entreprise'}
            text="Commencez par créer les entreprises clientes de l’hôpital (compagnies pétrolières et sous-traitants)."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Nouvelle entreprise
              </Button>
            }
          />
        )}
      </Card>
      {creating && <CompanyForm company={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/entreprises/${id}`)} />}
    </>
  )
}
