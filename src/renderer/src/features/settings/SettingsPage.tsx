// Paramètres : hôpital, signature, devises, e-mail, sauvegarde, sécurité, démonstration.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen, HardDriveDownload, ImagePlus, KeyRound, RotateCcw, Send, Trash2 } from 'lucide-react'
import { api, type AppSettings } from '@/lib/api'
import { Alert, Button, Card, Checkbox, Field, Input, PageHeader, Spinner, Tabs, Textarea } from '@/components/ui'
import { CurrencySelect } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { EUR_TO_XAF } from '@shared/constants'
import { formatDate } from '@shared/dates'
import { RecoveryKeyScreen } from '../auth'
import { ReportsSettingsTab, UpdatesTab } from './SettingsV3'

type Tab = 'hopital' | 'signature' | 'devises' | 'email' | 'sauvegarde' | 'rapports' | 'securite' | 'misesajour' | 'demo'

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('onglet') as Tab) || 'hopital'
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  if (!s.data) return <Spinner />
  return (
    <>
      <PageHeader title="Paramètres" />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ onglet: t })}
        tabs={[
          { key: 'hopital', label: 'Hôpital' },
          { key: 'signature', label: 'Signature et cachet' },
          { key: 'devises', label: 'Devises' },
          { key: 'email', label: 'E-mail' },
          { key: 'sauvegarde', label: 'Sauvegarde' },
          { key: 'rapports', label: 'Rapports' },
          { key: 'securite', label: 'Sécurité' },
          { key: 'misesajour', label: 'Mises à jour' },
          { key: 'demo', label: 'Démonstration' }
        ]}
      />
      <div className="max-w-4xl">
        {tab === 'hopital' && <HospitalTab s={s.data} />}
        {tab === 'signature' && <SignatureTab s={s.data} />}
        {tab === 'devises' && <CurrencyTab s={s.data} />}
        {tab === 'email' && <EmailTab s={s.data} />}
        {tab === 'sauvegarde' && <BackupTab />}
        {tab === 'rapports' && <ReportsSettingsTab s={s.data} />}
        {tab === 'securite' && <SecurityTab s={s.data} />}
        {tab === 'misesajour' && <UpdatesTab s={s.data} />}
        {tab === 'demo' && <DemoTab s={s.data} />}
      </div>
    </>
  )
}

function SaveBar({ onSave, busy }: { onSave: () => void; busy: boolean }) {
  return (
    <div className="mt-4 flex justify-end">
      <Button variant="primary" loading={busy} onClick={onSave}>
        Enregistrer
      </Button>
    </div>
  )
}

export function AssetPicker({ kind, label, help }: { kind: 'logo' | 'signature' | 'cachet'; label: string; help?: string }) {
  const assets = useQuery({ queryKey: ['assets'], queryFn: () => api.settings.getAssets() })
  const { run } = useRun()
  const url = assets.data?.[kind]
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      <div className="flex h-24 items-center justify-center rounded-md bg-slate-50">
        {url ? <img src={url} alt={label} className="max-h-20 max-w-full object-contain" /> : <span className="text-xs text-slate-400">Aucune image</span>}
      </div>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => void run(() => api.settings.pickAsset(kind), (r) => (r ? 'Image enregistrée.' : null))}>
          {url ? 'Remplacer' : 'Choisir une image'}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" onClick={() => void run(() => api.settings.removeAsset(kind), 'Image retirée.')}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function HospitalTab({ s, onSaved }: { s: AppSettings; onSaved?: () => void }) {
  const [f, setF] = useState(s.hospital)
  const { run, busy } = useRun()
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })
  return (
    <Card title="Informations de l’hôpital (en-tête des documents)">
      <div className="grid grid-cols-[1fr_220px] gap-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nom de l’hôpital" required className="col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Adresse" className="col-span-2">
            <Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Ville">
            <Input value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Pays">
            <Input value={f.country ?? ''} onChange={(e) => set('country', e.target.value)} />
          </Field>
          <Field label="Téléphone">
            <Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="E-mail">
            <Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="NIU">
            <Input value={f.niu ?? ''} onChange={(e) => set('niu', e.target.value)} />
          </Field>
          <Field label="RCCM">
            <Input value={f.rccm ?? ''} onChange={(e) => set('rccm', e.target.value)} />
          </Field>
          <Field label="Coordonnées bancaires (banque, RIB/IBAN)" className="col-span-2" help="Affichées sur les relevés de compte pour faciliter le paiement.">
            <Textarea rows={2} value={f.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} />
          </Field>
        </div>
        <AssetPicker kind="logo" label="Logo" help="PNG ou JPG, 2 Mo max." />
      </div>
      <SaveBar busy={busy} onSave={() => void run(() => api.settings.update('hospital', f), 'Informations enregistrées.').then((r) => r && onSaved?.())} />
    </Card>
  )
}

