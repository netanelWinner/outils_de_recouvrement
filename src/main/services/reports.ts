// Rapport mensuel pour la direction : indicateurs du mois, comparaison avec le mois précédent,
// faits marquants rédigés automatiquement, PDF signé. Généré automatiquement en début de mois.
import { BrowserWindow, dialog, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../db/connection'
import { audit } from '../db/util'
import { usdRate } from '../db/sql'
import { AppError } from '../errors'
import { ensureDir, paths } from '../paths'
import { AGING_BUCKETS, CHANNELS, REJECTION_REASONS, type Channel, type Currency, type RejectionReason } from '@shared/constants'
import { addDays, addMonths, formatDateLong, todayISO } from '@shared/dates'
import { formatMoney, toXaf } from '@shared/money'
import { computeAging, type AgingTotals } from '@shared/domain/aging'
import { computeDso } from '@shared/domain/kpi'
import { GRADE_INFO, type Grade } from '@shared/domain/scoring'
import { getSettings, setSetting } from './settings'
import { analytics } from './analytics'
import { messaging } from './messaging'
import { page, renderPdf, signatureBlock } from './pdf'

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fcfa = (v: number) => formatMoney(v, 'XAF')
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function monthBounds(month: string): { start: string; end: string } {
  const start = `${month}-01`
  return { start, end: addDays(addMonths(start, 1), -1) }
}
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
export const previousMonth = (month: string) => addMonths(`${month}-01`, -1).slice(0, 7)
const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

/** Soldes de chaque facture à une date donnée (paiements et avoirs postérieurs exclus), en FCFA. */
function balancesAsOf(date: string) {
  const rate = usdRate()
  const rows = db()
    .prepare(`SELECT i.company_id, c.name AS company_name, i.due_date, i.currency,
        i.amount_minor
        - COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
            WHERE pa.invoice_id = i.id AND p.deleted_at IS NULL AND p.received_at <= @d), 0)
        - COALESCE((SELECT SUM(a.amount_minor) FROM invoices a WHERE a.corrects_invoice_id = i.id AND a.kind = 'avoir'
            AND a.deleted_at IS NULL AND a.issue_date <= @d), 0) AS bal
      FROM invoices i JOIN companies c ON c.id = i.company_id
      WHERE i.deleted_at IS NULL AND i.kind = 'facture' AND i.workflow_status NOT IN ('brouillon','annulee')
        AND COALESCE(i.deposit_date, i.issue_date) <= @d`)
    .all({ d: date }) as { company_id: number; company_name: string; due_date: string; currency: Currency; bal: number }[]
  return rows.filter((r) => r.bal > 0).map((r) => ({ companyId: r.company_id, companyName: r.company_name, dueDate: r.due_date, balanceXaf: toXaf(r.bal, r.currency, rate) }))
}

function sumXaf(rows: { currency: Currency; total: number | null }[]): number {
  const rate = usdRate()
  return rows.reduce((s, r) => s + toXaf(r.total ?? 0, r.currency, rate), 0)
}

function billedBetween(from: string, to: string): { count: number; xaf: number } {
  const rows = db()
    .prepare(`SELECT currency, count(*) AS n, SUM(amount_minor) AS total FROM invoices WHERE deleted_at IS NULL AND kind = 'facture'
      AND workflow_status NOT IN ('brouillon','annulee') AND issue_date BETWEEN ? AND ? GROUP BY currency`)
    .all(from, to) as { currency: Currency; n: number; total: number }[]
  return { count: rows.reduce((s, r) => s + r.n, 0), xaf: sumXaf(rows) }
}

function collectedBetween(from: string, to: string): { count: number; xaf: number } {
  const rows = db()
    .prepare(`SELECT currency, count(*) AS n, SUM(amount_minor) AS total FROM payments WHERE deleted_at IS NULL AND received_at BETWEEN ? AND ? GROUP BY currency`)
    .all(from, to) as { currency: Currency; n: number; total: number }[]
  return { count: rows.reduce((s, r) => s + r.n, 0), xaf: sumXaf(rows) }
}

function coreKpis(month: string) {
  const { start, end } = monthBounds(month)
  const atEnd = balancesAsOf(end)
  const aging = computeAging(atEnd, end)
  const billed = billedBetween(start, end)
  const collected = collectedBetween(start, end)
  const billed90 = billedBetween(addDays(end, -89), end).xaf
  const billed12 = billedBetween(addDays(addMonths(end, -12), 1), end).xaf
  const collected12 = collectedBetween(addDays(addMonths(end, -12), 1), end).xaf
  return {
    billed,
    collected,
    outstanding_end: aging.total,
    overdue_end: aging.total - aging.totals.non_echu,
    over90_end: aging.totals.j90_plus,
    aging_end: aging.totals,
    top_debtors: aging.rows.slice(0, 8).map((r) => ({ name: r.companyName, total: r.total, over90: r.buckets.j90_plus })),
    dso_end: computeDso(aging.total, billed90, 90),
    collection_ratio_12m: billed12 > 0 ? Math.round((collected12 / billed12) * 1000) / 10 : null
  }
}

/** Calcule toutes les données du rapport d'un mois « AAAA-MM ». */
function computeReport(month: string, comment: string | null = null) {
  if (!isMonth(month)) throw new AppError('Mois invalide.')
  const { start, end } = monthBounds(month)
  const k = coreKpis(month)
  const prev = coreKpis(previousMonth(month))
  const outstanding_start = prev.outstanding_end

  // Évolution sur 6 mois
  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(`${month}-01`, i - 5).slice(0, 7)
    const b = monthBounds(m)
    return { month: m, label: MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 4) + '.', billed: billedBetween(b.start, b.end).xaf, collected: collectedBetween(b.start, b.end).xaf }
  })

  const rejections = db()
    .prepare(`SELECT r.reason_code, count(*) AS n FROM rejections r JOIN invoices i ON i.id = r.invoice_id WHERE i.deleted_at IS NULL
      AND r.rejected_at BETWEEN ? AND ? GROUP BY r.reason_code ORDER BY n DESC`)
    .all(start, end) as { reason_code: RejectionReason; n: number }[]
  const redeposited = (db().prepare('SELECT count(*) AS n FROM rejections WHERE redeposited_at BETWEEN ? AND ?').get(start, end) as { n: number }).n
  const remindersByChannel = db()
    .prepare(`SELECT channel, count(*) AS n FROM reminders WHERE substr(sent_at, 1, 10) BETWEEN ? AND ? GROUP BY channel`)
    .all(start, end) as { channel: Channel; n: number }[]
  const activitiesCount = (db().prepare('SELECT count(*) AS n FROM activities WHERE deleted_at IS NULL AND occurred_at BETWEEN ? AND ?').get(start, end) as { n: number }).n
  const promises = db()
    .prepare(`SELECT SUM(CASE WHEN p.status = 'tenue' THEN 1 ELSE 0 END) AS kept, SUM(CASE WHEN p.status IN ('non_tenue','partielle') THEN 1 ELSE 0 END) AS broken,
        count(*) AS due FROM promises p JOIN activities a ON a.id = p.activity_id WHERE a.deleted_at IS NULL AND p.promised_date BETWEEN ? AND ?`)
    .get(start, end) as { kept: number | null; broken: number | null; due: number }
  const litigationOpen = (db()
    .prepare(`SELECT count(*) AS n FROM litigation_cases WHERE deleted_at IS NULL AND opened_at <= ? AND (closed_at IS NULL OR closed_at > ?)`)
    .get(end, end) as { n: number }).n
  const litigationNew = (db().prepare('SELECT count(*) AS n FROM litigation_cases WHERE deleted_at IS NULL AND opened_at BETWEEN ? AND ?').get(start, end) as { n: number }).n
  const reliability = analytics
    .reliability()
    .filter((r) => r.grade && r.outstanding_xaf > 0)
    .sort((a, b) => b.outstanding_xaf - a.outstanding_xaf)
    .slice(0, 8)
    .map((r) => ({ name: r.company_name, grade: r.grade as Grade, score: r.score as number, lateness: r.avgLatenessDays, outstanding: r.outstanding_xaf }))
  // Prévisions : seulement pertinentes pour le mois écoulé ou en cours
  const includeForecast = end >= addDays(todayISO(), -40)
  // Les périodes sans aucun montant dû (mois en cours presque terminé) sont omises
  const forecast = includeForecast ? analytics.forecast(3).buckets.filter((b) => b.potential > 0) : null

  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null)
  const highlights: string[] = []
  const dColl = pct(k.collected.xaf, prev.collected.xaf)
  highlights.push(
    `Encaissements du mois : ${fcfa(k.collected.xaf)} (${k.collected.count} paiement(s))${dColl !== null ? `, ${dColl >= 0 ? 'en hausse' : 'en baisse'} de ${Math.abs(dColl)} % par rapport au mois précédent` : ''}.`
  )
  const dOut = k.outstanding_end - outstanding_start
  highlights.push(`Encours clients en fin de mois : ${fcfa(k.outstanding_end)} (${dOut <= 0 ? 'baisse' : 'hausse'} de ${fcfa(Math.abs(dOut))} sur le mois).`)
  if (k.outstanding_end > 0 && k.over90_end > 0)
    highlights.push(`Créances de plus de 90 jours : ${fcfa(k.over90_end)}, soit ${Math.round((k.over90_end / k.outstanding_end) * 100)} % de l’encours – priorité des relances.`)
  if (k.top_debtors[0]) highlights.push(`Premier débiteur : ${k.top_debtors[0].name} (${fcfa(k.top_debtors[0].total)}).`)
  const rejTotal = rejections.reduce((s, r) => s + r.n, 0)
  if (rejTotal) highlights.push(`${rejTotal} facture(s) rejetée(s) ce mois ; motif principal : ${lcFirst(REJECTION_REASONS[rejections[0].reason_code])}. ${redeposited} re-dépôt(s) effectué(s).`)
  const remTotal = remindersByChannel.reduce((s, r) => s + r.n, 0)
  if (remTotal || activitiesCount) highlights.push(`${remTotal} relance(s) envoyée(s) et ${activitiesCount} échange(s) noté(s) avec les clients.`)
  if (promises.due) highlights.push(`Promesses de paiement arrivées à échéance : ${promises.kept ?? 0} tenue(s), ${promises.broken ?? 0} non tenue(s).`)
  if (litigationOpen) highlights.push(`${litigationOpen} dossier(s) en contentieux${litigationNew ? `, dont ${litigationNew} ouvert(s) ce mois` : ''}.`)

  const s = getSettings()
  return {
    month,
    label: monthLabel(month),
    start,
    end,
    hospital: s.hospital.name,
    usd_rate: s.currency.usd_rate,
    kpis: { ...k, outstanding_start },
    previous: { collected: prev.collected.xaf, billed: prev.billed.xaf, outstanding_end: prev.outstanding_end, dso_end: prev.dso_end, overdue_end: prev.overdue_end },
    trend,
    rejections,
    redeposited,
    reminders_by_channel: remindersByChannel,
    activities_count: activitiesCount,
    promises: { kept: promises.kept ?? 0, broken: promises.broken ?? 0, due: promises.due },
    litigation: { open: litigationOpen, new: litigationNew },
    reliability,
    forecast,
    highlights,
    comment
  }
}

