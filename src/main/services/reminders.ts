// Relances : modèles, scénario, génération quotidienne des relances à envoyer, envoi sur 3 canaux, historique.
import { db } from '../db/connection'
import { audit, invoiceEvent, nowLocal, tx } from '../db/util'
import { BALANCE, RECEIVABLE } from '../db/sql'
import { AppError } from '../errors'
import { scenarioSchema, sendReminderSchema, templateSchema, type ScenarioInput, type SendReminderInput, type TemplateInput } from '@shared/schemas'
import { CHANNELS, DELIVERY_LABELS, TONES, type Channel, type Delivery, type PenaltyType, type Tone } from '@shared/constants'
import { todayISO } from '@shared/dates'
import { planReminders, type ReminderCandidate, type ScenarioStep } from '@shared/domain/reminders'
import { buildVariables, renderTemplate } from '@shared/domain/templating'
import { computePenalty } from '@shared/domain/penalties'
import { getSettings } from './settings'
import { invoices, type InvoiceRow } from './invoices'
import { messaging, normalizePhone } from './messaging'
import { letterHtml, renderPdf, savePdf } from './pdf'
import { activities } from './activities'
import type { ContactRow } from './companies'

export interface TemplateRow {
  id: number
  name: string
  channel: Channel
  tone: Tone
  subject: string | null
  body: string
  requires_legal_review: number
  legal_validated: number
  used_in_steps: number
}

export interface StepRow {
  id: number
  scenario_id: number
  position: number
  offset_days: number
  channel: Channel
  template_id: number
  template_name: string
  label: string
}

interface CompanyLite {
  id: number
  name: string
  address: string | null
  city: string | null
  email: string | null
  phone: string | null
}

function company(id: number): CompanyLite {
  const c = db().prepare('SELECT id, name, address, city, email, phone FROM companies WHERE id = ? AND deleted_at IS NULL').get(id) as CompanyLite | undefined
  if (!c) throw new AppError('Entreprise introuvable.')
  return c
}

function contactsOf(companyId: number): ContactRow[] {
  return db()
    .prepare(`SELECT * FROM contacts WHERE company_id = ? AND deleted_at IS NULL
      ORDER BY (role = 'compta_fournisseurs') DESC, is_primary DESC, full_name`)
    .all(companyId) as ContactRow[]
}

/** Interlocuteur le plus pertinent pour un canal (comptabilité fournisseurs en priorité). */
function bestContact(contacts: ContactRow[], channel: Channel): ContactRow | null {
  if (channel === 'email') return contacts.find((c) => c.email) ?? null
  if (channel === 'whatsapp') return contacts.find((c) => c.whatsapp) ?? contacts.find((c) => c.phone) ?? null
  return contacts[0] ?? null
}

function recipientFor(channel: Channel, contact: ContactRow | null, comp: CompanyLite): string | null {
  if (channel === 'email') return contact?.email ?? comp.email
  if (channel === 'whatsapp') return contact?.whatsapp ?? contact?.phone ?? comp.phone
  return null
}

function getTemplate(id: number): TemplateRow {
  const t = db().prepare('SELECT *, 0 AS used_in_steps FROM reminder_templates WHERE id = ? AND deleted_at IS NULL').get(id) as TemplateRow | undefined
  if (!t) throw new AppError('Modèle de relance introuvable.')
  return t
}

function penaltyFor(inv: InvoiceRow): number {
  if (!inv.convention_id) return 0
  const cv = db()
    .prepare('SELECT penalty_type, penalty_rate, penalty_fixed_minor, penalty_grace_days FROM conventions WHERE id = ?')
    .get(inv.convention_id) as { penalty_type: PenaltyType; penalty_rate: number; penalty_fixed_minor: number; penalty_grace_days: number } | undefined
  if (!cv) return 0
  return computePenalty(inv.balance_minor, inv.days_late, {
    type: cv.penalty_type,
    rate: cv.penalty_rate,
    fixed: cv.penalty_fixed_minor,
    graceDays: cv.penalty_grace_days
  })
}