export function SignatureTab({ s, onSaved }: { s: AppSettings; onSaved?: () => void }) {
  const [f, setF] = useState(s.signatory)
  const { run, busy } = useRun()
  return (
    <Card title="Bloc de signature des documents">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Votre nom" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Votre fonction" required>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <AssetPicker kind="signature" label="Signature scannée" help="Signez sur une feuille blanche, photographiez ou scannez, puis recadrez. Fond blanc ou transparent (PNG)." />
        <AssetPicker kind="cachet" label="Cachet de l’hôpital (facultatif)" />
        <div className="col-span-2">
          <Checkbox checked={f.show_stamp} onChange={(v) => setF({ ...f, show_stamp: v })} label="Apposer le cachet sur les documents PDF" />
        </div>
      </div>
      <SaveBar busy={busy} onSave={() => void run(() => api.settings.update('signatory', f), 'Signature enregistrée.').then((r) => r && onSaved?.())} />
    </Card>
  )
}

function CurrencyTab({ s }: { s: AppSettings }) {
  const [f, setF] = useState(s.currency)
  const [legal, setLegal] = useState(s.legal)
  const { run, busy } = useRun()
  return (
    <Card title="Devises et conversion">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Devise par défaut">
          <CurrencySelect value={f.default} onChange={(c) => setF({ ...f, default: c })} />
        </Field>
        <Field label="Taux USD → FCFA" help="Sert uniquement aux totaux consolidés du tableau de bord. Mettez-le à jour de temps en temps.">
          <Input type="number" step="0.01" value={f.usd_rate} onChange={(e) => setF({ ...f, usd_rate: Number(e.target.value) })} />
        </Field>
        <div className="col-span-2 text-sm text-slate-600">EUR → FCFA : parité fixe {EUR_TO_XAF.toLocaleString('fr-FR')} (zone CEMAC), non modifiable.</div>
        <Field label="Délai de prescription des créances (années)" help="5 ans par défaut (droit OHADA) – à confirmer avec le service juridique. Utilisé pour les alertes (V2).">
          <Input type="number" min={1} max={30} value={legal.prescription_years} onChange={(e) => setLegal({ prescription_years: Number(e.target.value) })} />
        </Field>
      </div>
      <SaveBar
        busy={busy}
        onSave={() =>
          void run(async () => {
            await api.settings.update('currency', f)
            await api.settings.update('legal', legal)
          }, 'Paramètres enregistrés.')
        }
      />
    </Card>
  )
}

