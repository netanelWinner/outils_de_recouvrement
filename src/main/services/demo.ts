// Mode démonstration : données 100 % fictives pour s'entraîner, effaçables en un clic.
import { db } from '../db/connection'
import { audit, tx } from '../db/util'
import { AppError } from '../errors'
import { addDays, todayISO } from '@shared/dates'
import type { Currency, RejectionReason } from '@shared/constants'
import { getSettings, setSetting } from './settings'
import { companies } from './companies'
import { invoices } from './invoices'
import { payments } from './payments'
import { reminders } from './reminders'
import { vouchers } from './vouchers'
import { batches } from './batches'
import { activities } from './activities'
import { litigation } from './litigation'

/** Générateur pseudo-aléatoire déterministe (mêmes données à chaque chargement). */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PATIENTS = ['Mabiala J.', 'Nkounkou A.', 'Loemba P.', 'Mavoungou C.', 'Tchicaya R.', 'Massamba E.', 'Bouanga F.', 'Makosso L.', 'Ngouabi S.', 'Poaty G.', 'Mbemba D.', 'Taty M.', 'Samba K.', 'Kimbembe H.']

export const demo = {
  isLoaded(): boolean {
    return !!db().prepare('SELECT id FROM companies WHERE is_demo = 1 LIMIT 1').get()
  },

  load() {
    if (demo.isLoaded()) throw new AppError('Les données de démonstration sont déjà chargées.')
    const today = todayISO()
    const r = rng(42)
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]

    tx(() => {
      const mk = (name: string, type: 'petrolier' | 'sous_traitant', terms: number, cur: Currency, parent: number | null, city = 'Pointe-Noire') =>
        companies.create({
          name,
          type,
          parent_company_id: parent,
          address: 'Zone industrielle, BP 0000 (adresse fictive)',
          city,
          phone: '+242 06 000 00 00',
          email: null,
          default_currency: cur,
          payment_terms_days: terms,
          billing_notes: 'Données de démonstration – entreprise fictive.'
        }).id
      const A = mk('Atlantique Offshore Petroleum (démo)', 'petrolier', 60, 'XAF', null)
      const B = mk('Kouilou Énergie SA (démo)', 'petrolier', 90, 'XAF', null)
      const C = mk('Mayombe Oil & Gas (démo)', 'petrolier', 45, 'USD', null)
      const D = mk('Loango Services Pétroliers (démo)', 'sous_traitant', 60, 'XAF', A)

      const contact = (company_id: number, role: 'compta_fournisseurs' | 'rh' | 'hse_medecin' | 'gestionnaire_tiers', full_name: string, job: string, email: string, wa: string | null, third: string | null = null) =>
        companies.saveContact(null, { company_id, role, full_name, job_title: job, email, phone: wa, whatsapp: wa, third_party_name: third, is_primary: true })
      contact(A, 'compta_fournisseurs', 'Clarisse Mavoungou', 'Responsable comptabilité fournisseurs', 'compta.fournisseurs@aop-demo.example', '+242 06 600 00 01')
      contact(A, 'rh', 'Serge Moukoko', 'Gestionnaire RH', 'rh@aop-demo.example', '+242 06 600 00 02')
      contact(A, 'hse_medecin', 'Dr Paul Ngoma', 'Médecin du travail', 'medecin@aop-demo.example', null)
      contact(A, 'gestionnaire_tiers', 'Inès Bakala', 'Chargée de dossiers', 'dossiers@assist-sante-demo.example', '+242 05 500 00 03', 'Assist Santé Gestion (démo)')
      contact(B, 'compta_fournisseurs', 'Hervé Loubaki', 'Comptable fournisseurs', 'ap@kouilou-demo.example', '+242 06 610 00 01')
      contact(B, 'hse_medecin', 'Dr Aline Mampouya', 'Responsable HSE', 'hse@kouilou-demo.example', '+242 06 610 00 02')
      contact(C, 'compta_fournisseurs', 'John Miller', 'Accounts Payable Lead', 'accounts.payable@mayombe-demo.example', '+242 06 620 00 01')
      contact(C, 'rh', 'Nadège Itoua', 'HR Officer', 'hr@mayombe-demo.example', null)
      contact(D, 'compta_fournisseurs', 'Gildas Pambou', 'Comptable', 'compta@loango-demo.example', '+242 06 630 00 01')

      const conv = (company_id: number, reference: string, terms: number, start: 'emission' | 'depot', cur: Currency, penalty: 'aucune' | 'taux_annuel' | 'taux_mensuel', rate: number, grace: number) =>
        companies.saveConvention(null, {
          company_id,
          reference,
          title: 'Convention de prise en charge médicale (fictive)',
          start_date: addDays(today, -400),
          end_date: addDays(today, 330),
          payment_terms_days: terms,
          terms_start: start,
          required_documents: ['Bon de prise en charge', 'Bon de commande (PO)', 'Facture originale signée'],
          billing_format_notes: 'Dépôt au service courrier avec bordereau, ou envoi par e-mail en PDF.',
          penalty_type: penalty,
          penalty_rate: rate,
          penalty_fixed_minor: 0,
          penalty_grace_days: grace,
          currency: cur,
          status: 'active'
        }).id
      const convA = conv(A, 'CONV-AOP-2025', 60, 'depot', 'XAF', 'taux_annuel', 10, 15)
      const convB = conv(B, 'CONV-KE-01', 90, 'depot', 'XAF', 'taux_mensuel', 1, 30)
      const convC = conv(C, 'MSA-MOG-2025', 45, 'emission', 'USD', 'aucune', 0, 0)
      const convD = conv(D, 'CONV-LSP-2026', 60, 'depot', 'XAF', 'aucune', 0, 0)

      const plan = [A, A, B, A, C, B, A, D, B, C, A, B, A, D, C, A, B, A, C, B, A, A, B, D, C, A, B, A, C, B, A, D, A, B, C, A, B, A, B, A]
      const convOf: Record<number, number> = { [A]: convA, [B]: convB, [C]: convC, [D]: convD }
      const rejected: Record<number, RejectionReason> = { 7: 'po_manquant', 18: 'bon_manquant', 29: 'mauvais_format' }
      const created: { id: number; company: number; amount: number; cur: Currency; issue: string; due: string }[] = []

      plan.forEach((company, i) => {
        const cur: Currency = company === C ? 'USD' : 'XAF'
        const amount = cur === 'USD' ? Math.round(300 + r() * 8700) * 100 : Math.round((85_000 + r() * 4_400_000) / 500) * 500
        const daysAgo = i < 3 ? 2 + i * 3 : 12 + Math.round((i / plan.length) * 200 + r() * 15)
        const issue = addDays(today, -daysAgo)
        const draft = i < 3
        const { id } = invoices.create({
          number: `DEMO-2026-${String(i + 1).padStart(4, '0')}`,
          company_id: company,
          convention_id: convOf[company],
          voucher_number: `BPC-${2400 + i}`,
          po_number: i % 6 === 5 ? null : `PO-${7700 + i}`,
          patient_name: pick(PATIENTS),
          patient_matricule: `MAT-${1000 + i}`,
          beneficiary_type: company === D ? 'sous_traitant' : i % 7 === 3 ? 'ayant_droit' : 'salarie',
          subcontractor_name: company === D ? 'Loango Services Pétroliers' : null,
          service_date: addDays(issue, -5),
          issue_date: issue,
          deposit_date: draft ? null : addDays(issue, 3),
          due_date: null,
          due_date_manual: false,
          amount_minor: amount,
          currency: cur,
          notes: null,
          workflow_status: draft ? 'brouillon' : i % 3 === 0 ? 'acceptee' : 'envoyee'
        })
        const inv = db().prepare('SELECT due_date FROM invoices WHERE id = ?').get(id) as { due_date: string }
        created.push({ id, company, amount, cur, issue, due: inv.due_date })
        if (rejected[i]) {
          invoices.applyAction({ ids: [id], action: 'rejeter', date: addDays(issue, 20), reason_code: rejected[i], reason_text: 'Exemple de rejet (démo)' })
        }
      })

      // Paiements : les factures anciennes sont en majorité réglées, certaines partiellement
      const old = created.filter((c, i) => !rejected[i] && c.due < addDays(today, -5))
      old.forEach((c, k) => {
        const roll = r()
        if (roll < 0.55) {
          const paidOn = addDays(c.due, Math.round(-10 + r() * 40))
          payments.create({
            company_id: c.company === D ? A : c.company,
            received_at: paidOn > today ? today : paidOn,
            method: k % 5 === 0 ? 'cheque' : 'virement',
            reference: `VIR-${88000 + k}`,
            bank_name: 'Banque fictive',
            amount_minor: c.amount,
            currency: c.cur,
            notes: 'Paiement de démonstration',
            allocations: [{ invoice_id: c.id, amount_minor: c.amount }]
          })
        } else if (roll < 0.7) {
          const part = c.cur === 'USD' ? Math.round(c.amount / 200) * 100 : Math.round(c.amount / 2 / 500) * 500
          payments.create({
            company_id: c.company,
            received_at: addDays(c.due, 5) > today ? today : addDays(c.due, 5),
            method: 'virement',
            reference: `VIR-${89000 + k}`,
            bank_name: 'Banque fictive',
            amount_minor: part,
            currency: c.cur,
            notes: 'Acompte (démo)',
            allocations: [{ invoice_id: c.id, amount_minor: part }]
          })
        }
      })

      // Un paiement groupé sur plusieurs factures de la même entreprise
      const groupB = created.filter((c) => c.company === B).slice(-6, -3)
      const bal = (id: number) => (db().prepare('SELECT amount_minor - paid_minor - credited_minor AS b, status FROM invoices WHERE id = ?').get(id) as { b: number; status: string })
      const openB = groupB.filter((c) => bal(c.id).b > 0 && bal(c.id).status !== 'rejetee' && bal(c.id).status !== 'brouillon')
      if (openB.length >= 2) {
        const allocs = openB.map((c) => ({ invoice_id: c.id, amount_minor: bal(c.id).b }))
        payments.create({
          company_id: B,
          received_at: addDays(today, -4),
          method: 'virement',
          reference: 'VIR-GROUPE-001',
          bank_name: 'Banque fictive',
          amount_minor: allocs.reduce((s, a) => s + a.amount_minor, 0),
          currency: 'XAF',
          notes: 'Virement groupé couvrant plusieurs factures (démo)',
          allocations: allocs
        })
      }

      // Un avoir et un dossier en contentieux
      const forCredit = created.find((c) => c.company === A && bal(c.id).b > 100_000 && bal(c.id).status !== 'brouillon')
      if (forCredit)
        invoices.createCreditNote({ invoice_id: forCredit.id, number: 'DEMO-AV-0001', issue_date: addDays(today, -20), amount_minor: 50_000, notes: 'Remise sur prestation facturée en double (démo)' })
      const oldestB = created.filter((c) => c.company === B && bal(c.id).b > 0 && ['envoyee', 'acceptee'].includes(bal(c.id).status)).sort((a, b) => a.due.localeCompare(b.due))[0]
      if (oldestB) {
        const lit = litigation.create({
          company_id: B,
          reference: 'CTX-DEMO-001',
          opened_at: addDays(today, -10),
          handler_type: 'avocat',
          handler_name: 'Cabinet Maître Exemple (fictif)',
          handler_contact: '+242 06 999 00 00',
          procedure: 'injonction_de_payer',
          notes: 'Dossier de démonstration.',
          invoice_ids: [oldestB.id]
        }).id
        litigation.addStep(lit, { title: 'Dépôt de la requête en injonction de payer au tribunal', due_date: addDays(today, 3) })
        litigation.addCost(lit, { date: addDays(today, -8), label: 'Provision sur honoraires', amount_minor: 150_000, currency: 'XAF' })
      }

      // ---- V2 : bons, rejets détaillés, bordereau, échanges et promesses, relevé bancaire
      const vA = db().prepare(`SELECT id FROM coverage_vouchers WHERE company_id = ? ORDER BY id DESC LIMIT 2`).all(A) as { id: number }[]
      if (vA[0]) db().prepare('UPDATE coverage_vouchers SET valid_until = ?, ceiling_minor = 5000000 WHERE id = ?').run(addDays(today, 9), vA[0].id)
      if (vA[1]) db().prepare('UPDATE coverage_vouchers SET valid_until = ? WHERE id = ?').run(addDays(today, -3), vA[1].id)
      vouchers.save(null, {
        company_id: A,
        convention_id: convA,
        number: 'BPC-3001',
        patient_matricule: 'MAT-2001',
        patient_name: 'Moukala T.',
        beneficiary_type: 'salarie',
        issue_date: addDays(today, -20),
        valid_until: addDays(today, 6),
        ceiling_minor: 750_000,
        currency: 'XAF',
        status: 'actif'
      })
      db()
        .prepare(`UPDATE rejections SET missing_document = 'Bon de commande (PO)', corrective_action = 'Demander le PO au service achats du client', redeposit_due = ?
          WHERE id = (SELECT r.id FROM rejections r JOIN invoices i ON i.id = r.invoice_id WHERE i.company_id IN (?, ?) ORDER BY r.id LIMIT 1)`)
        .run(addDays(today, -1), A, D)

      const draftsA = created.filter((c) => c.company === A && bal(c.id).status === 'brouillon').map((c) => c.id)
      if (draftsA.length) {
        batches.create({
          company_id: A,
          invoice_ids: draftsA,
          reference: 'BRD-DEMO-001',
          period_start: addDays(today, -30),
          period_end: today,
          deposit_date: today,
          deposit_mode: 'main_propre',
          acknowledgment_ref: null
        })
      }

      const ctB = db().prepare(`SELECT id FROM contacts WHERE company_id = ? AND role = 'compta_fournisseurs'`).get(B) as { id: number }
      const openB2 = created.filter((c) => c.company === B && bal(c.id).b > 0 && ['envoyee', 'acceptee'].includes(bal(c.id).status))
      if (openB2[0])
        activities.create({
          company_id: B,
          contact_id: ctB.id,
          type: 'appel',
          occurred_at: addDays(today, -2),
          summary: 'Appel à la comptabilité : la facture est validée, paiement prévu au prochain cycle de règlement.',
          invoice_ids: [openB2[0].id],
          promise: { amount_minor: bal(openB2[0].id).b, currency: 'XAF', promised_date: addDays(today, 5) }
        })
      const openC = created.filter((c) => c.company === C && bal(c.id).b > 0 && ['envoyee', 'acceptee', 'partiellement_payee'].includes(bal(c.id).status))
      const ctC = db().prepare(`SELECT id FROM contacts WHERE company_id = ? AND role = 'compta_fournisseurs'`).get(C) as { id: number }
      if (openC[0])
        activities.create({
          company_id: C,
          contact_id: ctC.id,
          type: 'visite',
          occurred_at: addDays(today, -15),
          summary: 'Visite au service fournisseurs : engagement oral de régler la facture sous 10 jours.',
          invoice_ids: [openC[0].id],
          promise: { amount_minor: bal(openC[0].id).b, currency: 'USD', promised_date: addDays(today, -5) }
        })
      activities.create({
        company_id: A,
        type: 'email_recu',
        occurred_at: addDays(today, -1),
        summary: 'E-mail du gestionnaire tiers : demande de copie des bons de prise en charge du mois dernier.',
        invoice_ids: []
      })

      // Relevé bancaire fictif : une ligne citant un n° de facture, une égale à un paiement déjà saisi, une sans correspondance
      const st = Number(db().prepare(`INSERT INTO bank_statements (file_name, bank_name, currency, is_demo) VALUES ('Relevé démo.xlsx', 'Banque fictive', 'XAF', 1)`).run().lastInsertRowid)
      const insLine = db().prepare(`INSERT INTO bank_statement_lines (statement_id, op_date, label, reference, amount_minor, currency, fingerprint) VALUES (?,?,?,?,?,?,?)`)
      const target = created.find((c) => c.company === A && c.cur === 'XAF' && bal(c.id).b > 0 && ['envoyee', 'acceptee'].includes(bal(c.id).status))
      if (target) {
        const num = (db().prepare('SELECT number FROM invoices WHERE id = ?').get(target.id) as { number: string }).number
        insLine.run(st, addDays(today, -1), `VIR RECU ATLANTIQUE OFFSHORE REF ${num.replace(/-/g, '')}`, 'VR-77801', bal(target.id).b, 'XAF', `demo-1-${target.id}`)
      }
      const grp = db().prepare(`SELECT amount_minor, received_at FROM payments WHERE reference = 'VIR-GROUPE-001'`).get() as { amount_minor: number; received_at: string } | undefined
      if (grp) insLine.run(st, grp.received_at, 'VIREMENT KOUILOU ENERGIE SA', 'VR-77655', grp.amount_minor, 'XAF', 'demo-2')
      insLine.run(st, addDays(today, -2), 'REMISE CHEQUE DIVERS', null, 85_000, 'XAF', 'demo-3')

      const demoIds = [A, B, C, D].join(',')
      for (const t of ['companies', 'contacts', 'conventions', 'coverage_vouchers', 'invoices', 'payments', 'activities', 'promises', 'litigation_cases', 'deposit_batches']) {
        const col = t === 'companies' ? 'id' : 'company_id'
        db().prepare(`UPDATE ${t} SET is_demo = 1 WHERE ${col} IN (${demoIds})`).run()
      }
      db().prepare(`UPDATE rejections SET is_demo = 1 WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (${demoIds}))`).run()
      setSetting('demo_loaded', true)
      audit('demo', 'systeme', null, 'Données de démonstration chargées')
    })
    activities.evaluatePromises()
    reminders.generate()
    return true
  },

  /** Efface TOUT ce qui concerne les entreprises de démonstration (y compris ce qui y a été ajouté). */
  clear() {
    const ids = (db().prepare('SELECT id FROM companies WHERE is_demo = 1').all() as { id: number }[]).map((r) => r.id)
    if (!ids.length) {
      setSetting('demo_loaded', false)
      return true
    }
    const list = ids.join(',')
    const inv = `SELECT id FROM invoices WHERE company_id IN (${list})`
    tx(() => {
      const run = (sql: string) => db().prepare(sql).run()
      // V2
      run(`UPDATE payments SET bank_line_id = NULL WHERE company_id IN (${list})`)
      run(`DELETE FROM bank_statements WHERE is_demo = 1`)
      run(`UPDATE bank_statement_lines SET status = 'non_rapproche', payment_id = NULL WHERE payment_id IN (SELECT id FROM payments WHERE company_id IN (${list}))`)
      run(`DELETE FROM promises WHERE company_id IN (${list})`)
      run(`DELETE FROM activity_invoices WHERE invoice_id IN (${inv}) OR activity_id IN (SELECT id FROM activities WHERE company_id IN (${list}))`)
      run(`DELETE FROM activities WHERE company_id IN (${list})`)
      run(`DELETE FROM litigation_invoices WHERE invoice_id IN (${inv})`)
      run(`DELETE FROM attachments WHERE owner_type = 'litigation' AND owner_id IN (SELECT id FROM litigation_cases WHERE company_id IN (${list}))`)
      run(`DELETE FROM litigation_cases WHERE company_id IN (${list})`)
      run(`DELETE FROM deposit_batch_invoices WHERE invoice_id IN (${inv})`)
      run(`DELETE FROM deposit_batches WHERE company_id IN (${list})`)
      run(`DELETE FROM rejections WHERE invoice_id IN (${inv})`)
      run(`DELETE FROM attachments WHERE owner_type = 'voucher' AND owner_id IN (SELECT id FROM coverage_vouchers WHERE company_id IN (${list}))`)
      run(`DELETE FROM reminder_invoices WHERE reminder_id IN (SELECT id FROM reminders WHERE company_id IN (${list})) OR invoice_id IN (${inv})`)
      run(`DELETE FROM reminders WHERE company_id IN (${list})`)
      run(`DELETE FROM reminder_task_invoices WHERE task_id IN (SELECT id FROM reminder_tasks WHERE company_id IN (${list})) OR invoice_id IN (${inv})`)
      run(`DELETE FROM reminder_tasks WHERE company_id IN (${list})`)
      run(`DELETE FROM payment_allocations WHERE invoice_id IN (${inv}) OR payment_id IN (SELECT id FROM payments WHERE company_id IN (${list}))`)
      run(`DELETE FROM payments WHERE company_id IN (${list})`)
      run(`DELETE FROM invoice_events WHERE invoice_id IN (${inv})`)
      run(`DELETE FROM attachments WHERE (owner_type = 'invoice' AND owner_id IN (${inv})) OR (owner_type = 'company' AND owner_id IN (${list}))`)
      run(`DELETE FROM invoices WHERE company_id IN (${list}) AND kind = 'avoir'`)
      run(`DELETE FROM invoices WHERE company_id IN (${list})`)
      run(`DELETE FROM coverage_vouchers WHERE company_id IN (${list})`)
      run(`DELETE FROM conventions WHERE company_id IN (${list})`)
      run(`DELETE FROM contacts WHERE company_id IN (${list})`)
      run(`UPDATE companies SET parent_company_id = NULL WHERE parent_company_id IN (${list}) AND is_demo = 0`)
      run(`DELETE FROM companies WHERE id IN (${list}) AND parent_company_id IS NOT NULL`)
      run(`DELETE FROM companies WHERE id IN (${list})`)
      setSetting('demo_loaded', false)
      audit('demo', 'systeme', null, 'Données de démonstration effacées')
    })
    return getSettings().demo_loaded === false
  }
}
