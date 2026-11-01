// Import Excel de la facturation existante (correspondance de colonnes + rapport d'erreurs) et exports.
import { useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, Checkbox, Field, PageHeader, Select } from '@/components/ui'
import { CurrencySelect } from '@/components/display'
import { useRun } from '@/components/feedback'
import { IMPORT_FIELDS, type ImportMapping } from '@shared/importFields'
import type { Currency } from '@shared/constants'

type Preview = NonNullable<Awaited<ReturnType<typeof api.excel.importPreview>>>
type Report = Awaited<ReturnType<typeof api.excel.importRun>>

export function ImportExportPage() {
  const { run, busy } = useRun()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<ImportMapping>({})
  const [opts, setOpts] = useState({ create_companies: true, default_currency: 'XAF' as Currency, default_status: 'envoyee' as 'brouillon' | 'envoyee' })
  const [report, setReport] = useState<Report | null>(null)

  const choose = async () => {
    const p = await run(() => api.excel.importPreview())
    if (p) {
      setPreview(p)
      setMapping(p.mapping)
      setReport(null)
    }
  }
  const exec = async (dry: boolean) => {
    if (!preview) return
    const r = await run(
      () => api.excel.importRun({ token: preview.token, mapping, ...opts, dry_run: dry }),
      (res) => (dry ? null : `${res.ok} facture(s) importée(s).`)
    )
    if (r) {
      setReport(r)
      if (!dry) setPreview(null)
    }
  }
  const missing = IMPORT_FIELDS.filter((f) => f.required && (mapping[f.key] === undefined || mapping[f.key] === null))

  return (
    <>
      <PageHeader title="Import / Export" subtitle="Reprenez votre fichier Excel existant, et exportez toutes vos listes." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_1fr]">
        <Card title="Importer des factures depuis Excel">
          {!preview && !report && (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                <li>Préparez un fichier Excel (.xlsx) ou CSV : une ligne par facture, avec une ligne d’en-têtes.</li>
                <li>Choisissez le fichier : l’application reconnaît automatiquement les colonnes.</li>
                <li>Vérifiez la correspondance, lancez la vérification, puis importez.</li>
              </ol>
              <Alert tone="info">Rien n’est enregistré avant votre confirmation finale. Les lignes en erreur sont ignorées et listées dans un rapport.</Alert>
              <div className="flex gap-2">
                <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={() => void choose()}>
                  Choisir le fichier Excel…
                </Button>
                <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.importTemplate(), (p) => (p ? 'Modèle Excel créé.' : null))}>
                  Télécharger le fichier modèle
                </Button>
              </div>
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span>
                  <FileSpreadsheet className="mr-1 inline size-4 text-emerald-600" />
                  <b>{preview.file_name}</b> – {preview.row_count} ligne(s) (en-têtes ligne {preview.header_row})
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  Changer de fichier
                </Button>
              </div>
              <h3 className="text-sm font-semibold text-brand-800">Correspondance des colonnes</h3>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                {IMPORT_FIELDS.map((f) => {
                  const idx = mapping[f.key]
                  const sample = idx !== undefined && idx !== null ? preview.sample.find((r) => r[idx] !== null && r[idx] !== undefined)?.[idx] : null
                  return (
                    <div key={f.key} className="flex items-center gap-2">
                      <label className={`w-44 text-sm ${f.required ? 'font-semibold' : ''}`}>
                        {f.label}
                        {f.required && <span className="text-red-500"> *</span>}
                      </label>
                      <div className="flex-1">
                        <Select value={idx ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })} className="py-1.5">
                          <option value="">— Ignorer —</option>
                          {preview.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </Select>
                        {sample !== null && sample !== undefined && <div className="mt-0.5 truncate text-xs text-slate-400">ex. : {String(sample)}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-3 gap-4 rounded-lg bg-slate-50 p-3">
                <Field label="Devise si non précisée">
                  <CurrencySelect value={opts.default_currency} onChange={(c) => setOpts({ ...opts, default_currency: c })} />
                </Field>
                <Field label="Statut si non précisé">
                  <Select value={opts.default_status} onChange={(e) => setOpts({ ...opts, default_status: e.target.value as 'brouillon' | 'envoyee' })}>
                    <option value="envoyee">Déposée / envoyée</option>
                    <option value="brouillon">Brouillon</option>
                  </Select>
                </Field>
                <div className="pt-6">
                  <Checkbox checked={opts.create_companies} onChange={(v) => setOpts({ ...opts, create_companies: v })} label="Créer les entreprises inconnues" />
                </div>
              </div>
              {missing.length > 0 && <Alert tone="warning">Colonnes obligatoires à associer : {missing.map((m) => m.label).join(', ')}.</Alert>}
              <div className="flex justify-end gap-2">
                <Button loading={busy} disabled={missing.length > 0} onClick={() => void exec(true)}>
                  1. Vérifier (sans rien enregistrer)
                </Button>
                <Button variant="primary" loading={busy} disabled={missing.length > 0 || !report?.dry_run} onClick={() => void exec(false)}>
                  2. Importer {report?.dry_run ? `les ${report.ok} ligne(s) valides` : ''}
                </Button>
              </div>
            </div>
          )}

          {report && (
            <div className="mt-4 space-y-3">
              <Alert tone={report.errors.length ? 'warning' : 'success'} title={report.dry_run ? 'Résultat de la vérification' : 'Import terminé'}>
                <p>
                  <CheckCircle2 className="mr-1 inline size-4" />
                  {report.ok} ligne(s) {report.dry_run ? 'prêtes à être importées' : 'importées'} sur {report.total}.
                  {report.errors.length > 0 && ` ${report.errors.length} ligne(s) en erreur seront ignorées.`}
                </p>
                {report.created_companies.length > 0 && <p className="mt-1">Entreprises {report.dry_run ? 'qui seront créées' : 'créées'} : {report.created_companies.join(', ')}</p>}
              </Alert>
              {report.errors.length > 0 && (
                <>
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5">Ligne</th>
                          <th>N° facture</th>
                          <th>Problème</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.errors.map((e) => (
                          <tr key={e.row} className="border-t border-slate-100">
                            <td className="tabular px-3 py-1">{e.row}</td>
                            <td>{e.number}</td>
                            <td className="text-red-700">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void run(() => api.excel.exportImportErrors(report.errors), (p) => (p ? 'Rapport d’erreurs exporté.' : null))}>
                    Exporter le rapport d’erreurs (Excel)
                  </Button>
                </>
              )}
              {!report.dry_run && (
                <Button variant="primary" onClick={() => setReport(null)}>
                  Importer un autre fichier
                </Button>
              )}
            </div>
          )}
        </Card>

        <Card title="Exporter vers Excel">
          <div className="space-y-2">
            {(
              [
                ['factures', 'Toutes les factures et avoirs'],
                ['paiements', 'Tous les paiements'],
                ['entreprises', 'Entreprises et encours'],
                ['balance_agee', 'Balance âgée par entreprise'],
                ['relances', 'Historique des relances'],
                ['bons', 'Bons de prise en charge'],
                ['rejets', 'Rejets de factures'],
                ['echanges', 'Échanges et promesses'],
                ['contentieux', 'Dossiers de contentieux']
              ] as const
            ).map(([k, label]) => (
              <Button key={k} className="w-full justify-start" icon={<FileSpreadsheet className="size-4 text-emerald-600" />} onClick={() => void run(() => api.excel.export(k), (p) => (p ? 'Export Excel créé.' : null))}>
                {label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">Astuce : depuis la liste des factures, « Exporter » ne reprend que les factures filtrées.</p>
        </Card>
      </div>
    </>
  )
}
