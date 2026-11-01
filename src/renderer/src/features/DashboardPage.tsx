// Tableau de bord : encours, balance âgée, taux de recouvrement, DSO, évolution mensuelle, top débiteurs.
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, Card, FitText, HelpTip, PageHeader, Spinner, Stat } from '@/components/ui'
import { Money, MoneyByCurrency } from '@/components/display'
import { useRun } from '@/components/feedback'
import { AGING_BUCKETS, type AgingBucket } from '@shared/constants'
import { formatMoney } from '@shared/money'
import { formatMonthShort } from '@shared/dates'

// Couleurs validées (palette de référence) : série 1 bleu, série 2 orange ; encre et grilles discrètes.
const C = { s1: '#2a78d6', s2: '#eb6834', grid: '#e1e0d9', axis: '#898781', ink: '#52514e' }

/** Montants compacts pour les axes : 1,2 M ; 850 k. */
const compact = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Md` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v))

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-slate-800">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
          {p.name} : <b className="tabular text-slate-900">{formatMoney(p.value, 'XAF')}</b>
        </div>
      ))}
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { run } = useRun()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard.summary() })
  const forecast = useQuery({ queryKey: ['forecast'], queryFn: () => api.analytics.forecast(3) })
  if (!q.data) return <Spinner />
  const d = q.data
  const aging = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: d.aging[b.key] }))
  const monthly = d.monthly.map((m) => ({ month: formatMonthShort(m.month), Facturé: m.billed, Encaissé: m.collected }))
  const hasMonthly = d.monthly.some((m) => m.billed || m.collected)

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Montants consolidés en FCFA (EUR à 655,957 ; USD à ${d.usd_rate.toLocaleString('fr-FR')} – modifiable dans les paramètres).`}
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('balance_agee'), (p) => (p ? 'Balance âgée exportée.' : null))}>
            Exporter la balance âgée
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total dû" value={<Money minor={d.outstanding} currency="XAF" />} sub={`${d.open_count} facture(s)`} />
        <Stat label="En retard" value={<Money minor={d.overdue} currency="XAF" />} tone={d.overdue ? 'danger' : 'default'} sub={d.outstanding ? `${Math.round((d.overdue / d.outstanding) * 100)} % de l’encours` : undefined} onClick={() => navigate('/factures?retard=1')} />
        <Stat label="Taux de recouvrement" tip="taux_recouvrement" value={d.recovery_rate === null ? '—' : `${d.recovery_rate.toLocaleString('fr-FR')} %`} sub="factures des 12 derniers mois" tone="success" />
        <Stat label="DSO" tip="dso" value={d.dso === null ? '—' : `${d.dso} jours`} sub="délai moyen de paiement" />
        <Stat label="Encaissé ce mois" value={<Money minor={d.collected_this_month} currency="XAF" />} tone="success" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title={
            <>
              Balance âgée <HelpTip k="balance_agee" />
            </>
          }
        >
          {d.outstanding === 0 ? (
            <p className="py-16 text-center text-sm text-slate-500">Aucune somme due pour le moment.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={aging} margin={{ top: 16, right: 8, left: 8, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.ink }} axisLine={{ stroke: C.axis }} tickLine={false} />
                  <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,118,110,0.06)' }} />
                  <Bar dataKey="value" name="Montant dû" radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={(e) => {
                      const k = (e as { payload?: { key?: string } }).payload?.key
                      if (k) navigate(`/factures?anciennete=${k}`)
                    }} cursor="pointer">
                    {aging.map((a) => (
                      <Cell key={a.key} fill={C.s1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  <tr>
                    {aging.map((a) => (
                      <td key={a.key} className="px-1 text-center">
                        <button className="w-full rounded p-1 hover:bg-slate-50" onClick={() => navigate(`/factures?anciennete=${a.key}`)}>
                          <div className="text-slate-500">{a.label}</div>
                          <div className="tabular font-semibold text-slate-900">{formatMoney(a.value, 'XAF', false)}</div>
                          <div className="text-slate-400">{d.outstanding ? Math.round((a.value / d.outstanding) * 100) : 0} %</div>
                        </button>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card title="Facturé et encaissé par mois (12 mois)">
          {!hasMonthly ? (
            <p className="py-16 text-center text-sm text-slate-500">Pas encore de données.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthly} margin={{ top: 16, right: 8, left: 8, bottom: 0 }} barGap={2} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke={C.grid} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.ink }} axisLine={{ stroke: C.axis }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,118,110,0.06)' }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: C.ink }} />
                <Bar dataKey="Facturé" fill={C.s1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Encaissé" fill={C.s2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {forecast.data && (
        <div className="mb-5">
          <Card
            title={
              <>
                Prévisions d’encaissement <HelpTip k="prevision" />
              </>
            }
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/previsions')}>
                Détail
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              {forecast.data.buckets.map((b) => (
                <div key={b.key}>
                  <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{b.label}</div>
                  <FitText className="mt-1 text-lg font-semibold text-slate-900">
                    <Money minor={b.expected} currency="XAF" />
                  </FitText>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-[#2a78d6]" style={{ width: `${b.potential ? Math.round((b.expected / b.potential) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">probable sur {formatMoney(b.potential, 'XAF')} dus</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Principaux débiteurs" padded={false}>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Entreprise</th>
                {AGING_BUCKETS.map((b) => (
                  <th key={b.key} className={`px-2 text-right whitespace-nowrap ${['non_echu', 'j0_30', 'j31_60'].includes(b.key) ? 'hidden 2xl:table-cell' : ''}`}>
                    {b.label}
                  </th>
                ))}
                <th className="px-4 text-right">Total dû</th>
              </tr>
            </thead>
            <tbody>
              {d.top_debtors.map((r) => (
                <tr key={r.companyId} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/entreprises/${r.companyId}`)}>
                  <td className="w-full max-w-0 truncate px-4 py-2 font-medium" title={r.companyName}>
                    {r.companyName}
                  </td>
                  {AGING_BUCKETS.map((b) => (
                    <td key={b.key} className={`tabular px-2 text-right whitespace-nowrap ${['non_echu', 'j0_30', 'j31_60'].includes(b.key) ? 'hidden 2xl:table-cell ' : ''}${b.key === 'j90_plus' && r.buckets[b.key as AgingBucket] > 0 ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
                      {r.buckets[b.key as AgingBucket] ? formatMoney(r.buckets[b.key as AgingBucket], 'XAF', false) : '—'}
                    </td>
                  ))}
                  <td className="px-4 text-right whitespace-nowrap">
                    <Money minor={r.total} currency="XAF" strong />
                  </td>
                </tr>
              ))}
              {d.top_debtors.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Aucun débiteur.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card title="Sommes dues par devise">
            <MoneyByCurrency items={d.by_currency.map((b) => ({ currency: b.currency, amount: b.balance }))} empty="Aucune" />
          </Card>
          <Card title="À surveiller">
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between">
                Factures rejetées <b>{d.rejected}</b>
              </li>
              <li className="flex justify-between">
                Brouillons non déposés <b>{d.drafts}</b>
              </li>
              <li className="flex justify-between">
                Dossiers en contentieux <b>{d.litigation}</b>
              </li>
              <li className="flex justify-between">
                Facturé (12 mois) <Money minor={d.billed_12m} currency="XAF" />
              </li>
              <li className="flex justify-between">
                Encaissé sur ces factures <Money minor={d.collected_12m} currency="XAF" />
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