function EmailTab({ s }: { s: AppSettings }) {
  const [f, setF] = useState(s.smtp)
  const [testTo, setTestTo] = useState(s.smtp.from_email ?? '')
  const { run, busy } = useRun()
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v })
  const presets = [
    { name: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false },
    { name: 'Outlook / Office 365', host: 'smtp.office365.com', port: 587, secure: false },
    { name: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: true }
  ]
  return (
    <Card title="Envoi d’e-mails (SMTP)">
      <Alert tone="info">
        Facultatif : sans configuration, vous pouvez toujours utiliser « Préparer un brouillon », qui ouvre le message dans Outlook ou Thunderbird. Pour Gmail ou Outlook, créez un
        « mot de passe d’application » (demandez de l’aide au service informatique de l’hôpital si besoin).
      </Alert>
      <div className="my-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button key={p.name} size="sm" onClick={() => setF({ ...f, host: p.host, port: p.port, secure: p.secure })}>
            Préremplir {p.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Serveur SMTP" className="col-span-2">
          <Input value={f.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="smtp.exemple.com" />
        </Field>
        <Field label="Port">
          <Input type="number" value={f.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="Identifiant">
          <Input value={f.user ?? ''} onChange={(e) => set('user', e.target.value)} />
        </Field>
        <Field label="Mot de passe">
          <Input type="password" value={f.pass ?? ''} onChange={(e) => set('pass', e.target.value)} />
        </Field>
        <div className="pt-6">
          <Checkbox checked={f.secure} onChange={(v) => set('secure', v)} label="Connexion SSL (port 465)" />
        </div>
        <Field label="Nom affiché de l’expéditeur">
          <Input value={f.from_name ?? ''} onChange={(e) => set('from_name', e.target.value)} placeholder="Service recouvrement – Hôpital" />
        </Field>
        <Field label="Adresse de l’expéditeur" className="col-span-2">
          <Input value={f.from_email ?? ''} onChange={(e) => set('from_email', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Field label="Envoyer un e-mail de test à">
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} className="w-72" />
          </Field>
          <Button icon={<Send className="size-4" />} loading={busy} onClick={() => void run(async () => {
            await api.settings.update('smtp', f)
            return api.mail.testSmtp(testTo || undefined)
          }, 'Configuration correcte : e-mail de test envoyé.')}>
            Tester
          </Button>
        </div>
        <Button variant="primary" loading={busy} onClick={() => void run(() => api.settings.update('smtp', f), 'Configuration e-mail enregistrée.')}>
          Enregistrer
        </Button>
      </div>
    </Card>
  )
}

export function BackupTab({ compact }: { compact?: boolean }) {
  const info = useQuery({ queryKey: ['backup', 'info'], queryFn: () => api.backup.info() })
  const list = useQuery({ queryKey: ['backup', 'list'], queryFn: () => api.backup.list(), enabled: !compact })
  const [f, setF] = useState<{ keep: number; auto: boolean } | null>(null)
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  useEffect(() => {
    if (info.data && !f) setF({ keep: info.data.keep, auto: info.data.auto })
  }, [info.data, f])
  if (!info.data || !f) return <Spinner />

  const restore = async (dir?: string, date?: string) => {
    const ok = await confirm({
      title: 'Restaurer une sauvegarde ?',
      message: (
        <>
          <p>Toutes les données actuelles seront remplacées par celles de la sauvegarde{date ? ` du ${date}` : ''}.</p>
          <p className="mt-2">Par précaution, une sauvegarde de l’état actuel sera faite juste avant. L’application redémarrera : connectez-vous avec le mot de passe en vigueur à la date de la sauvegarde.</p>
        </>
      ),
      danger: true,
      confirmLabel: 'Restaurer'
    })
    if (ok) await run(() => api.backup.restore(dir), (r) => (r.restored ? 'Restauration effectuée. Redémarrage…' : null))
  }

  return (
    <Card title="Sauvegarde">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
          <div className="text-sm">
            <div className="text-xs text-slate-500">Dossier de sauvegarde</div>
            <div className="font-medium break-all">{info.data.dir}</div>
            {info.data.is_default_dir && <div className="text-xs text-amber-700">Dossier par défaut sur ce PC : choisissez de préférence une clé USB ou un dossier OneDrive / Google Drive.</div>}
            <div className="mt-1 text-xs text-slate-500">Dernière sauvegarde : {info.data.last_at ? new Date(info.data.last_at).toLocaleString('fr-FR') : 'jamais'}</div>
          </div>
          <Button icon={<FolderOpen className="size-4" />} onClick={() => void run(() => api.backup.chooseDir(), (d) => (d ? 'Dossier de sauvegarde enregistré.' : null))}>
            Choisir…
          </Button>
        </div>
        {!compact && (
          <div className="flex flex-wrap items-end gap-4">
            <Checkbox checked={f.auto} onChange={(v) => setF({ ...f, auto: v })} label="Sauvegarde automatique chaque jour (à la première ouverture)" />
            <Field label="Nombre de sauvegardes automatiques conservées">
              <Input type="number" min={3} max={365} className="w-28" value={f.keep} onChange={(e) => setF({ ...f, keep: Number(e.target.value) })} />
            </Field>
            <Button onClick={() => void run(() => api.settings.update('backup', { dir: info.data!.is_default_dir ? null : info.data!.dir, ...f }), 'Paramètres enregistrés.')}>Enregistrer</Button>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="primary" icon={<HardDriveDownload className="size-4" />} loading={busy} onClick={() => void run(() => api.backup.run('manuelle'), 'Sauvegarde effectuée et vérifiée.')}>
            Sauvegarder maintenant
          </Button>
          {!compact && (
            <Button icon={<RotateCcw className="size-4" />} onClick={() => void restore()}>
              Restaurer depuis un dossier…
            </Button>
          )}
        </div>
        {!compact && list.data && list.data.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1">Date</th>
                <th>Type</th>
                <th className="text-right">Factures</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.name} className="border-t border-slate-100">
                  <td className="py-1.5">{new Date(b.manifest!.created_at).toLocaleString('fr-FR')}</td>
                  <td>{b.manifest!.reason}</td>
                  <td className="text-right">{b.manifest!.invoices}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => void restore(b.dir, formatDate(b.manifest!.created_at.slice(0, 10)))}>
                      Restaurer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

function SecurityTab({ s }: { s: AppSettings }) {
  const [minutes, setMinutes] = useState(s.security.lock_minutes)
  const [pw, setPw] = useState({ old: '', new1: '', new2: '' })
  const [regen, setRegen] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const { run, busy } = useRun()
  if (newKey) return <RecoveryKeyScreen recoveryKey={newKey} onDone={() => setNewKey(null)} />
  return (
    <div className="space-y-4">
      <Card title="Verrouillage automatique">
        <div className="flex items-end gap-3">
          <Field label="Verrouiller après (minutes d’inactivité)">
            <Input type="number" min={1} max={120} className="w-28" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </Field>
          <Button onClick={() => void run(() => api.settings.update('security', { lock_minutes: minutes }), 'Enregistré.')}>Enregistrer</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">L’application se verrouille aussi quand Windows est verrouillé (touche Windows + L) ou mis en veille.</p>
      </Card>
      <Card title="Changer de mot de passe">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Mot de passe actuel">
            <Input type="password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} />
          </Field>
          <Field label="Nouveau mot de passe">
            <Input type="password" value={pw.new1} onChange={(e) => setPw({ ...pw, new1: e.target.value })} />
          </Field>
          <Field label="Confirmation">
            <Input type="password" value={pw.new2} onChange={(e) => setPw({ ...pw, new2: e.target.value })} />
          </Field>
        </div>
        <SaveBar
          busy={busy}
          onSave={() =>
            void run(async () => {
              if (pw.new1 !== pw.new2) throw new Error('Les deux nouveaux mots de passe ne sont pas identiques.')
              await api.auth.changePassword(pw.old, pw.new1)
              setPw({ old: '', new1: '', new2: '' })
            }, 'Mot de passe modifié. Les sauvegardes antérieures restent protégées par l’ancien mot de passe.')
          }
        />
      </Card>
      <Card title="Clé de secours">
        <p className="mb-3 text-sm text-slate-600">Clé perdue ? Générez-en une nouvelle : l’ancienne ne fonctionnera plus.</p>
        <div className="flex items-end gap-3">
          <Field label="Mot de passe actuel">
            <Input type="password" value={regen} onChange={(e) => setRegen(e.target.value)} />
          </Field>
          <Button icon={<KeyRound className="size-4" />} onClick={() => void run(() => api.auth.regenerateRecoveryKey(regen)).then((r) => r && (setRegen(''), setNewKey(r.recoveryKey)))}>
            Générer une nouvelle clé
          </Button>
        </div>
      </Card>
      <Card title="Données">
        <p className="mb-3 text-sm text-slate-600">La base de données et les pièces jointes sont chiffrées (AES-256) dans le dossier de l’application.</p>
        <Button onClick={() => void api.app.openDataFolder()}>Ouvrir le dossier des données</Button>
      </Card>
    </div>
  )
}

function DemoTab({ s }: { s: AppSettings }) {
  const { run, busy } = useRun()
  const { confirm } = useFeedback()
  return (
    <Card title="Mode démonstration">
      <p className="mb-4 text-sm text-slate-600">
        Chargez 3 compagnies pétrolières fictives, 1 sous-traitant et une quarantaine de factures (payées, en retard, rejetées, en contentieux…) pour vous entraîner sans risque. Tout
        est marqué « (démo) » et s’efface en un clic, sans toucher à vos vraies données.
      </p>
      {s.demo_loaded ? (
        <Button
          variant="danger"
          loading={busy}
          icon={<Trash2 className="size-4" />}
          onClick={() =>
            void confirm({
              title: 'Effacer les données de démonstration ?',
              message: 'Les entreprises « (démo) » et TOUT ce qui leur est rattaché (factures, paiements, relances) seront définitivement supprimés. Vos vraies données ne sont pas concernées.',
              danger: true,
              confirmLabel: 'Effacer la démo'
            }).then((ok) => ok && run(() => api.demo.clear(), 'Données de démonstration effacées.'))
          }
        >
          Effacer les données de démonstration
        </Button>
      ) : (
        <Button variant="primary" loading={busy} onClick={() => void run(() => api.demo.load(), 'Données de démonstration chargées.')}>
          Charger les données de démonstration
        </Button>
      )}
    </Card>
  )
}
