// Écrans d'accès : création du mot de passe, clé de secours, déverrouillage, mot de passe oublié.
import { useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Lock, ShieldCheck, Printer, Copy } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Checkbox, Field, Input } from '@/components/ui'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-900 via-brand-800 to-slate-900 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-700 text-white">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <div className="text-lg font-semibold text-slate-900">Recouvrement</div>
            <div className="text-xs text-slate-500">Suivi des factures et des relances</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function useSubmit() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, submit, setError }
}

function PasswordPair({ pw, setPw, pw2, setPw2 }: { pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void }) {
  const checks = [
    { ok: pw.length >= 8, label: 'au moins 8 caractères' },
    { ok: /[A-Za-zÀ-ÿ]/.test(pw) && /\d/.test(pw), label: 'des lettres et au moins un chiffre' },
    { ok: pw.length > 0 && pw === pw2, label: 'les deux saisies sont identiques' }
  ]
  return (
    <>
      <Field label="Nouveau mot de passe" required>
        <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Confirmez le mot de passe" required>
        <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </Field>
      <ul className="space-y-0.5 text-xs">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'text-emerald-700' : 'text-slate-500'}>
            {c.ok ? '✓' : '○'} {c.label}
          </li>
        ))}
      </ul>
    </>
  )
}

/** Affiche la clé de secours une seule fois, avec impression / copie. */
export function RecoveryKeyScreen({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  return (
    <Shell>
      <h1 className="mb-2 text-lg font-semibold">Votre clé de secours</h1>
      <p className="mb-4 text-sm text-slate-600">
        Si vous oubliez votre mot de passe, cette clé est le <b>seul moyen</b> de récupérer vos données. Imprimez-la ou recopiez-la, et rangez-la en lieu sûr (pas dans
        l’ordinateur).
      </p>
      <div className="mb-4 select-all rounded-lg border-2 border-dashed border-brand-600 bg-brand-50 p-4 text-center font-mono text-xl font-bold tracking-wider text-brand-900">
        {recoveryKey}
      </div>
      <div className="mb-4 flex gap-2">
        <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
          Imprimer
        </Button>
        <Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(recoveryKey)}>
          Copier
        </Button>
      </div>
      <Alert tone="warning">Sans mot de passe ni clé de secours, les données chiffrées sont définitivement illisibles. Personne ne pourra les récupérer.</Alert>
      <div className="mt-4">
        <Checkbox checked={saved} onChange={setSaved} label="J’ai imprimé ou recopié ma clé de secours et je l’ai rangée en lieu sûr." />
      </div>
      <Button variant="primary" className="mt-5 w-full" disabled={!saved} onClick={onDone}>
        Continuer
      </Button>
    </Shell>
  )
}

export function SetupScreen({ onDone }: { onDone: (recoveryKey: string) => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const { error, busy, submit, setError } = useSubmit()
  const go = (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) return setError('Les deux mots de passe ne sont pas identiques.')
    void submit(async () => onDone((await api.auth.setup(pw)).recoveryKey))
  }
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Bienvenue !</h1>
      <p className="mb-5 text-sm text-slate-600">
        Choisissez un mot de passe pour protéger vos données. Il sera demandé à chaque ouverture de l’application et après quelques minutes d’inactivité.
      </p>
      <form onSubmit={go} className="space-y-4">
        <PasswordPair pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Créer mon mot de passe
        </Button>
      </form>
    </Shell>
  )
}

export function LoginScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [pw, setPw] = useState('')
  const [key, setKey] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const { error, busy, submit, setError } = useSubmit()

  if (mode === 'recover') {
    return (
      <Shell>
        <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5 text-brand-700" /> Mot de passe oublié
        </h1>
        <p className="mb-5 text-sm text-slate-600">Saisissez la clé de secours imprimée lors de la création du compte, puis choisissez un nouveau mot de passe.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (pw1 !== pw2) return setError('Les deux mots de passe ne sont pas identiques.')
            void submit(async () => {
              await api.auth.recover(key, pw1)
              onUnlocked()
            })
          }}
          className="space-y-4"
        >
          <Field label="Clé de secours" required>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className="font-mono uppercase" autoFocus />
          </Field>
          <PasswordPair pw={pw1} setPw={setPw1} pw2={pw2} setPw2={setPw2} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Définir le nouveau mot de passe
          </Button>
          <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => (setMode('login'), setError(null))}>
            Retour
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Lock className="size-5 text-brand-700" /> Application verrouillée
      </h1>
      <p className="mb-5 text-sm text-slate-600">Saisissez votre mot de passe pour accéder à vos données.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit(async () => {
            await api.auth.unlock(pw)
            onUnlocked()
          })
        }}
        className="space-y-4"
      >
        <Field label="Mot de passe">
          <Input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Déverrouiller
        </Button>
        <button type="button" className="w-full text-center text-sm text-slate-500 hover:underline" onClick={() => (setMode('recover'), setError(null))}>
          Mot de passe oublié ?
        </button>
      </form>
    </Shell>
  )
}
