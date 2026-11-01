// Schémas de validation partagés (interface + processus principal), messages en français.
// Les champs suivent les noms de colonnes de la base (snake_case) pour éviter toute conversion.
import { z } from 'zod'
import {
  ACTIVITY_TYPES,
  DEPOSIT_MODES,
  LITIGATION_HANDLERS,
  LITIGATION_PROCEDURES,
  LITIGATION_STATUS,
  BENEFICIARY_TYPES,
  CHANNELS,
  COMPANY_TYPES,
  CONTACT_ROLES,
  CURRENCIES,
  INVOICE_ACTIONS,
  PAYMENT_METHODS,
  PENALTY_TYPES,
  REJECTION_REASONS,
  TERMS_START,
  TONES,
  WORKFLOW_STATUSES
} from './constants'
import { isISODate } from './dates'

const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

/** Texte optionnel : chaîne vide → null. */
const optText = (max = 500) =>
  z
    .string()
    .max(max, `${max} caractères maximum`)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
const reqText = (label: string, max = 200) =>
  z
    .string({ error: `${label} est obligatoire` })
    .trim()
    .min(1, `${label} est obligatoire`)
    .max(max, `${max} caractères maximum`)
const isoDate = (label: string) =>
  z.string({ error: `${label} est obligatoire` }).refine(isISODate, `${label} : date invalide`)
const optDate = (label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || isISODate(v), `${label} : date invalide`)
const id = z.number().int().positive()
const optId = id.nullish().transform((v) => v ?? null)
const email = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Adresse e-mail invalide')
const phone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^[+\d][\d\s.()-]{5,24}$/.test(v), 'Numéro de téléphone invalide')
const currency = z.enum(CURRENCIES, { error: 'Devise invalide' })
const amount = (label: string) =>
  z.number({ error: `${label} est obligatoire` }).int(`${label} invalide`).positive(`${label} doit être supérieur à zéro`)

export const companySchema = z.object({
  name: reqText('Le nom de l’entreprise'),
  short_name: optText(60),
  type: z.enum(keys(COMPANY_TYPES)),
  parent_company_id: optId,
  niu: optText(50),
  rccm: optText(50),
  address: optText(300),
  city: optText(100),
  phone,
  email,
  default_currency: currency,
  payment_terms_days: z.number().int().min(0, 'Délai invalide').max(365, 'Délai maximum : 365 jours'),
  billing_notes: optText(2000),
  notes: optText(2000),
  reminder_scenario_id: optId
})
export type CompanyInput = z.input<typeof companySchema>

export const contactSchema = z.object({
  company_id: id,
  role: z.enum(keys(CONTACT_ROLES)),
  full_name: reqText('Le nom du contact'),
  job_title: optText(100),
  email,
  phone,
  whatsapp: phone,
  third_party_name: optText(150),
  is_primary: z.boolean().default(false),
  notes: optText(1000)
})
export type ContactInput = z.input<typeof contactSchema>

export const conventionSchema = z
  .object({
    company_id: id,
    reference: reqText('La référence de la convention', 100),
    title: optText(200),
    start_date: isoDate('Date de début'),
    end_date: optDate('Date de fin'),
    payment_terms_days: z.number().int().min(0).max(365, 'Délai maximum : 365 jours'),
    terms_start: z.enum(keys(TERMS_START)),
    required_documents: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    billing_format_notes: optText(2000),
    penalty_type: z.enum(keys(PENALTY_TYPES)),
    penalty_rate: z.number().min(0, 'Taux invalide').max(100, 'Taux invalide').default(0),
    penalty_fixed_minor: z.number().int().min(0).default(0),
    penalty_grace_days: z.number().int().min(0).max(365).default(0),
    currency,
    status: z.enum(['active', 'expiree', 'suspendue'])
  })
  .refine((c) => !c.end_date || c.end_date >= c.start_date, { message: 'La date de fin doit suivre la date de début', path: ['end_date'] })
export type ConventionInput = z.input<typeof conventionSchema>

export const invoiceSchema = z
  .object({
    number: reqText('Le numéro de facture', 50),
    company_id: id,
    convention_id: optId,
    voucher_number: optText(60),
    voucher_ceiling_minor: z.number().int().positive().nullish().transform((v) => v ?? null),
    po_number: optText(60),
    patient_name: optText(150),
    patient_matricule: optText(60),
    beneficiary_type: z.enum(keys(BENEFICIARY_TYPES)),
    subcontractor_name: optText(150),
    service_date: optDate('Date de prestation'),
    issue_date: isoDate('Date d’émission'),
    deposit_date: optDate('Date de dépôt'),
    due_date: optDate('Date d’échéance'),
    due_date_manual: z.boolean().default(false),
    amount_minor: amount('Le montant'),
    currency,
    notes: optText(1000),
    workflow_status: z.enum(['brouillon', 'envoyee', 'acceptee']).default('brouillon')
  })
  .refine((i) => i.patient_name || i.patient_matricule, {
    message: 'Indiquez le nom OU le matricule du patient',
    path: ['patient_name']
  })
  .refine((i) => !i.due_date_manual || i.due_date, { message: 'Indiquez la date d’échéance', path: ['due_date'] })
  .refine((i) => !i.deposit_date || i.deposit_date >= i.issue_date, {
    message: 'Le dépôt ne peut pas précéder l’émission',
    path: ['deposit_date']
  })
