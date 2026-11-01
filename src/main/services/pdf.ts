// Génération des documents PDF : HTML/CSS rendu par Chromium (fenêtre invisible) puis printToPDF.
import { BrowserWindow, dialog, shell } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { paths, ensureDir, autoSavePath } from '../paths'
import { getAssetDataUrl, getSettings, type Settings } from './settings'
import { formatDate, formatDateLong, todayISO } from '@shared/dates'
import { formatMoney } from '@shared/money'
import { STATUS_INFO, type Currency, type InvoiceStatus } from '@shared/constants'

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const CSS = `
@page { size: A4; margin: 16mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; color: #1f2937; margin: 0; line-height: 1.45; }
.header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #0f766e; padding-bottom: 10px; margin-bottom: 18px; }
.header img { max-height: 70px; max-width: 150px; object-fit: contain; }
.header .h-name { font-size: 15pt; font-weight: 700; color: #0f766e; }
.header .h-info { font-size: 8.5pt; color: #4b5563; }
.addr { margin-left: auto; width: 45%; margin-bottom: 18px; }
.addr .to { font-weight: 600; }
.meta { margin: 0 0 14px; font-size: 9.5pt; color: #374151; }
.subject { font-weight: 700; margin: 10px 0 14px; }
.subject span { text-decoration: underline; }
p { margin: 0 0 9px; text-align: justify; }
ul { margin: 0 0 9px 0; padding-left: 18px; }
li { margin-bottom: 2px; }
h1 { font-size: 15pt; color: #0f766e; margin: 0 0 4px; }
h2 { font-size: 11pt; margin: 18px 0 6px; color: #0f766e; }
table { width: 100%; border-collapse: collapse; font-size: 8.2pt; margin: 6px 0 12px; }
th { background: #f0fdfa; color: #134e4a; text-align: left; font-weight: 600; border-bottom: 1.5px solid #0f766e; padding: 5px 4px; }
td { border-bottom: 1px solid #e5e7eb; padding: 4px 4px; vertical-align: top; }
.nw { white-space: nowrap; }
.num { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 1.5px solid #0f766e; border-bottom: none; }
.sign { margin-top: 26px; margin-left: auto; width: 55%; text-align: left; page-break-inside: avoid; }
.sign .imgs { position: relative; height: 85px; }
.sign .imgs img.sig { max-height: 80px; max-width: 220px; position: absolute; left: 0; top: 0; }
.sign .imgs img.stamp { max-height: 85px; max-width: 110px; position: absolute; left: 140px; top: 0; opacity: .85; }
.sign .name { font-weight: 700; }
.signwrap .sign { margin: 0; width: 100%; }
.footer { position: fixed; bottom: -12mm; left: 0; right: 0; text-align: center; font-size: 7.5pt; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 3px; }
.watermark { position: fixed; top: 40%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-size: 34pt; color: rgba(220, 38, 38, .13); font-weight: 800; z-index: -1; }
.box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; background: #f9fafb; }
.kpis { display: flex; gap: 10px; margin: 8px 0 14px; }
.kpis .box { flex: 1; }
.kpis .v { font-size: 12pt; font-weight: 700; color: #0f766e; }
.small { font-size: 8.5pt; color: #6b7280; }
`

function header(s: Settings): string {
  const logo = getAssetDataUrl('logo')
  const h = s.hospital
  const line2 = [h.address, h.city, h.country].filter(Boolean).map(esc).join(' – ')
  const line3 = [h.phone && `Tél. ${esc(h.phone)}`, h.email && esc(h.email), h.website && esc(h.website)].filter(Boolean).join(' · ')
  return `<div class="header">${logo ? `<img src="${logo}">` : ''}<div>
    <div class="h-name">${esc(h.name || 'Hôpital')}</div><div class="h-info">${line2}</div><div class="h-info">${line3}</div></div></div>`
}

function footer(s: Settings): string {
  const h = s.hospital
  const parts = [h.niu && `NIU : ${esc(h.niu)}`, h.rccm && `RCCM : ${esc(h.rccm)}`, h.bank_details && `Coordonnées bancaires : ${esc(h.bank_details)}`].filter(Boolean)
  return parts.length ? `<div class="footer">${parts.join(' · ')}</div>` : ''
}

/** Bloc de signature : lieu et date, nom, fonction, image de signature, cachet optionnel. */
export function signatureBlock(s: Settings, date = todayISO()): string {
  const sig = getAssetDataUrl('signature')
  const stamp = s.signatory.show_stamp ? getAssetDataUrl('cachet') : null
  return `<div class="sign">
    <div>Fait à ${esc(s.hospital.city || 'Pointe-Noire')}, le ${formatDateLong(date)}</div>
    <div class="imgs">${sig ? `<img class="sig" src="${sig}">` : ''}${stamp ? `<img class="stamp" src="${stamp}">` : ''}</div>
    <div class="name">${esc(s.signatory.name)}</div>
    <div>${esc(s.signatory.title)}</div>
  </div>`
}

/** Texte brut → HTML : paragraphes séparés par une ligne vide, lignes « - » en liste à puces. */
export function textToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`
      return `<p>${lines.map(esc).join('<br>')}</p>`
    })
    .join('')
}

export function page(s: Settings, body: string, opts: { title: string; watermark?: string | null }): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${CSS}</style></head>
  <body>${opts.watermark ? `<div class="watermark">${esc(opts.watermark)}</div>` : ''}${header(s)}${body}${footer(s)}</body></html>`
}

