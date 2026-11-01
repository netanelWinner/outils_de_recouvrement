// Notifications (toasts) avec bouton « Annuler », et boîte de confirmation avant toute action destructrice.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Modal, cx } from './ui'

interface Toast {
  id: number
  tone: 'success' | 'error' | 'info'
  message: string
  action?: { label: string; run: () => void }
}
interface ConfirmOpts {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
}

const FeedbackCtx = createContext<{
  toast: (t: Omit<Toast, 'id'>) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
} | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setToasts((all) => [...all.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 10_000 : t.tone === 'error' ? 8000 : 4500)
  }, [])

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setPending({ ...o, resolve })), [])
  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'flex items-start gap-2.5 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg',
              t.tone === 'success' && 'border-emerald-200',
              t.tone === 'error' && 'border-red-200',
              t.tone === 'info' && 'border-sky-200'
            )}
          >
            {t.tone === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
            {t.tone === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            {t.tone === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />}
            <span className="flex-1 whitespace-pre-line text-slate-700">{t.message}</span>
            {t.action && (
              <button
                className="font-semibold text-brand-700 hover:underline"
                onClick={() => {
                  t.action!.run()
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={!!pending}
        onClose={() => close(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            {pending?.danger && <AlertTriangle className="size-5 text-red-600" />}
            {pending?.title}
          </span>
        }
        footer={
          <>
            <Button onClick={() => close(false)}>Annuler</Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {pending?.confirmLabel ?? 'Confirmer'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-slate-700">{pending?.message}</div>
      </Modal>
    </FeedbackCtx.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('FeedbackProvider manquant')
  return ctx
}

/**
 * Exécute une action : affiche l'erreur en français si elle échoue, rafraîchit toutes les données
 * si elle réussit, et affiche éventuellement un message de succès.
 */
export function useRun() {
  const { toast } = useFeedback()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string | null), undo?: () => Promise<unknown>): Promise<T | undefined> => {
      setBusy(true)
      try {
        const r = await fn()
        await qc.invalidateQueries()
        const msg = typeof success === 'function' ? success(r) : success
        if (msg)
          toast({
            tone: 'success',
            message: msg,
            action: undo
              ? {
                  label: 'Annuler',
                  run: () =>
                    void undo()
                      .then(() => qc.invalidateQueries())
                      .then(() => toast({ tone: 'info', message: 'Action annulée.' }))
                      .catch((e: Error) => toast({ tone: 'error', message: e.message }))
                }
              : undefined
          })
        return r
      } catch (e) {
        toast({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [qc, toast]
  )
  return { run, busy }
}