export type InvoiceInput = z.input<typeof invoiceSchema>

export const creditNoteSchema = z.object({
  invoice_id: id,
  number: reqText('Le numéro de l’avoir', 50),
  issue_date: isoDate('Date de l’avoir'),
  amount_minor: amount('Le montant de l’avoir'),
  notes: reqText('Le motif de l’avoir', 500)
})
export type CreditNoteInput = z.input<typeof creditNoteSchema>

export const invoiceActionSchema = z
  .object({
    ids: z.array(id).min(1, 'Sélectionnez au moins une facture'),
    action: z.enum(keys(INVOICE_ACTIONS)),
    date: optDate('Date'),
    reason_code: z.enum(keys(REJECTION_REASONS)).nullish(),
    reason_text: optText(1000),
    // Détails d'un rejet (V2)
    missing_document: optText(200),
    corrective_action: optText(1000),
    client_contact_id: optId,
    redeposit_due: optDate('Date de re-dépôt prévue')
  })
  .refine((a) => a.action !== 'rejeter' || a.reason_code, { message: 'Choisissez le motif du rejet', path: ['reason_code'] })
export type InvoiceActionInput = z.input<typeof invoiceActionSchema>

export const paymentSchema = z.object({
  company_id: id,
  received_at: isoDate('Date de réception'),
  method: z.enum(keys(PAYMENT_METHODS)),
  reference: optText(100),
  bank_name: optText(100),
  amount_minor: amount('Le montant du paiement'),
  currency,
  notes: optText(1000),
  allocations: z.array(z.object({ invoice_id: id, amount_minor: z.number().int() })).default([])
})
export type PaymentInput = z.input<typeof paymentSchema>

export const templateSchema = z.object({
  name: reqText('Le nom du modèle', 100),
  channel: z.enum(keys(CHANNELS)),
  tone: z.enum(keys(TONES)),
  subject: optText(300),
  body: reqText('Le texte du modèle', 10000),
  requires_legal_review: z.boolean().default(false),
  legal_validated: z.boolean().default(false)
})
export type TemplateInput = z.input<typeof templateSchema>

export const scenarioSchema = z.object({
  id,
  name: reqText('Le nom du scénario', 100),
  steps: z
    .array(
      z.object({
        id: optId,
        offset_days: z.number().int().min(-60).max(730),
        channel: z.enum(keys(CHANNELS)),
        template_id: id,
        label: reqText('Le libellé de l’étape', 100)
      })
    )
    .max(10, '10 étapes maximum')
    .refine((s) => new Set(s.map((x) => x.offset_days)).size === s.length, 'Deux étapes ne peuvent pas avoir le même délai')
})
export type ScenarioInput = z.input<typeof scenarioSchema>

export const sendReminderSchema = z.object({
  task_id: optId,
  company_id: id,
  invoice_ids: z.array(id).min(1, 'Aucune facture à relancer'),
  template_id: optId,
  channel: z.enum(keys(CHANNELS)),
  contact_id: optId,
  recipient: optText(300),
  subject: optText(300),
  body: reqText('Le message', 20000),
  mode: z.enum(['smtp', 'eml', 'whatsapp', 'pdf']),
  attach_pdf: z.boolean().default(false)
})
export type SendReminderInput = z.input<typeof sendReminderSchema>

export const hospitalSettingsSchema = z.object({
  name: reqText('Le nom de l’hôpital'),
  address: optText(300),
  city: optText(100),
  country: optText(100),
  phone: optText(100),
  email,
  website: optText(200),
  niu: optText(50),
  rccm: optText(50),
  bank_details: optText(500)
})
export const signatorySettingsSchema = z.object({ name: reqText('Votre nom', 150), title: reqText('Votre fonction', 150), show_stamp: z.boolean() })
export const currencySettingsSchema = z.object({ default: currency, usd_rate: z.number().positive('Taux invalide').max(10000) })
export const smtpSettingsSchema = z.object({
  host: optText(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: optText(200),
  pass: optText(500),
  from_name: optText(150),
  from_email: email
})
export const backupSettingsSchema = z.object({ dir: optText(500), keep: z.number().int().min(3).max(365), auto: z.boolean() })
export const securitySettingsSchema = z.object({ lock_minutes: z.number().int().min(1).max(120) })
export const legalSettingsSchema = z.object({ prescription_years: z.number().int().min(1).max(30) })
// Le dossier des rapports se choisit uniquement par boîte de dialogue (reports.chooseDir)
export const reportsSettingsSchema = z.object({
  auto: z.boolean(),
  email_to: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || v.split(/[;,]/).every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())), 'Adresse(s) e-mail invalide(s) (séparez-les par des virgules)')
})
export const updatesSettingsSchema = z.object({
  url: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\/+$/, '') : null))
    .refine((v) => v === null || /^https?:\/\/\S+$/.test(v), 'Adresse invalide (elle doit commencer par https://)')
})

