// Guide de démarrage (premier lancement) : hôpital, signature, sauvegarde, puis premier pas.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Building2, CheckCircle2, FileSpreadsheet, PlayCircle, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Spinner, cx } from '@/components/ui'
import { useRun } from '@/components/feedback'
import { BackupTab, HospitalTab, SignatureTab } from './settings/SettingsPage'

const STEPS = ['Bienvenue', 'Votre hôpital', 'Votre signature', 'Sauvegarde', 'C’est parti']

export function Onboarding() {
  const [step, setStep] = useState(0)
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const navigate = useNavigate()
  const { run, busy } = useRun()
  if (!s.data) return <Spinner />

  const finish = async (then: 'demo' | 'company' | 'import' | 'empty') => {
    if (then === 'demo') await run(() => api.demo.load())
    navigate(then === 'company' ? '/entreprises' : then === 'import' ? '/import-export' : '/')
    await run(() => api.settings.setFlag('onboarding_done', true))
  }

  return (
    <div className="min-h-full bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <ol className="mb-6 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span className={cx('flex size-7 items-center justify-center rounded-full text-xs font-semibold', i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500')}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className={cx('text-sm', i === step ? 'font-semibold text-slate-900' : 'text-slate-500')}>{label}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Sparkles className="size-6 text-brand-700" /> Bienvenue dans votre outil de recouvrement
            </h1>
            <p className="mt-3 text-slate-600">En quelques minutes, nous allons préparer l’application. Voici ce qu’elle fera pour vous :</p>
            <ul className="mt-5 grid grid-cols-2 gap-4 text-sm">
              {[
                ['Suivre chaque facture', 'du dépôt au paiement, avec son bon de prise en charge et sa convention.'],
                ['Préparer vos relances chaque matin', 'par e-mail, WhatsApp ou courrier, selon un calendrier que vous choisissez.'],
                ['Gérer les rejets', 'en notant le motif et en faisant repartir le délai au re-dépôt.'],
                ['Présenter des chiffres clairs', 'à votre direction : balance âgée, taux de recouvrement, relevés PDF signés.']
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2 rounded-lg bg-slate-50 p-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  <span>
                    <b>{t}</b> {d}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Confidentialité : l’application ne doit contenir <b>aucune donnée médicale</b> (ni diagnostic, ni acte). Seulement le nom ou matricule du patient, la date, le montant et le n° de bon.
            </p>
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setStep(1)}>
                Commencer
              </Button>
            </div>
          </div>
        )}
        {step === 1 && (
          <>
            <p className="mb-3 text-sm text-slate-600">Ces informations apparaîtront en en-tête de vos lettres et relevés.</p>
            <HospitalTab s={s.data} onSaved={() => setStep(2)} />
          </>
        )}
        {step === 2 && (
          <>
            <p className="mb-3 text-sm text-slate-600">Votre nom et votre signature figureront au bas de chaque document. Vous pourrez ajouter la signature scannée plus tard.</p>
            <SignatureTab s={s.data} onSaved={() => setStep(3)} />
          </>
        )}
        {step === 3 && (
          <>
            <p className="mb-3 text-sm text-slate-600">Une copie chiffrée de vos données sera faite chaque jour. Idéalement sur une clé USB ou un dossier synchronisé (OneDrive, Google Drive).</p>
            <BackupTab compact />
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={() => setStep(4)}>
                Continuer
              </Button>
            </div>
          </>
        )}
        {step === 4 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Comment voulez-vous commencer ?</h2>
            <div className="mt-5 grid grid-cols-2 gap-4">
              {[
                { k: 'demo' as const, icon: PlayCircle, t: 'Découvrir avec des données fictives', d: 'Recommandé pour s’entraîner. 3 compagnies pétrolières fictives et ~40 factures, effaçables en un clic.' },
                { k: 'company' as const, icon: Building2, t: 'Créer ma première entreprise', d: 'Saisissez une compagnie pétrolière, ses interlocuteurs et sa convention.' },
                { k: 'import' as const, icon: FileSpreadsheet, t: 'Importer mon fichier Excel', d: 'Reprenez la liste des factures existantes en quelques clics.' },
                { k: 'empty' as const, icon: CheckCircle2, t: 'Commencer avec une application vide', d: 'Vous pourrez tout faire plus tard depuis le menu.' }
              ].map((o) => (
                <button key={o.k} disabled={busy} onClick={() => void finish(o.k)} className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-brand-600 hover:bg-brand-50 disabled:opacity-50">
                  <o.icon className="mt-0.5 size-6 shrink-0 text-brand-700" />
                  <span>
                    <span className="block font-semibold text-slate-900">{o.t}</span>
                    <span className="text-sm text-slate-500">{o.d}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {step > 0 && step < 4 && (
          <div className="mt-3 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Retour
            </Button>
            <Button variant="ghost" onClick={() => setStep(step + 1)}>
              Passer cette étape
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
