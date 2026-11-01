// Pilotage : prévisions d'encaissement, fiabilité des entreprises, rapports mensuels pour la direction.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileText, Mail, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, EmptyState, Field, HelpTip, Input, PageHeader, Spinner, Stat, Textarea, cx } from '@/components/ui'
import { DateText, Money, StatusBadge } from '@/components/display'
import { useRun } from '@/components/feedback'
import { formatMoney } from '@shared/money'
import { addMonths, todayISO } from '@shared/dates'
import { GRADE_INFO, type Grade } from '@shared/domain/scoring'
import { useWorkspace } from '../workspace'

// Palette validée : série 1 bleu (probable), gris neutre pour le total dû (référence, non catégorielle)
const C = { s1: '#2a78d6', ref: '#c3c2b7', grid: '#e1e0d9', axis: '#898781', ink: '#52514e' }
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v))

export function GradeBadge({ grade, score, insufficient }: { grade: Grade | null; score?: number | null; insufficient?: boolean }) {
  if (!grade)
    return (
      <span className="rounded px-1.5 py-0.5 text-xs text-slate-400" title="Pas assez de factures payées pour calculer une note">
        {insufficient ? 'Historique insuffisant' : '—'}
      </span>
    )
  return (
    <span title={`${GRADE_INFO[grade].label}${score != null ? ` – ${score}/100` : ''}`} className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold', GRADE_INFO[grade].color)}>
      {grade}
      {score != null && <span className="font-normal opacity-80">{score}</span>}
    </span>
  )
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)} %`)

// ---------------------------------------------------------------- Prévisions

export function ForecastPage() {
  const ws = useWorkspace()
  const q = useQuery({ queryKey: ['forecast'], queryFn: () => api.analytics.forecast(3) })
  if (!q.data) return <Spinner />
  const f = q.data
  const chart = f.buckets.map((b) => ({ label: b.label, Probable: b.expected, 'Total dû': b.potential }))
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Prévisions d’encaissement <HelpTip k="prevision" />
          </span>
        }
        subtitle="Estimation des sommes qui devraient rentrer dans les 3 prochains mois, en FCFA."
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {f.buckets.map((b, i) => (
          <Stat
            key={b.key}
            label={b.label}
            value={<Money minor={b.expected} currency="XAF" />}
            sub={`probable, sur ${formatMoney(b.potential, 'XAF')} dus (${b.count} facture${b.count > 1 ? 's' : ''})`}
            tone={i === 0 ? 'success' : 'default'}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <Card title="Probable et total dû par période">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart} margin={{ top: 12, right: 8, left: 8, bottom: 0 }} barGap={2} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.ink }} axisLine={{ stroke: C.axis }} tickLine={false} />
              <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={48} />
              <Tooltip formatter={(v) => formatMoney(Number(v), 'XAF')} cursor={{ fill: 'rgba(15,118,110,0.06)' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: C.ink }} />
              <Bar dataKey="Probable" fill={C.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="Total dû" fill={C.ref} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Par entreprise (3 mois)" padded={false}>
          <table className="w-full text-sm">
            <tbody>
              {f.by_company.slice(0, 10).map((c) => (
                <tr key={c.company_id} className="border-b border-slate-100">
                  <td className="max-w-0 w-full truncate px-4 py-2" title={c.company_name}>
                    {c.company_name}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money minor={c.expected} currency="XAF" strong />
                    <div className="text-xs text-slate-500">
                      sur <Money minor={c.potential} currency="XAF" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {f.by_company.length === 0 && <EmptyState title="Aucune somme attendue" />}
        </Card>
      </div>
      <div className="mt-5">
        <Card title="Détail par facture" padded={false}>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Date probable</th>
                <th>Facture</th>
                <th>Entreprise</th>
                <th>Statut</th>
                <th className="hidden 2xl:table-cell">Hypothèse</th>
                <th className="text-right">Reste dû</th>
                <th className="px-3 text-right">Probabilité</th>
              </tr>
            </thead>
            <tbody>
              {f.details.map((d) => (
                <tr key={d.invoiceId} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => ws.openInvoice(d.invoiceId)}>
                  <td className="px-3 py-1.5">
                    <DateText iso={d.date} />
                  </td>
                  <td className="tabular font-medium whitespace-nowrap">{d.number}</td>
                  <td className="w-full max-w-0 truncate" title={d.company_name}>{d.company_name}</td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="hidden text-xs text-slate-500 2xl:table-cell">{d.reason}</td>
                  <td className="text-right">
                    <Money minor={d.balanceXaf} currency="XAF" />
                  </td>
                  <td className="px-3 text-right">
                    <span className={cx('tabular font-semibold', d.probability >= 0.75 ? 'text-emerald-700' : d.probability >= 0.5 ? 'text-amber-700' : 'text-red-700')}>{Math.round(d.probability * 100)} %</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Fiabilité

export function ReliabilityPage() {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['reliability'], queryFn: () => api.analytics.reliability() })
  const [sort, setSort] = useState<'score' | 'outstanding'>('outstanding')
  if (!q.data) return <Spinner />
  const rows = [...q.data].sort((a, b) => (sort === 'score' ? (a.score ?? 101) - (b.score ?? 101) : b.outstanding_xaf - a.outstanding_xaf))
  const counts = q.data.reduce<Record<string, number>>((m, r) => ((m[r.grade ?? '?'] = (m[r.grade ?? '?'] ?? 0) + 1), m), {})
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Fiabilité des entreprises <HelpTip k="fiabilite" />
          </span>
        }
        subtitle="Note calculée sur 24 mois d’historique réel. Concentrez vos efforts sur les entreprises notées D et E qui ont un encours important."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['A', 'B', 'C', 'D', 'E'] as Grade[]).map((g) => (
          <span key={g} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
            <GradeBadge grade={g} /> {GRADE_INFO[g].label} : <b>{counts[g] ?? 0}</b>
          </span>
        ))}
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant={sort === 'outstanding' ? 'primary' : 'secondary'} onClick={() => setSort('outstanding')}>
            Trier par encours
          </Button>
          <Button size="sm" variant={sort === 'score' ? 'primary' : 'secondary'} onClick={() => setSort('score')}>
            Moins fiables d’abord
          </Button>
        </span>
      </div>
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Entreprise</th>
              <th>Note</th>
              <th className="text-right">Délai réel moyen</th>
              <th className="text-right">Retard moyen</th>
              <th className="text-right">Payées à l’échéance</th>
              <th className="text-right">Taux de rejet</th>
              <th className="text-right">Promesses tenues</th>
              <th className="px-3 text-right">Encours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company_id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/entreprises/${r.company_id}`)}>
                <td className="max-w-60 truncate px-3 py-2 font-medium">{r.company_name}</td>
                <td>
                  <GradeBadge grade={r.grade} score={r.score} insufficient={r.insufficient} />
                </td>
                <td className="tabular text-right">{r.avg_delay_days === null ? '—' : `${r.avg_delay_days} j`}</td>
                <td className={cx('tabular text-right', (r.avgLatenessDays ?? 0) > 30 && 'font-semibold text-red-700')}>{r.avgLatenessDays === null ? '—' : `${r.avgLatenessDays} j`}</td>
                <td className="tabular text-right">{pct(r.on_time_rate)}</td>
                <td className="tabular text-right">
                  {pct(r.rejection_rate)} <span className="text-xs text-slate-400">({r.rejected_count}/{r.deposited_count})</span>
                </td>
                <td className="tabular text-right">
                  {pct(r.promise_kept_rate)} {r.promises_count > 0 && <span className="text-xs text-slate-400">({r.promises_count})</span>}
                </td>
                <td className="px-3 text-right">{r.outstanding_xaf ? <Money minor={r.outstanding_xaf} currency="XAF" strong /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState title="Aucune entreprise" />}
      </Card>
    </>
  )
}

