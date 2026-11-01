// Paramètres V3 : rapports mensuels automatiques et mises à jour de l'application.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileUp, FolderOpen, RefreshCw } from 'lucide-react'
import { api, type AppSettings } from '@/lib/api'
import { Alert, Button, Card, Checkbox, Field, Input } from '@/components/ui'
import { useFeedback, useRun } from '@/components/feedback'

export function ReportsSettingsTab({ s }: { s: AppSettings }) {
  const [f, setF] = useState({ auto: s.reports.auto, email_to: s.reports.email_to ?? '' })
  const dir = useQuery({ queryKey: ['reports', 'dir'], queryFn: () => api.reports.dir() })
  const { run, busy } = useRun()
  return (
    <Card title="Rapport mensuel pour la direction">
      <div className="space-y-4">
        <Checkbox
          checked={f.auto}
          onChange={(v) => setF({ ...f, auto: v })}
          label="Créer automatiquement le rapport du mois écoulé"
          help="Au premier lancement de l’application chaque mois. Vous recevez une notification quand il est prêt."
        />
        <Field label="E-mail(s) de la direction" help="Si renseigné (et l’e-mail configuré), le rapport automatique est aussi envoyé. Plusieurs adresses : séparez-les par des virgules.">
          <Input value={f.email_to} onChange={(e) => setF({ ...f, email_to: e.target.value })} placeholder="directeur@hopital.cg, daf@hopital.cg" />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <div className="text-xs text-slate-500">Dossier des rapports</div>
            <div className="font-medium break-all">{dir.data}</div>
          </div>
          <Button icon={<FolderOpen className="size-4" />} onClick={() => void run(() => api.reports.chooseDir(), (d) => (d ? 'Dossier enregistré.' : null))}>
            Choisir…
          </Button>
        </div>
        {f.email_to && !s.smtp_configured && <Alert tone="warning">L’envoi d’e-mails n’est pas configuré (onglet E-mail) : le rapport sera créé mais pas envoyé.</Alert>}
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={() => void run(() => api.settings.update('reports', { auto: f.auto, email_to: f.email_to || null }), 'Paramètres des rapports enregistrés.')}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function UpdatesTab({ s }: { s: AppSettings }) {
  const info = useQuery({ queryKey: ['updates', 'info'], queryFn: () => api.updates.info() })
  const [url, setUrl] = useState(s.updates.url ?? '')
  const [found, setFound] = useState<{ available: boolean; version: string; notes: string | null } | null>(null)
  const { run, busy } = useRun()
  const { confirm, toast } = useFeedback()

  const fromFile = async () => {
    const p = await run(() => api.updates.pickInstaller())
    if (!p) return
    if (!p.newer) {
      toast({ tone: 'info', message: `Ce fichier contient la version ${p.version}, qui n’est pas plus récente que la version installée (${p.current}).` })
      return
    }
    const ok = await confirm({
      title: `Installer la version ${p.version} ?`,
      message: (
        <>
          <p>Une sauvegarde sera faite, puis l’application se fermera et l’installateur s’ouvrira.</p>
          <p className="mt-2">Suivez l’installateur (Suivant → Installer), puis relancez l’application. Vos données sont conservées.</p>
        </>
      ),
      confirmLabel: 'Installer'
    })
    if (ok) await run(() => api.updates.installFromFile(p.token), 'Installation lancée…')
  }

  return (
    <div className="space-y-4">
      <Card title="Version installée">
        <p className="text-sm">
          Recouvrement <b>version {info.data?.version}</b>
          {info.data?.last_check && <span className="text-slate-500"> · dernière vérification en ligne le {new Date(info.data.last_check).toLocaleDateString('fr-FR')}</span>}
        </p>
      </Card>
      <Card title="Mettre à jour depuis un fichier (recommandé)">
        <p className="mb-3 text-sm text-slate-600">
          Vous avez reçu le fichier <code>Recouvrement-Installation-x.y.z.exe</code> (clé USB, e-mail, WhatsApp…) ? Choisissez-le : une sauvegarde est faite, puis la nouvelle version s’installe en gardant vos
          données.
        </p>
        <Button variant="primary" icon={<FileUp className="size-4" />} loading={busy} onClick={() => void fromFile()}>
          Choisir le fichier d’installation…
        </Button>
      </Card>
      <Card title="Mise à jour en ligne (facultatif)">
        <div className="space-y-3">
          <Field label="Adresse des mises à jour" help="Fournie par la personne qui maintient l’application (dossier web contenant latest.yml).">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/recouvrement" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void run(() => api.settings.update('updates', { url: url || null }), 'Adresse enregistrée.')}>Enregistrer l’adresse</Button>
            <Button
              icon={<RefreshCw className="size-4" />}
              loading={busy}
              disabled={!url}
              onClick={() =>
                void run(async () => {
                  await api.settings.update('updates', { url })
                  const r = await api.updates.checkOnline()
                  setFound(r ?? null)
                  return r
                }, (r) => (r?.available ? null : 'Vous avez déjà la dernière version.'))
              }
            >
              Rechercher une mise à jour
            </Button>
          </div>
          {found?.available && (
            <Alert
              tone="success"
              title={`Version ${found.version} disponible`}
              action={
                <Button
                  variant="primary"
                  icon={<Download className="size-4" />}
                  loading={busy}
                  onClick={() =>
                    void confirm({ title: 'Installer la mise à jour ?', message: 'Une sauvegarde sera faite, la mise à jour téléchargée, puis l’application redémarrera.', confirmLabel: 'Installer' }).then(
                      (ok) => ok && run(() => api.updates.installOnline(), 'Mise à jour en cours… l’application va redémarrer.')
                    )
                  }
                >
                  Installer maintenant
                </Button>
              }
            >
              {found.notes}
            </Alert>
          )}
        </div>
      </Card>
    </div>
  )
}