/** Rend un HTML en PDF (Buffer). */
export async function renderPdf(html: string): Promise<Buffer> {
  const dir = ensureDir(paths.tmp)
  const file = join(dir, `doc-${randomUUID()}.html`)
  writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } })
  try {
    await win.loadFile(file)
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}

/** Demande où enregistrer le PDF, l'écrit puis l'ouvre. Retourne le chemin ou null si annulé. */
export async function savePdf(buffer: Buffer, defaultName: string): Promise<string | null> {
  const safe = defaultName.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)
  const auto = autoSavePath(safe + '.pdf')
  if (auto) {
    writeFileSync(auto, buffer)
    return auto
  }
  const win = BrowserWindow.getFocusedWindow()
  const opts = { title: 'Enregistrer le document PDF', defaultPath: safe.endsWith('.pdf') ? safe : safe + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, buffer)
  await shell.openPath(res.filePath)
  return res.filePath
}

// ------------------------------------------------------------------ Documents

export interface LetterData {
  company: { name: string; address: string | null; city: string | null }
  contact: { full_name: string; job_title: string | null } | null
  subject: string
  body: string
  reference?: string
  watermark?: string | null
  registered?: boolean
}

export function letterHtml(d: LetterData): string {
  const s = getSettings()
  const to = [
    `<div class="to">${esc(d.company.name)}</div>`,
    d.contact ? `<div>À l’attention de ${esc(d.contact.full_name)}${d.contact.job_title ? `, ${esc(d.contact.job_title)}` : ''}</div>` : '',
    d.company.address ? `<div>${esc(d.company.address)}</div>` : '',
    d.company.city ? `<div>${esc(d.company.city)}</div>` : ''
  ].join('')
  const body = `<div class="addr">${to}</div>
    <div class="meta">${d.reference ? `Réf. : ${esc(d.reference)}<br>` : ''}${d.registered ? 'Lettre recommandée avec accusé de réception / remise contre décharge<br>' : ''}</div>
    <div class="subject">Objet : <span>${esc(d.subject)}</span></div>
    ${textToHtml(d.body)}
    ${signatureBlock(s)}`
  return page(s, body, { title: d.subject, watermark: d.watermark })
}

export interface StatementData {
  company: { name: string; address: string | null; city: string | null }
  invoices: {
    number: string
    issue_date: string
    due_date: string
    patient: string
    voucher: string | null
    amount_minor: number
    paid_minor: number
    balance_minor: number
    currency: Currency
    days_late: number
    status: InvoiceStatus
  }[]
  aging: { label: string; amount: string }[]
}

export function statementHtml(d: StatementData): string {
  const s = getSettings()
  const today = todayISO()
  const byCur = new Map<Currency, { amount: number; paid: number; balance: number }>()
  for (const i of d.invoices) {
    const t = byCur.get(i.currency) ?? { amount: 0, paid: 0, balance: 0 }
    t.amount += i.amount_minor
    t.paid += i.paid_minor
    t.balance += i.balance_minor
    byCur.set(i.currency, t)
  }
  const rows = d.invoices
    .map(
      (i) => `<tr><td class="nw">${esc(i.number)}</td><td class="nw">${formatDate(i.issue_date)}</td><td>${esc(i.patient)}</td><td class="nw">${esc(i.voucher ?? '')}</td>
      <td class="nw">${formatDate(i.due_date)}</td><td class="num">${formatMoney(i.amount_minor, i.currency)}</td><td class="num">${formatMoney(i.paid_minor, i.currency)}</td>
      <td class="num"><b>${formatMoney(i.balance_minor, i.currency)}</b></td><td class="num">${i.days_late > 0 ? i.days_late + ' j' : '—'}</td>
      <td>${STATUS_INFO[i.status].label}</td></tr>`
    )
    .join('')
  const totals = [...byCur.entries()]
    .map(
      ([c, t]) => `<tr class="total"><td colspan="5">Total ${c}</td><td class="num">${formatMoney(t.amount, c)}</td><td class="num">${formatMoney(t.paid, c)}</td>
      <td class="num">${formatMoney(t.balance, c)}</td><td colspan="2"></td></tr>`
    )
    .join('')
  const body = `<div class="addr"><div class="to">${esc(d.company.name)}</div>${d.company.address ? `<div>${esc(d.company.address)}</div>` : ''}${
    d.company.city ? `<div>${esc(d.company.city)}</div>` : ''
  }</div>
    <h1>Relevé de compte</h1>
    <div class="small">Situation au ${formatDateLong(today)} – factures restant dues</div>
    <div class="kpis">${d.aging.map((a) => `<div class="box"><div class="small">${esc(a.label)}</div><div class="v">${esc(a.amount)}</div></div>`).join('')}</div>
    <table><thead><tr><th>N° facture</th><th>Émise le</th><th>Patient / matricule</th><th>Bon</th><th>Échéance</th><th class="num">Montant</th>
      <th class="num">Réglé</th><th class="num">Reste dû</th><th class="num">Retard</th><th>Statut</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10">Aucune facture en attente de règlement.</td></tr>'}${totals}</tbody></table>
    <p>Nous vous remercions de bien vouloir vérifier ce relevé et de procéder au règlement des sommes échues. Pour toute divergence, merci de nous contacter en indiquant les numéros de facture concernés.</p>
    ${s.hospital.bank_details ? `<p><b>Coordonnées bancaires :</b> ${esc(s.hospital.bank_details)}</p>` : ''}
    ${signatureBlock(s)}`
  return page(s, body, { title: `Relevé de compte – ${d.company.name}` })
}