export type ReportData = ReturnType<typeof computeReport>

export const reports = {
  compute: computeReport,

  html(d: ReportData): string {
    const s = getSettings()
    const delta = (cur: number, prev: number, goodWhenUp: boolean) => {
      if (!prev) return ''
      const p = Math.round(((cur - prev) / prev) * 100)
      if (p === 0) return '<span class="small">= mois préc.</span>'
      const good = goodWhenUp ? p > 0 : p < 0
      return `<span class="small" style="color:${good ? '#006300' : '#b91c1c'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)} % vs mois préc.</span>`
    }
    const kpi = (label: string, value: string, sub = '') => `<div class="box"><div class="small">${label}</div><div class="v">${value}</div>${sub}</div>`

    // Graphique : facturé (bleu) / encaissé (orange) sur 6 mois — palette validée, un seul axe
    const W = 640, H = 170, P = 28
    const max = Math.max(1, ...d.trend.flatMap((t) => [t.billed, t.collected]))
    const slot = (W - P) / d.trend.length
    const bw = Math.min(26, slot / 3)
    const y = (v: number) => H - 22 - (v / max) * (H - 40)
    const bars = d.trend
      .map((t, i) => {
        const x0 = P + i * slot + slot / 2 - bw - 1
        const h1 = H - 22 - y(t.billed)
        const h2 = H - 22 - y(t.collected)
        return `<rect x="${x0}" y="${y(t.billed)}" width="${bw}" height="${Math.max(0, h1)}" rx="3" fill="#2a78d6"/>
          <rect x="${x0 + bw + 2}" y="${y(t.collected)}" width="${bw}" height="${Math.max(0, h2)}" rx="3" fill="#eb6834"/>
          <text x="${P + i * slot + slot / 2}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#52514e">${esc(t.label)}</text>`
      })
      .join('')
    const grid = [0, 0.5, 1]
      .map((g) => `<line x1="${P}" x2="${W}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="#e1e0d9"/><text x="0" y="${y(max * g) + 3}" font-size="8" fill="#898781">${Math.round((max * g) / 1e6)} M</text>`)
      .join('')
    const chart = `<svg width="100%" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${grid}${bars}</svg>
      <div class="small"><span style="color:#2a78d6">■</span> Facturé &nbsp; <span style="color:#eb6834">■</span> Encaissé (FCFA)</div>`

    const agingRows = AGING_BUCKETS.map((b) => {
      const v = d.kpis.aging_end[b.key as keyof AgingTotals]
      const w = d.kpis.outstanding_end ? Math.round((v / d.kpis.outstanding_end) * 100) : 0
      return `<tr><td class="nw">${b.label}</td><td class="num">${fcfa(v)}</td><td style="width:45%"><div style="background:#2a78d6;height:9px;border-radius:0 4px 4px 0;width:${w}%"></div></td><td class="num">${w} %</td></tr>`
    }).join('')

    const body = `
      <h1>Rapport mensuel de recouvrement – ${esc(d.label)}</h1>
      <div class="small">Période du ${formatDateLong(d.start)} au ${formatDateLong(d.end)} · montants en FCFA (EUR à 655,957 ; USD à ${d.usd_rate})</div>
      <div class="kpis">
        ${kpi('Encaissé sur le mois', fcfa(d.kpis.collected.xaf), delta(d.kpis.collected.xaf, d.previous.collected, true))}
        ${kpi('Facturé sur le mois', fcfa(d.kpis.billed.xaf), `<span class="small">${d.kpis.billed.count} facture(s)</span>`)}
        ${kpi('Encours fin de mois', fcfa(d.kpis.outstanding_end), delta(d.kpis.outstanding_end, d.previous.outstanding_end, false))}
      </div>
      <div class="kpis">
        ${kpi('Dont en retard', fcfa(d.kpis.overdue_end), delta(d.kpis.overdue_end, d.previous.overdue_end, false))}
        ${kpi('Délai moyen de paiement (DSO)', d.kpis.dso_end === null ? '—' : `${d.kpis.dso_end} jours`, d.previous.dso_end !== null && d.kpis.dso_end !== null ? `<span class="small">mois préc. : ${d.previous.dso_end} j</span>` : '')}
        ${kpi('Encaissé / facturé (12 mois)', d.kpis.collection_ratio_12m === null ? '—' : `${d.kpis.collection_ratio_12m.toLocaleString('fr-FR')} %`)}
      </div>
      <h2>Faits marquants</h2>
      <ul>${d.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
      ${d.comment ? `<h2>Commentaire</h2><p>${esc(d.comment).replace(/\n/g, '<br>')}</p>` : ''}
      <h2>Facturé et encaissé – 6 derniers mois</h2>${chart}
      <div style="display:flex; gap:20px">
        <div style="flex:1"><h2>Balance âgée au ${formatDateLong(d.end)}</h2><table><tbody>${agingRows}
          <tr class="total"><td>Total</td><td class="num">${fcfa(d.kpis.outstanding_end)}</td><td></td><td></td></tr></tbody></table></div>
        <div style="flex:1"><h2>Principaux débiteurs</h2><table><thead><tr><th>Entreprise</th><th class="num">Encours</th><th class="num">+ 90 j</th></tr></thead><tbody>
          ${d.kpis.top_debtors.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${fcfa(t.total)}</td><td class="num">${t.over90 ? fcfa(t.over90) : '—'}</td></tr>`).join('') || '<tr><td colspan="3">Aucun</td></tr>'}
        </tbody></table></div>
      </div>
      ${
        d.reliability.length
          ? `<h2>Fiabilité des principaux clients</h2><table><thead><tr><th>Entreprise</th><th>Note</th><th class="num">Score</th><th class="num">Retard moyen</th><th class="num">Encours</th></tr></thead><tbody>
        ${d.reliability.map((r) => `<tr><td>${esc(r.name)}</td><td><b>${r.grade}</b> – ${GRADE_INFO[r.grade].label}</td><td class="num">${r.score}/100</td><td class="num">${r.lateness ?? '—'} j</td><td class="num">${fcfa(r.outstanding)}</td></tr>`).join('')}
        </tbody></table>`
          : ''
      }
      ${
        d.forecast
          ? `<h2>Prévisions d’encaissement</h2><table><thead><tr>${d.forecast.map((b) => `<th class="num">${esc(b.label)}</th>`).join('')}</tr></thead><tbody>
        <tr>${d.forecast.map((b) => `<td class="num"><b>${fcfa(b.expected)}</b><br><span class="small">sur ${fcfa(b.potential)} dus</span></td>`).join('')}</tr></tbody></table>
        <div class="small">Montant probable, pondéré par la fiabilité de chaque client, l’ancienneté des créances et les promesses de paiement.</div>`
          : ''
      }
      <h2>Activité du service</h2>
      <table><tbody>
        <tr><td>Relances envoyées</td><td class="num">${d.reminders_by_channel.map((r) => `${CHANNELS[r.channel]} : ${r.n}`).join(' · ') || '0'}</td></tr>
        <tr><td>Échanges notés (appels, visites, e-mails)</td><td class="num">${d.activities_count}</td></tr>
        <tr><td>Promesses arrivées à échéance</td><td class="num">${d.promises.due} (tenues : ${d.promises.kept}, non tenues : ${d.promises.broken})</td></tr>
        <tr><td>Factures rejetées / redéposées</td><td class="num">${d.rejections.reduce((s, r) => s + r.n, 0)} / ${d.redeposited}</td></tr>
        <tr><td>Dossiers en contentieux (dont nouveaux)</td><td class="num">${d.litigation.open} (${d.litigation.new})</td></tr>
      </tbody></table>
      ${signatureBlock(s)}`
    return page(s, body, { title: `Rapport mensuel ${d.label}` })
  },

  /** Génère le PDF du mois, l'enregistre dans le dossier des rapports et l'historise. */
  async generate(month: string, opts: { comment?: string | null; auto?: boolean; open?: boolean } = {}) {
    const d = reports.compute(month, opts.comment ?? null)
    const pdf = await renderPdf(reports.html(d))
    const dir = ensureDir(getSettings().reports.dir || paths.defaultReportsDir)
    const file = join(dir, `Rapport mensuel recouvrement ${month}.pdf`)
    try {
      writeFileSync(file, pdf)
    } catch (e) {
      if (/EBUSY|EPERM/.test(String(e))) throw new AppError('Le rapport précédent est ouvert dans un lecteur PDF : fermez-le puis réessayez.')
      throw e
    }
    db()
      .prepare(`INSERT INTO monthly_reports (month, file_path, auto, comment, kpis_json, generated_at) VALUES (?,?,?,?,?, datetime('now','localtime'))
        ON CONFLICT(month) DO UPDATE SET file_path = excluded.file_path, auto = excluded.auto, comment = excluded.comment,
        kpis_json = excluded.kpis_json, generated_at = excluded.generated_at`)
      .run(month, file, opts.auto ? 1 : 0, opts.comment ?? null, JSON.stringify(d))
    audit('document', 'rapport', null, `Rapport mensuel ${d.label} généré${opts.auto ? ' automatiquement' : ''}`)
    if (opts.open && !process.env.RECOUVREMENT_AUTOSAVE_DIR) await shell.openPath(file)
    return { path: file, label: d.label }
  },

  dir() {
    return getSettings().reports.dir || paths.defaultReportsDir
  },

  async chooseDir() {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Choisir le dossier des rapports mensuels', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    setSetting('reports', { ...getSettings().reports, dir: res.filePaths[0] })
    audit('modification', 'parametres', null, `Dossier des rapports : ${res.filePaths[0]}`)
    return res.filePaths[0]
  },

  list() {
    return (db().prepare('SELECT id, month, generated_at, file_path, auto, emailed_to, comment, kpis_json FROM monthly_reports ORDER BY month DESC').all() as {
      id: number
      month: string
      generated_at: string
      file_path: string | null
      auto: number
      emailed_to: string | null
      comment: string | null
      kpis_json: string
    }[]).map(({ kpis_json, ...r }) => {
      const d = JSON.parse(kpis_json) as ReportData
      return { ...r, label: d.label, collected: d.kpis.collected.xaf, outstanding_end: d.kpis.outstanding_end, dso_end: d.kpis.dso_end, file_exists: !!r.file_path && existsSync(r.file_path) }
    })
  },

  async open(month: string) {
    const r = db().prepare('SELECT file_path, comment FROM monthly_reports WHERE month = ?').get(month) as { file_path: string | null; comment: string | null } | undefined
    if (!r?.file_path || !existsSync(r.file_path)) return reports.generate(month, { comment: r?.comment ?? null, open: true })
    await shell.openPath(r.file_path)
    return { path: r.file_path, label: monthLabel(month) }
  },

  /** Envoie le rapport par e-mail aux destinataires configurés (direction). */
  async email(month: string) {
    const s = getSettings()
    if (!s.reports.email_to) throw new AppError('Indiquez l’adresse e-mail de la direction dans Paramètres → Rapports.')
    let r = db().prepare('SELECT file_path FROM monthly_reports WHERE month = ?').get(month) as { file_path: string | null } | undefined
    if (!r?.file_path || !existsSync(r.file_path)) {
      await reports.generate(month)
      r = db().prepare('SELECT file_path FROM monthly_reports WHERE month = ?').get(month) as { file_path: string }
    }
    const { readFileSync } = await import('node:fs')
    const label = monthLabel(month)
    await messaging.send({
      to: s.reports.email_to,
      subject: `Rapport mensuel de recouvrement – ${label} – ${s.hospital.name}`,
      text: `Bonjour,\n\nVeuillez trouver ci-joint le rapport mensuel de recouvrement pour ${label}.\n\nCordialement,\n\n${s.signatory.name}\n${s.signatory.title}\n${s.hospital.name}`,
      attachments: [{ filename: `Rapport mensuel recouvrement ${month}.pdf`, content: readFileSync(r!.file_path!) }]
    })
    db().prepare('UPDATE monthly_reports SET emailed_to = ? WHERE month = ?').run(s.reports.email_to, month)
    audit('document', 'rapport', null, `Rapport ${label} envoyé à ${s.reports.email_to}`)
    return true
  },

  /** Début de mois : génère (et envoie si configuré) le rapport du mois écoulé, une seule fois. */
  async autoIfDue(): Promise<{ generated?: string; emailed?: boolean; error?: string }> {
    const s = getSettings()
    if (!s.reports.auto) return {}
    const month = previousMonth(todayISO().slice(0, 7))
    if (db().prepare('SELECT id FROM monthly_reports WHERE month = ?').get(month)) return {}
    const hasData = db().prepare(`SELECT id FROM invoices WHERE deleted_at IS NULL AND issue_date <= ? LIMIT 1`).get(monthBounds(month).end)
    if (!hasData) return {}
    try {
      const { label } = await reports.generate(month, { auto: true })
      let emailed = false
      if (s.reports.email_to && s.smtp.host && s.smtp.from_email) {
        try {
          await reports.email(month)
          emailed = true
        } catch (e) {
          return { generated: label, emailed: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
      return { generated: label, emailed }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
}
