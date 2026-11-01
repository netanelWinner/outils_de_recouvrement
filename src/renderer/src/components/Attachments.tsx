// Pièces jointes d'un dossier (facture, entreprise, convention, paiement), chiffrées sur le disque.
import { useQuery } from '@tanstack/react-query'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, EmptyState } from './ui'
import { useFeedback, useRun } from './feedback'

type Owner = 'company' | 'convention' | 'invoice' | 'payment' | 'voucher' | 'litigation'

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`)

export function Attachments({ owner, id }: { owner: Owner; id: number }) {
  const list = useQuery({ queryKey: ['attachments', owner, id], queryFn: () => api.attachments.list(owner, id) })
  const { run, busy } = useRun()
  const { toast } = useFeedback()
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">Scans de factures, bons, conventions, accusés de dépôt… Les fichiers sont chiffrés et rangés par dossier.</p>
        <Button size="sm" icon={<Paperclip className="size-3.5" />} loading={busy} onClick={() => void run(() => api.attachments.add(owner, id), (r) => (r.added ? `${r.added} pièce(s) ajoutée(s).` : null))}>
          Ajouter des pièces
        </Button>
      </div>
      {list.data?.length === 0 && <EmptyState icon={<Paperclip className="size-8" />} title="Aucune pièce jointe" />}
      <ul className="divide-y divide-slate-100">
        {list.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
            <FileText className="size-4 text-slate-400" />
            <button className="flex-1 truncate text-left text-brand-700 hover:underline" onClick={() => api.attachments.open(a.id).catch((e: Error) => toast({ tone: 'error', message: e.message }))}>
              {a.original_name}
            </button>
            <span className="text-xs text-slate-500">{size(a.size)}</span>
            <span className="text-xs text-slate-500">{a.created_at.slice(0, 10).split('-').reverse().join('/')}</span>
            <button
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Mettre à la corbeille"
              onClick={() => void run(() => api.attachments.remove(a.id), 'Pièce jointe mise à la corbeille.', () => api.trash.restore('attachment', a.id))}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
