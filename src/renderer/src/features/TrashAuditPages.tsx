// Corbeille (restauration / suppression définitive) et journal d'audit.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination } from '@/components/ui'
import { useFeedback, useRun } from '@/components/feedback'

const TYPE_LABELS: Record<string, string> = {
  company: 'Entreprise',
  contact: 'Interlocuteur',
  convention: 'Convention',
  voucher: 'Bon de prise en charge',
  litigation: 'Dossier de contentieux',
  activity: 'Échange',
  invoice: 'Facture',
  payment: 'Paiement',
  template: 'Modèle',
  attachment: 'Pièce jointe'
}

const fmt = (at: string) => at.slice(0, 16).replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1')

export function TrashPage() {
  const list = useQuery({ queryKey: ['trash'], queryFn: () => api.trash.list() })
  const { run } = useRun()
  const { confirm } = useFeedback()
  return (
    <>
      <PageHeader title="Corbeille" subtitle="Les éléments supprimés sont conservés 30 jours avant d’être effacés définitivement." />
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Type</th>
              <th>Élément</th>
              <th>Détail</th>
              <th>Supprimé le</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.map((t) => (
              <tr key={`${t.type}-${t.id}`} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  <Badge>{TYPE_LABELS[t.type]}</Badge>
                </td>
                <td className="font-medium">{t.label}</td>
                <td className="text-slate-500">{t.detail}</td>
                <td className="tabular text-slate-500">{fmt(t.deleted_at)}</td>
                <td className="px-3 text-right whitespace-nowrap">
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void run(() => api.trash.restore(t.type, t.id), 'Élément restauré.')}>
                    Restaurer
                  </Button>{' '}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={() =>
                      void confirm({ title: 'Supprimer définitivement ?', message: `« ${t.label} » sera effacé pour toujours. Cette action est irréversible.`, danger: true, confirmLabel: 'Supprimer définitivement' }).then(
                        (ok) => ok && run(() => api.trash.purge(t.type, t.id), 'Élément supprimé définitivement.')
                      )
                    }
                  >
                    Supprimer
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <EmptyState icon={<Trash2 className="size-10" />} title="La corbeille est vide" />}
      </Card>
    </>
  )
}

export function AuditPage() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => {
    const t = setTimeout(() => (setDebounced(search), setPage(1)), 250)
    return () => clearTimeout(t)
  }, [search])
  const list = useQuery({ queryKey: ['audit', debounced, page], queryFn: () => api.audit.list({ search: debounced, page }) })
  return (
    <>
      <PageHeader title="Journal d’audit" subtitle="Toutes les actions effectuées dans l’application, horodatées." />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-3">
          <Input className="max-w-sm" placeholder="Rechercher dans le journal…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th>Action</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="tabular px-4 py-1.5 whitespace-nowrap text-slate-500">{fmt(r.at)}</td>
                <td>
                  <Badge>{r.action}</Badge>
                </td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && (
          <div className="border-t border-slate-200 p-3">
            <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </>
  )
}