// ---------------------------------------------------------------- V2

export const voucherSchema = z
  .object({
    company_id: id,
    convention_id: optId,
    number: reqText('Le n° du bon', 60),
    patient_name: optText(150),
    patient_matricule: optText(60),
    beneficiary_type: z.enum(keys(BENEFICIARY_TYPES)),
    subcontractor_name: optText(150),
    po_number: optText(60),
    issue_date: optDate('Date d’émission du bon'),
    valid_until: optDate('Date de fin de validité'),
    ceiling_minor: z.number().int().positive().nullish().transform((v) => v ?? null),
    currency,
    status: z.enum(['actif', 'annule']).default('actif'),
    notes: optText(1000)
  })
  .refine((v) => v.patient_name || v.patient_matricule, { message: 'Indiquez le nom OU le matricule du patient', path: ['patient_name'] })
  .refine((v) => !v.valid_until || !v.issue_date || v.valid_until >= v.issue_date, { message: 'La fin de validité doit suivre l’émission', path: ['valid_until'] })
export type VoucherInput = z.input<typeof voucherSchema>

export const rejectionUpdateSchema = z.object({
  reason_code: z.enum(keys(REJECTION_REASONS)),
  reason_text: optText(1000),
  missing_document: optText(200),
  corrective_action: optText(1000),
  client_contact_id: optId,
  redeposit_due: optDate('Date de re-dépôt prévue'),
  status: z.enum(['ouvert', 'redepose', 'clos'])
})
export type RejectionUpdateInput = z.input<typeof rejectionUpdateSchema>

export const depositBatchSchema = z.object({
  company_id: id,
  invoice_ids: z.array(id).min(1, 'Sélectionnez au moins une facture'),
  reference: reqText('La référence du bordereau', 60),
  period_start: optDate('Début de période'),
  period_end: optDate('Fin de période'),
  deposit_date: isoDate('Date de dépôt'),
  deposit_mode: z.enum(keys(DEPOSIT_MODES)),
  acknowledgment_ref: optText(100),
  notes: optText(1000)
})
export type DepositBatchInput = z.input<typeof depositBatchSchema>

export const activitySchema = z
  .object({
    company_id: id,
    contact_id: optId,
    type: z.enum(keys(ACTIVITY_TYPES)),
    occurred_at: isoDate('Date'),
    summary: reqText('Le résumé de l’échange', 3000),
    invoice_ids: z.array(id).default([]),
    promise: z
      .object({ amount_minor: amount('Le montant promis'), currency, promised_date: isoDate('Date promise') })
      .nullish()
      .transform((v) => v ?? null)
  })
  .refine((a) => !a.promise || a.promise.promised_date >= a.occurred_at, { message: 'La date promise doit suivre la date de l’échange', path: ['promise'] })
export type ActivityInput = z.input<typeof activitySchema>

export const litigationSchema = z.object({
  company_id: id,
  reference: reqText('La référence du dossier', 60),
  opened_at: isoDate('Date d’ouverture'),
  handler_type: z.enum(keys(LITIGATION_HANDLERS)),
  handler_name: optText(150),
  handler_contact: optText(200),
  procedure: z.enum(keys(LITIGATION_PROCEDURES)),
  status: z.enum(keys(LITIGATION_STATUS)).default('ouvert'),
  outcome_notes: optText(2000),
  notes: optText(2000),
  invoice_ids: z.array(id).default([])
})
export type LitigationInput = z.input<typeof litigationSchema>

export const litigationStepSchema = z.object({ title: reqText('L’intitulé de l’étape', 200), due_date: optDate('Échéance'), notes: optText(1000) })
export const litigationCostSchema = z.object({ date: isoDate('Date'), label: reqText('Le libellé', 200), amount_minor: amount('Le montant'), currency })

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(200)
  .refine((p) => /[A-Za-zÀ-ÿ]/.test(p) && /\d/.test(p), 'Le mot de passe doit contenir au moins une lettre et un chiffre')

export { WORKFLOW_STATUSES }