/** Remplit le modèle avec les données réelles. */
function render(templateText: string, comp: CompanyLite, contact: ContactRow | null, rows: InvoiceRow[]): string {
  const s = getSettings()
  const vars = buildVariables({
    companyName: comp.name,
    contactName: contact?.full_name,
    invoices: rows.map((r) => ({
      number: r.number,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      balance: r.balance_minor,
      currency: r.currency,
      daysLate: r.days_late,
      penalty: penaltyFor(r)
    })),
    hospital: { name: s.hospital.name, phone: s.hospital.phone ?? '', email: s.hospital.email ?? '' },
    signatory: { name: s.signatory.name, title: s.signatory.title },
    today: todayISO()
  })
  return renderTemplate(templateText, vars)
}

function defaultScenarioId(): number {
  const r = db().prepare('SELECT id FROM reminder_scenarios WHERE is_default = 1 ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (!r) throw new AppError('Aucun scénario de relance configuré.')
  return r.id
}

function stepsOf(scenarioId: number): StepRow[] {
  return db()
    .prepare(`SELECT s.*, t.name AS template_name FROM reminder_steps s JOIN reminder_templates t ON t.id = s.template_id
      WHERE s.scenario_id = ? AND s.active = 1 ORDER BY s.offset_days`)
    .all(scenarioId) as StepRow[]
}

function letterWatermark(t: TemplateRow | null): string | null {
  return t && t.requires_legal_review && !t.legal_validated ? 'PROJET – à faire valider par le service juridique' : null
}

async function buildLetterPdf(comp: CompanyLite, contact: ContactRow | null, subject: string, body: string, t: TemplateRow | null) {
  return renderPdf(
    letterHtml({
      company: comp,
      contact,
      subject,
      body,
      watermark: letterWatermark(t),
      registered: t?.tone === 'mise_en_demeure'
    })
  )
}

export const reminders = {
  // ------------------------------------------------------------ Modèles
  templates(): TemplateRow[] {
    return db()
      .prepare(`SELECT t.*, (SELECT count(*) FROM reminder_steps s WHERE s.template_id = t.id AND s.active = 1) AS used_in_steps
        FROM reminder_templates t WHERE t.deleted_at IS NULL ORDER BY t.channel, t.tone, t.name`)
      .all() as TemplateRow[]
  },

  saveTemplate(id: number | null, input: TemplateInput) {
    const d = templateSchema.parse(input)
    if (d.channel === 'email' && !d.subject) throw new AppError('Un modèle d’e-mail doit avoir un objet.')
    const p = { ...d, requires_legal_review: d.requires_legal_review || d.tone === 'mise_en_demeure' ? 1 : 0, legal_validated: d.legal_validated ? 1 : 0 }
    if (id) {
      const before = getTemplate(id)
      db()
        .prepare(`UPDATE reminder_templates SET name=@name, channel=@channel, tone=@tone, subject=@subject, body=@body,
          requires_legal_review=@requires_legal_review, legal_validated=@legal_validated, updated_at=datetime('now','localtime') WHERE id=@id`)
        .run({ ...p, id })
      audit('modification', 'modele', id, `Modèle « ${d.name} » modifié`, before, d)
      return { id }
    }
    const r = db()
      .prepare(`INSERT INTO reminder_templates (name, channel, tone, subject, body, requires_legal_review, legal_validated)
        VALUES (@name, @channel, @tone, @subject, @body, @requires_legal_review, @legal_validated)`)
      .run(p)
    audit('creation', 'modele', Number(r.lastInsertRowid), `Modèle « ${d.name} » créé`)
    return { id: Number(r.lastInsertRowid) }
  },

  removeTemplate(id: number) {
    const t = getTemplate(id)
    const used = (db().prepare('SELECT count(*) AS n FROM reminder_steps WHERE template_id = ? AND active = 1').get(id) as { n: number }).n
    if (used) throw new AppError('Ce modèle est utilisé par le scénario de relance : remplacez-le d’abord dans le scénario.')
    db().prepare('UPDATE reminder_templates SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'modele', id, `Modèle « ${t.name} » mis à la corbeille`)
    return true
  },

  // ------------------------------------------------------------ Scénario
  scenario() {
    const id = defaultScenarioId()
    const sc = db().prepare('SELECT * FROM reminder_scenarios WHERE id = ?').get(id) as { id: number; name: string }
    return { ...sc, steps: stepsOf(id) }
  },

  saveScenario(input: ScenarioInput) {
    const d = scenarioSchema.parse(input)
    tx(() => {
      db().prepare('UPDATE reminder_scenarios SET name = ? WHERE id = ?').run(d.name, d.id)
      const existing = stepsOf(d.id).map((s) => s.id)
      const kept = new Set<number>()
      const sorted = [...d.steps].sort((a, b) => a.offset_days - b.offset_days)
      sorted.forEach((s, i) => {
        getTemplate(s.template_id)
        if (s.id && existing.includes(s.id)) {
          db()
            .prepare('UPDATE reminder_steps SET position=?, offset_days=?, channel=?, template_id=?, label=? WHERE id=?')
            .run(i + 1, s.offset_days, s.channel, s.template_id, s.label, s.id)
          kept.add(s.id)
        } else {
          db()
            .prepare('INSERT INTO reminder_steps (scenario_id, position, offset_days, channel, template_id, label) VALUES (?,?,?,?,?,?)')
            .run(d.id, i + 1, s.offset_days, s.channel, s.template_id, s.label)
        }
      })
      // Les étapes retirées sont désactivées (pas supprimées) pour préserver l'historique.
      for (const old of existing) if (!kept.has(old)) db().prepare('UPDATE reminder_steps SET active = 0 WHERE id = ?').run(old)
      // Les relances en attente d'une étape retirée n'ont plus lieu d'être.
      db()
        .prepare(`UPDATE reminder_tasks SET status = 'ignoree', done_at = ? WHERE status IN ('a_envoyer','reportee')
          AND step_id IN (SELECT id FROM reminder_steps WHERE active = 0)`)
        .run(nowLocal())
      audit('modification', 'scenario', d.id, `Scénario de relance « ${d.name} » modifié`, undefined, d)
    })
    return true
  },

  // ------------------------------------------------------------ Génération quotidienne
  /** Crée les relances à envoyer aujourd'hui selon le scénario (idempotent). */
  generate() {
    const today = todayISO()
    const defId = defaultScenarioId()
    const stepsByScenario = new Map<number | null, ScenarioStep[]>()
    const scenarioIds = db().prepare('SELECT id FROM reminder_scenarios').all() as { id: number }[]
    for (const { id } of scenarioIds) {
      const steps = stepsOf(id).map((s) => ({ id: s.id, offsetDays: s.offset_days }))
      stepsByScenario.set(id, steps)
      if (id === defId) stepsByScenario.set(null, steps)
    }
    const rows = db()
      .prepare(`SELECT i.id, i.company_id, c.reminder_scenario_id, i.due_date, ${BALANCE} AS balance, i.status FROM invoices i
        JOIN companies c ON c.id = i.company_id WHERE ${RECEIVABLE} AND ${BALANCE} > 0 AND c.deleted_at IS NULL`)
      .all() as { id: number; company_id: number; reminder_scenario_id: number | null; due_date: string; balance: number; status: ReminderCandidate['status'] }[]
    const handled = new Map<number, number[]>()
    for (const h of db()
      .prepare('SELECT rti.invoice_id, t.step_id FROM reminder_task_invoices rti JOIN reminder_tasks t ON t.id = rti.task_id')
      .all() as { invoice_id: number; step_id: number }[]) {
      handled.set(h.invoice_id, [...(handled.get(h.invoice_id) ?? []), h.step_id])
    }
    const promised = activities.pendingPromiseScope()
    const plan = planReminders(
      rows.map((r) => ({
        invoiceId: r.id,
        companyId: r.company_id,
        scenarioId: r.reminder_scenario_id,
        dueDate: r.due_date,
        balance: r.balance,
        status: r.status,
        handledStepIds: handled.get(r.id) ?? [],
        hasPendingPromise: promised.invoiceIds.has(r.id) || promised.companyIds.has(r.company_id)
      })),
      stepsByScenario,
      today
    )
    let created = 0
    tx(() => {
      for (const p of plan) {
        const existing = db()
          .prepare(`SELECT id FROM reminder_tasks WHERE company_id = ? AND step_id = ? AND status IN ('a_envoyer','reportee') ORDER BY id DESC LIMIT 1`)
          .get(p.companyId, p.stepId) as { id: number } | undefined
        const taskId = existing
          ? existing.id
          : Number(db().prepare('INSERT INTO reminder_tasks (company_id, step_id, planned_for) VALUES (?,?,?)').run(p.companyId, p.stepId, today).lastInsertRowid)
        if (!existing) created++
        const ins = db().prepare('INSERT OR IGNORE INTO reminder_task_invoices (task_id, invoice_id) VALUES (?,?)')
        for (const inv of p.invoiceIds) ins.run(taskId, inv)
      }
      // Nettoyage : une relance en attente dont toutes les factures sont réglées n'a plus d'objet.
      db()
        .prepare(`UPDATE reminder_tasks SET status = 'ignoree', done_at = @now WHERE status IN ('a_envoyer','reportee') AND NOT EXISTS (
          SELECT 1 FROM reminder_task_invoices rti JOIN invoices i ON i.id = rti.invoice_id
          WHERE rti.task_id = reminder_tasks.id AND ${RECEIVABLE} AND ${BALANCE} > 0 AND i.status NOT IN ('contentieux','rejetee'))`)
        .run({ now: nowLocal() })
    })
    return { created }
  },

  /** Relances à envoyer aujourd'hui (et reportées arrivées à échéance). */
  tasks() {
    const today = todayISO()
    const tasks = db()
      .prepare(`SELECT t.id, t.company_id, t.step_id, t.planned_for, t.status, t.postponed_to, s.label AS step_label, s.offset_days,
          s.channel, s.template_id, tp.tone, c.name AS company_name
        FROM reminder_tasks t JOIN reminder_steps s ON s.id = t.step_id JOIN companies c ON c.id = t.company_id
        JOIN reminder_templates tp ON tp.id = s.template_id
        WHERE c.deleted_at IS NULL AND (t.status = 'a_envoyer' OR (t.status = 'reportee' AND t.postponed_to <= ?))
        ORDER BY s.offset_days DESC, c.name`)
      .all(today) as {
      id: number
      company_id: number
      step_id: number
      planned_for: string
      status: string
      postponed_to: string | null
      step_label: string
      offset_days: number
      channel: Channel
      template_id: number
      tone: Tone
      company_name: string
    }[]
    const promised = activities.pendingPromiseScope()
    return tasks.map((t) => {
      const ids = (db().prepare('SELECT invoice_id FROM reminder_task_invoices WHERE task_id = ?').all(t.id) as { invoice_id: number }[]).map((r) => r.invoice_id)
      // Factures payées, en contentieux ou sous promesse de paiement en cours : retirées de la relance
      const rows = invoices
        .rowsByIds(ids)
        .filter((r) => r.balance_minor > 0 && !['soldee', 'annulee', 'contentieux'].includes(r.status))
        .filter((r) => !promised.invoiceIds.has(r.id) && !promised.companyIds.has(r.company_id))
      const contacts = contactsOf(t.company_id)
      const contact = bestContact(contacts, t.channel)
      return { ...t, invoices: rows, contact, has_recipient: t.channel === 'courrier' || !!recipientFor(t.channel, contact, company(t.company_id)) }
    })
  },

  pendingCount(): number {
    return (db()
      .prepare(`SELECT count(*) AS n FROM reminder_tasks t JOIN companies c ON c.id = t.company_id
        WHERE c.deleted_at IS NULL AND (t.status = 'a_envoyer' OR (t.status = 'reportee' AND t.postponed_to <= ?))`)
      .get(todayISO()) as { n: number }).n
  },

  /** Prépare le contenu d'une relance (aperçu modifiable avant envoi). */
  compose(p: { company_id: number; invoice_ids: number[]; template_id: number | null; channel: Channel; contact_id?: number | null }) {
    const comp = company(p.company_id)
    const contacts = contactsOf(p.company_id)
    const contact = p.contact_id ? (contacts.find((c) => c.id === p.contact_id) ?? null) : bestContact(contacts, p.channel)
    const rows = invoices.rowsByIds(p.invoice_ids)
    if (rows.some((r) => r.company_id !== p.company_id && !isChildOf(r.company_id, p.company_id)))
      throw new AppError('Une relance groupée ne peut concerner qu’une seule entreprise.')
    const tpl = p.template_id ? getTemplate(p.template_id) : null
    return {
      company: comp,
      contacts,
      contact_id: contact?.id ?? null,
      recipient: recipientFor(p.channel, contact, comp),
      subject: tpl?.subject ? render(tpl.subject, comp, contact, rows) : '',
      body: tpl ? render(tpl.body, comp, contact, rows) : '',
      template: tpl,
      invoices: rows,
      needs_legal_review: !!(tpl && tpl.requires_legal_review && !tpl.legal_validated)
    }
  },

  /** Envoie (ou prépare) la relance et l'enregistre dans l'historique. */
  async send(input: SendReminderInput) {
    const d = sendReminderSchema.parse(input)
    const comp = company(d.company_id)
    const contacts = contactsOf(d.company_id)
    const contact = d.contact_id ? (contacts.find((c) => c.id === d.contact_id) ?? null) : null
    const tpl = d.template_id ? getTemplate(d.template_id) : null
    const subject = d.subject || (tpl?.subject ?? 'Relance')
    const rows = invoices.rowsByIds(d.invoice_ids)
    if (rows.length === 0) throw new AppError('Aucune facture valide à relancer.')
    const fileBase = `Relance ${comp.name} ${todayISO()}`
    let delivery: Delivery
    let recipient = d.recipient

    if (d.mode === 'smtp') {
      if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new AppError('Adresse e-mail du destinataire manquante ou invalide.')
      const attachments = d.attach_pdf ? [{ filename: `${fileBase}.pdf`, content: await buildLetterPdf(comp, contact, subject, d.body, tpl) }] : undefined
      await messaging.send({ to: recipient, subject, text: d.body, attachments })
      delivery = 'envoye_smtp'
    } else if (d.mode === 'eml') {
      const attachments = d.attach_pdf ? [{ filename: `${fileBase}.pdf`, content: await buildLetterPdf(comp, contact, subject, d.body, tpl) }] : undefined
      await messaging.draft({ to: recipient, subject, text: d.body, attachments, fileName: fileBase })
      delivery = 'brouillon_eml'
    } else if (d.mode === 'whatsapp') {
      if (!recipient || !normalizePhone(recipient)) throw new AppError('Numéro WhatsApp du destinataire manquant ou invalide.')
      recipient = await messaging.whatsapp(recipient, d.body)
      delivery = 'whatsapp_ouvert'
    } else {
      const pdf = await buildLetterPdf(comp, contact, subject, d.body, tpl)
      const saved = await savePdf(pdf, fileBase)
      if (!saved) return { cancelled: true as const }
      delivery = 'imprime'
    }

    const id = tx(() => {
      const r = db()
        .prepare(`INSERT INTO reminders (task_id, company_id, contact_id, template_id, channel, tone, delivery, recipient, subject, body)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(d.task_id, d.company_id, contact?.id ?? null, tpl?.id ?? null, d.channel, tpl?.tone ?? null, delivery, recipient, subject, d.body)
      const rid = Number(r.lastInsertRowid)
      const ins = db().prepare('INSERT INTO reminder_invoices (reminder_id, invoice_id) VALUES (?,?)')
      for (const row of rows) {
        ins.run(rid, row.id)
        invoiceEvent(
          row.id,
          'relance',
          `${DELIVERY_LABELS[delivery]}${tpl ? ` – ${TONES[tpl.tone]}` : ''}${recipient ? ` (${recipient})` : ''}${rows.length > 1 ? ` – relance groupée de ${rows.length} factures` : ''}`
        )
      }
      if (d.task_id) db().prepare(`UPDATE reminder_tasks SET status = 'envoyee', done_at = ? WHERE id = ?`).run(nowLocal(), d.task_id)
      audit('relance', 'entreprise', d.company_id, `${CHANNELS[d.channel]} – ${DELIVERY_LABELS[delivery]} – ${comp.name} (${rows.length} facture(s))`)
      return rid
    })
    return { cancelled: false as const, id, delivery }
  },

  /** Envoie par e-mail (SMTP) toutes les relances e-mail sélectionnées, avec le modèle prévu. */
  async sendAllEmails(taskIds: number[]) {
    const results: { task_id: number; company: string; ok: boolean; message: string }[] = []
    const all = reminders.tasks().filter((t) => taskIds.includes(t.id))
    for (const t of all) {
      try {
        if (t.channel !== 'email') throw new AppError('ce n’est pas une relance par e-mail')
        if (t.invoices.length === 0) throw new AppError('plus aucune facture à relancer')
        const c = reminders.compose({ company_id: t.company_id, invoice_ids: t.invoices.map((i) => i.id), template_id: t.template_id, channel: 'email' })
        if (!c.recipient) throw new AppError('aucune adresse e-mail connue pour cette entreprise')
        await reminders.send({
          task_id: t.id,
          company_id: t.company_id,
          invoice_ids: t.invoices.map((i) => i.id),
          template_id: t.template_id,
          channel: 'email',
          contact_id: c.contact_id,
          recipient: c.recipient,
          subject: c.subject,
          body: c.body,
          mode: 'smtp',
          attach_pdf: false
        })
        results.push({ task_id: t.id, company: t.company_name, ok: true, message: `envoyé à ${c.recipient}` })
      } catch (e) {
        results.push({ task_id: t.id, company: t.company_name, ok: false, message: e instanceof Error ? e.message : String(e) })
      }
    }
    return results
  },

  postpone(taskId: number, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= todayISO()) throw new AppError('Choisissez une date future.')
    db().prepare(`UPDATE reminder_tasks SET status = 'reportee', postponed_to = ? WHERE id = ?`).run(date, taskId)
    audit('relance', 'relance', taskId, `Relance reportée au ${date}`)
    return true
  },

  ignore(taskId: number) {
    db().prepare(`UPDATE reminder_tasks SET status = 'ignoree', done_at = ? WHERE id = ?`).run(nowLocal(), taskId)
    audit('relance', 'relance', taskId, 'Relance ignorée')
    return true
  },

  history(q: { company_id?: number | null; channel?: Channel | null; page?: number; page_size?: number } = {}) {
    const w = ['1=1']
    const p: Record<string, unknown> = {}
    if (q.company_id) {
      w.push('r.company_id = @company')
      p.company = q.company_id
    }
    if (q.channel) {
      w.push('r.channel = @channel')
      p.channel = q.channel
    }
    const pageSize = Math.min(Math.max(q.page_size ?? 50, 10), 500)
    const page = Math.max(1, q.page ?? 1)
    const rows = db()
      .prepare(`SELECT r.id, r.company_id, c.name AS company_name, r.channel, r.tone, r.delivery, r.recipient, r.subject, r.sent_at,
          ct.full_name AS contact_name, t.name AS template_name,
          (SELECT group_concat(i.number, ', ') FROM reminder_invoices ri JOIN invoices i ON i.id = ri.invoice_id WHERE ri.reminder_id = r.id) AS invoice_numbers
        FROM reminders r JOIN companies c ON c.id = r.company_id LEFT JOIN contacts ct ON ct.id = r.contact_id
        LEFT JOIN reminder_templates t ON t.id = r.template_id
        WHERE ${w.join(' AND ')} ORDER BY r.sent_at DESC, r.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...p, limit: pageSize, offset: (page - 1) * pageSize }) as {
      id: number
      company_id: number
      company_name: string
      channel: Channel
      tone: Tone | null
      delivery: Delivery
      recipient: string | null
      subject: string | null
      sent_at: string
      contact_name: string | null
      template_name: string | null
      invoice_numbers: string | null
    }[]
    const total = (db().prepare(`SELECT count(*) AS n FROM reminders r WHERE ${w.join(' AND ')}`).get(p) as { n: number }).n
    return { rows, total, page, page_size: pageSize }
  },

  getReminder(id: number) {
    const r = db().prepare('SELECT r.*, c.name AS company_name FROM reminders r JOIN companies c ON c.id = r.company_id WHERE r.id = ?').get(id)
    if (!r) throw new AppError('Relance introuvable.')
    return r as { id: number; company_name: string; channel: Channel; delivery: Delivery; recipient: string | null; subject: string | null; body: string; sent_at: string }
  }
}

function isChildOf(companyId: number, parentId: number): boolean {
  const r = db().prepare('SELECT parent_company_id FROM companies WHERE id = ?').get(companyId) as { parent_company_id: number | null } | undefined
  return r?.parent_company_id === parentId
}
