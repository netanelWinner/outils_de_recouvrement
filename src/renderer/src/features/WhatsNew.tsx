// « Quoi de neuf ? » : affiché une fois après une mise à jour.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Modal } from '@/components/ui'

export function WhatsNew() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['whatsNew'], queryFn: () => api.updates.whatsNew(), staleTime: Infinity })
  if (!q.data?.length) return null
  const close = () => void api.updates.markSeen().then(() => qc.setQueryData(['whatsNew'], []))
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-5 text-brand-700" /> Quoi de neuf ?
        </span>
      }
      footer={
        <Button variant="primary" onClick={close}>
          J’ai compris
        </Button>
      }
    >
      <div className="space-y-4">
        {q.data.map((c) => (
          <section key={c.version}>
            <h3 className="font-semibold text-slate-900">
              Version {c.version} – {c.title}
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {c.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-slate-500">Vos données ont été conservées. Une sauvegarde a été faite avant la mise à jour.</p>
      </div>
    </Modal>
  )
}