/** Carte de fiabilité pour la fiche d'une entreprise. */
export function ReliabilityCard({ companyId }: { companyId: number }) {
  const q = useQuery({ queryKey: ['reliability', companyId], queryFn: () => api.analytics.reliabilityOf(companyId) })
  const r = q.data
  if (!r) return null
  return (
    <Card
      title={
        <>
          Fiabilité <HelpTip k="fiabilite" />
        </>
      }
      actions={<GradeBadge grade={r.grade} score={r.score} insufficient={r.insufficient} />}
    >
      {r.insufficient ? (
        <p className="text-sm text-slate-500">Pas encore assez de factures payées ({r.paid_count}/3) pour une note fiable.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {r.components.map((c) => (
            <li key={c.label}>
              <div className="flex justify-between">
                <span>{c.label}</span>
                <span className="tabular text-slate-500">{c.value === null ? 'inconnu' : `${Math.round(c.value)}/100`}</span>
              </div>
              {c.value !== null && (
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${c.value}%` }} />
                </div>
              )}
            </li>
          ))}
          <li className="pt-1 text-xs text-slate-500">
            Paie en moyenne en {r.avg_delay_days} jours pour un délai contractuel de {r.avg_terms_days} jours (retard moyen : {r.avgLatenessDays} j).
          </li>
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Rapports mensuels

export function ReportsPage() {
  const { run, busy } = useRun()
  const lastMonth = addMonths(todayISO(), -1).slice(0, 7)
  const [month, setMonth] = useState(lastMonth)
  const [comment, setComment] = useState('')
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.reports.list() })
  const preview = useQuery({ queryKey: ['reports', 'preview', month], queryFn: () => api.reports.compute(month), enabled: /^\d{4}-\d{2}$/.test(month) })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const d = preview.data

  return (
    <>
      <PageHeader
        title="Rapports mensuels"
        subtitle="Synthèse du recouvrement pour la direction. Le rapport du mois écoulé est créé automatiquement au premier lancement de chaque mois."
      />
      {!settings.data?.reports.email_to && (
        <div className="mb-4">
          <Alert tone="info">Astuce : indiquez l’adresse e-mail de la direction dans Paramètres → Rapports pour que le rapport lui soit envoyé automatiquement chaque mois.</Alert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[2fr_3fr]">
        <Card title="Préparer un rapport">
          <div className="space-y-3">
            <Field label="Mois">
              <Input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="Votre commentaire (facultatif)" help="Contexte, difficultés, actions prévues… Il apparaît en tête du rapport.">
              <Textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<FileDown className="size-4" />} loading={busy} onClick={() => void run(() => api.reports.generate(month, { comment: comment || null, open: true }), (r) => `Rapport de ${r.label} créé.`)}>
                Générer le PDF
              </Button>
              <Button icon={<Mail className="size-4" />} loading={busy} disabled={!settings.data?.reports.email_to} onClick={() => void run(async () => {
                await api.reports.generate(month, { comment: comment || null })
                return api.reports.email(month)
              }, `Rapport envoyé à ${settings.data?.reports.email_to ?? ''}.`)}>
                Générer et envoyer à la direction
              </Button>
            </div>
          </div>
          {d && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-brand-800">Aperçu – {d.label}</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Encaissé</div>
                  <Money minor={d.kpis.collected.xaf} currency="XAF" strong />
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Facturé</div>
                  <Money minor={d.kpis.billed.xaf} currency="XAF" strong />
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Encours fin de mois</div>
                  <Money minor={d.kpis.outstanding_end} currency="XAF" strong />
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">DSO</div>
                  <b>{d.kpis.dso_end ?? '—'} j</b>
                </div>
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {d.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title="Rapports déjà produits" padded={false}>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Mois</th>
                <th className="text-right">Encaissé</th>
                <th className="text-right">Encours fin</th>
                <th className="px-3 text-right">DSO</th>
                <th className="px-3">Envoi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium capitalize">
                    {r.label}
                    <div className="text-xs font-normal text-slate-400">{r.auto ? 'automatique' : 'manuel'} · {r.generated_at.slice(0, 10).split('-').reverse().join('/')}</div>
                  </td>
                  <td className="text-right">
                    <Money minor={r.collected} currency="XAF" />
                  </td>
                  <td className="text-right">
                    <Money minor={r.outstanding_end} currency="XAF" />
                  </td>
                  <td className="tabular px-3 text-right whitespace-nowrap">{r.dso_end ?? '—'} j</td>
                  <td className="px-3 text-xs text-slate-500">{r.emailed_to ? `envoyé à ${r.emailed_to}` : '—'}</td>
                  <td className="px-2 text-right whitespace-nowrap">
                    <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => void run(() => api.reports.open(r.month))}>
                      Ouvrir
                    </Button>{' '}
                    <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} title="Recalculer avec les données actuelles" onClick={() => void run(() => api.reports.generate(r.month, { comment: r.comment }), 'Rapport recalculé.')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.length === 0 && <EmptyState icon={<FileText className="size-10" />} title="Aucun rapport pour l’instant" text="Le premier sera créé automatiquement au début du mois prochain, ou générez-le maintenant." />}
        </Card>
      </div>
    </>
  )
}
