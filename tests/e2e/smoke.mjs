// Test de bout en bout de l'application réelle (Electron + Playwright) :
// premier lancement, guide de démarrage, démo, navigation, relance, PDF, export, verrouillage.
// Usage : npm run build && node tests/e2e/smoke.mjs [dossier-captures]
import { _electron as electron } from 'playwright-core'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = process.argv[2] ?? join(tmpdir(), 'recouvrement-captures')
const data = mkdtempSync(join(tmpdir(), 'recouvrement-e2e-'))
const out = join(shots, 'documents') // PDF / Excel produits, conservés pour vérification visuelle
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const errors = []
let step = 0
const ok = (msg) => console.log(`✔ ${++step}. ${msg}`)

const env = { ...process.env, RECOUVREMENT_DATA_DIR: data, RECOUVREMENT_AUTOSAVE_DIR: out }
delete env.ELECTRON_RUN_AS_NODE
// E2E_EXE=dist\win-unpacked\Recouvrement.exe pour tester la version empaquetée
const exe = process.env.E2E_EXE
const app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: ['.'], env })
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
win.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
const shot = (name) => win.screenshot({ path: join(shots, `${name}.png`) })
const nav = async (label) => {
  await win.locator('aside').getByRole('link', { name: label, exact: true }).click()
  await win.waitForTimeout(600)
}

