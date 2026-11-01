// Audit visuel : parcourt toutes les pages à plusieurs tailles d'écran, détecte les textes qui débordent
// de leur cadre et prend des captures. Usage : npm run build && node tests/e2e/visual-audit.mjs <dossier>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = process.argv[2] ?? join(tmpdir(), 'recouvrement-audit')
const sizes = (process.argv[3] ?? '1366x768,1100x700,1920x1080').split(',').map((s) => s.split('x').map(Number))
mkdirSync(shots, { recursive: true })
const data = mkdtempSync(join(tmpdir(), 'recouvrement-audit-'))
const env = { ...process.env, RECOUVREMENT_DATA_DIR: data, RECOUVREMENT_AUTOSAVE_DIR: join(data, 'docs') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const win = await app.firstWindow()

const PAGES = [
  ['aujourdhui', '/'],
  ['tableau-de-bord', '/tableau-de-bord'],
  ['previsions', '/previsions'],
  ['fiabilite', '/fiabilite'],
  ['rapports', '/rapports'],
  ['factures', '/factures'],
  ['bons', '/bons'],
  ['bordereaux', '/bordereaux'],
  ['rejets', '/rejets'],
  ['entreprises', '/entreprises'],
  ['entreprise', '/entreprises/1'],
  ['relances', '/relances'],
  ['echanges', '/echanges'],
  ['contentieux', '/contentieux'],
  ['paiements', '/paiements'],
  ['banque', '/banque'],
  ['import', '/import-export'],
  ['parametres', '/parametres']
]

/** Dans la page : éléments dont le texte déborde (coupé ou sortant de son cadre). */
const detect = () => {
  const out = []
  const vw = document.documentElement.clientWidth
  for (const el of document.querySelectorAll('main *, aside *, header *, [role=dialog] *')) {
    if (!(el instanceof HTMLElement) || !el.offsetParent) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const clipped = el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible'
    let card = el.parentElement
    while (card && !/rounded-(xl|lg)/.test(card.className)) card = card.parentElement
    const cr = card?.getBoundingClientRect()
    const outside = cr && (r.right > cr.right + 1 || r.left < cr.left - 1)
    const pageOverflow = r.right > vw + 1
    if (clipped || outside || pageOverflow)
      out.push(`${clipped ? 'coupé' : outside ? 'hors cadre' : 'hors écran'} : « ${el.textContent.trim().slice(0, 50)} » (${Math.round(r.width)}px)`)
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push(`défilement horizontal de la page (${document.documentElement.scrollWidth}px > ${vw}px)`)
  return [...new Set(out)].slice(0, 15)
}

try {
  await win.getByText('Bienvenue !').waitFor()
  await win.locator('input[type=password]').nth(0).fill('Hopital2026')
  await win.locator('input[type=password]').nth(1).fill('Hopital2026')
  await win.getByRole('button', { name: 'Créer mon mot de passe' }).click()
  await win.getByText('J’ai imprimé ou recopié').click()
  await win.getByRole('button', { name: 'Continuer' }).click()
  await win.getByRole('button', { name: 'Commencer' }).click()
  await win.locator('input').first().fill('Centre Hospitalier Général de Pointe-Noire')
  await win.getByRole('button', { name: 'Enregistrer' }).click()
  await win.getByText('Bloc de signature des documents').waitFor()
  await win.locator('input').first().fill('Grace Exemple')
  await win.getByRole('button', { name: 'Enregistrer' }).click()
  await win.getByRole('button', { name: 'Continuer' }).click()
  await win.getByText('Découvrir avec des données fictives').click()
  await win.getByText('Relances à envoyer aujourd’hui').waitFor({ timeout: 30000 })

  // Cas extrêmes : nom très long et montants de plusieurs milliards (via le pont de l'application)
  const bigId = await win.evaluate(async () => {
    const call = async (m, ...a) => {
      const r = await window.bridge.call(m, a)
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
    const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
    const { id } = await call('companies.create', { name: 'Société Nationale des Pétroles et Hydrocarbures du Congo – Exploration Offshore SA', type: 'petrolier', default_currency: 'XAF', payment_terms_days: 60 })
    const f1 = await call('invoices.create', { number: 'GROS-0001', company_id: id, patient_name: 'Patient X', beneficiary_type: 'salarie', issue_date: d(200), amount_minor: 9876543210, currency: 'XAF', workflow_status: 'envoyee' })
    await call('invoices.create', { number: 'GROS-0002', company_id: id, patient_name: 'Patient Y', beneficiary_type: 'salarie', issue_date: d(30), amount_minor: 1234567890, currency: 'USD', workflow_status: 'acceptee' })
    await call('payments.create', { company_id: id, received_at: d(10), method: 'virement', amount_minor: 1234567890, currency: 'XAF', allocations: [{ invoice_id: f1.id, amount_minor: 1234567890 }] })
    return id
  })
  PAGES.push(['entreprise-geante', `/entreprises/${bigId}`])

  let total = 0
  for (const [w, h] of sizes) {
    // « max » : plein écran ; sinon sortir du plein écran et imposer la taille. On vérifie la largeur réellement obtenue.
    if (!w) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    } else {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
      await win.waitForTimeout(600)
      await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
    }
    await win.waitForTimeout(600)
    const real = await win.evaluate(() => window.innerWidth)
    console.log(`\n=== Taille ${w ? `${w}x${h}` : 'plein écran'} : largeur réelle ${real}px${w && Math.abs(real - w) > 20 ? ' (ÉCRAN TROP PETIT : taille non atteinte)' : ''}`)
    for (const [name, path] of PAGES) {
      await win.evaluate((p) => (location.hash = '#' + p), path)
      await win.waitForTimeout(900)
      const problems = await win.evaluate(detect)
      total += problems.length
      if (problems.length) console.log(`\n[${w}x${h}] ${name}\n  - ${problems.join('\n  - ')}`)
      await win.screenshot({ path: join(shots, `${w}x${h}-${name}.png`) })
    }
  }
  console.log(`\n${total} problème(s) détecté(s). Captures : ${shots}`)
} finally {
  await app.close()
  rmSync(data, { recursive: true, force: true })
}