try {
  // 1. Création du mot de passe
  await win.getByText('Bienvenue !').waitFor()
  await shot('01-creation-mot-de-passe')
  await win.locator('input[type=password]').nth(0).fill('Hopital2026')
  await win.locator('input[type=password]').nth(1).fill('Hopital2026')
  await win.getByRole('button', { name: 'Créer mon mot de passe' }).click()
  await win.getByText('Votre clé de secours').waitFor()
  await shot('02-cle-de-secours')
  await win.getByText('J’ai imprimé ou recopié').click()
  await win.getByRole('button', { name: 'Continuer' }).click()
  ok('Mot de passe et clé de secours')

  // 2. Guide de démarrage
  await win.getByRole('button', { name: 'Commencer' }).click()
  await win.locator('input').first().fill('Hôpital Général de Pointe-Noire (test)')
  await shot('03-guide-hopital')
  await win.getByRole('button', { name: 'Enregistrer' }).click()
  await win.getByText('Bloc de signature des documents').waitFor()
  await win.locator('input').first().fill('Grace Exemple')
  await win.getByRole('button', { name: 'Enregistrer' }).click()
  await win.getByRole('button', { name: 'Sauvegarder maintenant' }).waitFor()
  await win.getByRole('button', { name: 'Continuer' }).click()
  await win.getByText('Découvrir avec des données fictives').click()
  await win.getByText('Relances à envoyer aujourd’hui').waitFor({ timeout: 30000 })
  await win.waitForTimeout(1500)
  await shot('04-aujourdhui')
  ok('Guide de démarrage + chargement de la démo')

  // V2 — Agenda du jour
  await win.getByText('Promesses non tenues').waitFor()
  await win.getByText('Bons qui expirent bientôt').waitFor()
  await win.getByText('Factures rejetées à redéposer').waitFor()
  await shot('04b-agenda')
  ok('Agenda : promesse non tenue, bons expirants, rejets à redéposer')

  // V2 — Bons de prise en charge
  await nav('Bons de prise en charge')
  await win.getByText('BPC-3001').waitFor()
  await shot('20-bons')
  await win.getByText('BPC-3001').click()
  await win.getByText('Bon n° BPC-3001').waitFor()
  await win.keyboard.press('Escape')
  ok('Bons de prise en charge')

  // V2 — Rejets : re-dépôt
  await nav('Rejets')
  await win.getByText('Motifs de rejet les plus fréquents').waitFor()
  await shot('21-rejets')
  await win.getByRole('button', { name: 'Redéposer' }).first().click()
  await win.getByRole('button', { name: 'Valider' }).click()
  await win.getByText('facture(s) mise(s) à jour').waitFor()
  ok('Rejet redéposé (le délai repart)')

  // V2 — Bordereau PDF
  await nav('Bordereaux de dépôt')
  await win.getByText('BRD-DEMO-001').waitFor()
  await win.getByRole('button', { name: 'PDF' }).first().click()
  await win.getByText('Bordereau PDF créé').waitFor({ timeout: 20000 })
  ok('Bordereau de dépôt PDF')

  // V2 — Échange avec promesse
  await nav('Échanges et promesses')
  await win.getByRole('button', { name: 'Non tenues à traiter' }).click()
  await win.waitForTimeout(400)
  await shot('22-promesses')
  await win.getByRole('button', { name: 'Noter un échange' }).click()
  await win.locator('[role=dialog] input').first().click()
  await win.getByText('Kouilou Énergie SA (démo)', { exact: true }).click()
  await win.locator('[role=dialog] textarea').fill('Appel : paiement confirmé pour la semaine prochaine.')
  await win.locator('[role=dialog] label:has(input[type=checkbox])').first().click() // 1re facture → montant prérempli
  await win.getByText('Le client a promis de payer').click()
  await win.locator('[role=dialog]').getByRole('button', { name: 'Enregistrer' }).click()
  await win.getByText('Échange et promesse enregistrés').waitFor()
  ok('Échange avec promesse de paiement')

  // V2 — Rapprochement bancaire
  await nav('Rapprochement bancaire')
  await win.getByText('Relevé démo.xlsx').waitFor()
  await shot('23-banque')
  await win.getByRole('button', { name: 'Rapprocher', exact: true }).first().click()
  await win.getByText('Correspondances proposées').waitFor()
  await win.waitForTimeout(600)
  await shot('24-rapprochement')
  const valider = win.locator('[role=dialog]').getByRole('button', { name: /^(Valider|Associer)$/ }).first()
  await valider.click()
  await win.getByText(/rapproché|associée/).first().waitFor()
  ok('Rapprochement bancaire validé en un clic')

  // V2 — Contentieux
  await nav('Contentieux')
  await win.getByText('CTX-DEMO-001').click()
  await win.getByText('Étapes et échéances').waitFor()
  await shot('25-contentieux')
  await win.keyboard.press('Escape')
  ok('Contentieux')

  // V3 — Pilotage
  await nav('Prévisions')
  await win.getByText('Détail par facture').waitFor()
  await win.waitForTimeout(600)
  await shot('30-previsions')
  await nav('Fiabilité des clients')
  await win.getByText('Moins fiables d’abord').waitFor()
  await shot('31-fiabilite')
  ok('Prévisions d’encaissement et fiabilité des clients')

  await nav('Rapports mensuels')
  await win.getByText('automatique', { exact: false }).first().waitFor({ timeout: 20000 }) // rapport du mois écoulé créé au démarrage
  await win.locator('textarea').fill('Mois de démonstration : priorité aux créances de plus de 90 jours.')
  await win.getByRole('button', { name: 'Générer le PDF' }).click()
  await win.getByText(/Rapport de .* créé/).waitFor({ timeout: 30000 })
  await shot('32-rapports')
  ok('Rapport mensuel : automatique (mois écoulé) + manuel avec commentaire')

  await nav('Paramètres')
  await win.getByRole('button', { name: 'Mises à jour' }).click()
  await win.getByText('Mettre à jour depuis un fichier').waitFor()
  await shot('33-mises-a-jour')
  ok('Écran des mises à jour')

  // 3. Pages principales
  await nav('Tableau de bord')
  await win.getByText('Balance âgée').first().waitFor()
  await win.waitForTimeout(800)
  await shot('05-tableau-de-bord')
  await nav('Factures')
  await win.getByText('DEMO-2026-').first().waitFor()
  await shot('06-factures')
  ok('Tableau de bord et liste des factures')

  // 4. Fiche facture
  await win.locator('tbody tr').first().click()
  await win.getByText('Historique').first().waitFor()
  await win.waitForTimeout(400)
  await shot('07-fiche-facture')
  await win.keyboard.press('Escape')
  ok('Fiche facture')

  // 5. Filtre « en retard » + export Excel
  await win.getByRole('button', { name: 'En retard uniquement' }).click()
  await win.waitForTimeout(500)
  await win.getByRole('button', { name: 'Exporter (Excel)' }).click()
  await win.waitForTimeout(1500)
  ok('Filtre en retard + export Excel')

  // 6. Entreprise + relevé de compte PDF
  await nav('Entreprises')
  await win.getByText('Atlantique Offshore Petroleum (démo)', { exact: true }).click()
  await win.getByRole('button', { name: 'Autres actions' }).click()
  await win.getByRole('button', { name: 'Relevé de compte (PDF)' }).click()
  await win.waitForTimeout(4000)
  await shot('08-fiche-entreprise')
  await win.getByRole('button', { name: 'Interlocuteurs' }).click()
  await win.waitForTimeout(300)
  await shot('09-interlocuteurs')
  ok('Fiche entreprise + relevé PDF')

  // 7. Relance : préparation d'une lettre PDF
  await nav('Relances')
  await win.getByRole('button', { name: 'Préparer' }).first().click()
  await win.getByText('Factures concernées').waitFor()
  await win.waitForTimeout(800)
  await shot('10-redaction-relance')
  await win.getByRole('button', { name: 'Courrier' }).click()
  await win.waitForTimeout(800)
  const legal = win.getByText('J’ai fait relire ce courrier')
  if (await legal.isVisible()) await legal.click()
  await win.getByRole('button', { name: 'Générer la lettre PDF' }).click()
  await win.getByText('Lettre PDF créée').waitFor({ timeout: 20000 })
  ok('Relance courrier PDF générée et enregistrée dans l’historique')

  // 8. Modèles, paiement, paramètres
  await win.getByRole('button', { name: 'Modèles de messages' }).click()
  await win.waitForTimeout(400)
  await shot('11-modeles')
  await win.getByRole('button', { name: 'Paiement reçu' }).first().click()
  await win.getByText('Factures réglées par ce paiement').waitFor()
  await shot('12-paiement')
  await win.keyboard.press('Escape')
  await nav('Paramètres')
  await win.waitForTimeout(400)
  await shot('13-parametres')
  ok('Modèles, formulaire de paiement, paramètres')

  // 9. Recherche globale
  await win.keyboard.press('Control+K')
  await win.keyboard.type('DEMO-2026-0010')
  await win.waitForTimeout(800)
  await shot('14-recherche')
  await win.keyboard.press('Escape')
  ok('Recherche globale')

  // 10. Verrouillage puis déverrouillage
  await win.keyboard.press('Control+L')
  await win.getByText('Application verrouillée').waitFor()
  await win.locator('input[type=password]').fill('mauvais1')
  await win.getByRole('button', { name: 'Déverrouiller' }).click()
  await win.getByText('Mot de passe incorrect').waitFor()
  await win.locator('input[type=password]').fill('Hopital2026')
  await win.getByRole('button', { name: 'Déverrouiller' }).click()
  await win.getByRole('heading', { name: 'Paramètres' }).waitFor() // retour sur la page en cours
  ok('Verrouillage, refus du mauvais mot de passe, déverrouillage')

  // Rapports mensuels : copiés à côté des captures pour vérification visuelle
  const repDir = join(data, 'rapports')
  const reportsMade = existsSync(repDir) ? readdirSync(repDir) : []
  for (const r of reportsMade) copyFileSync(join(repDir, r), join(out, r))
  // Automatique puis manuel portent sur le même mois écoulé : un seul fichier, remplacé
  if (reportsMade.length < 1) errors.push('Aucun rapport mensuel produit')
  const files = existsSync(out) ? readdirSync(out) : []
  console.log('\nDocuments produits :', files.join(' | '))
  const backups = existsSync(join(data, 'sauvegardes')) ? readdirSync(join(data, 'sauvegardes')) : []
  console.log('Sauvegardes :', backups.join(' | '))
  if (!files.some((f) => f.endsWith('.pdf'))) errors.push('Aucun PDF produit')
  if (!files.some((f) => f.endsWith('.xlsx'))) errors.push('Aucun Excel produit')
  if (!backups.length) errors.push('Aucune sauvegarde')
} catch (e) {
  errors.push('ÉCHEC : ' + e.message)
  await shot('99-echec').catch(() => {})
} finally {
  await app.close()
  rmSync(data, { recursive: true, force: true })
}

if (errors.length) {
  console.error('\nProblèmes détectés :\n- ' + errors.join('\n- '))
  process.exit(1)
}
console.log(`\nTous les contrôles sont passés. Captures : ${shots}`)
