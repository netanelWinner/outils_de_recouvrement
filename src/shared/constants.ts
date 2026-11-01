// Libellés, couleurs et listes fermées partagés par l'interface et le processus principal.

export const CURRENCIES = ['XAF', 'USD', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]
export const CURRENCY_LABELS: Record<Currency, string> = { XAF: 'FCFA', USD: 'USD', EUR: 'EUR' }
export const CURRENCY_DECIMALS: Record<Currency, number> = { XAF: 0, USD: 2, EUR: 2 }
/** Parité fixe CEMAC : 1 EUR = 655,957 FCFA. */
export const EUR_TO_XAF = 655.957

/** Statut "métier" saisi par l'utilisatrice. */
export const WORKFLOW_STATUSES = ['brouillon', 'envoyee', 'acceptee', 'rejetee', 'contentieux', 'annulee'] as const
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]

/** Statut affiché : statut métier, ou statut calculé à partir des paiements. */
export const INVOICE_STATUSES = [
  'brouillon',
  'envoyee',
  'acceptee',
  'rejetee',
  'partiellement_payee',
  'soldee',
  'contentieux',
  'annulee',
  'avoir'
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** Statuts pour lesquels une somme est réclamable au client. */
export const OPEN_STATUSES: InvoiceStatus[] = ['envoyee', 'acceptee', 'rejetee', 'partiellement_payee', 'contentieux']

export const STATUS_INFO: Record<InvoiceStatus, { label: string; color: string; help: string }> = {
  brouillon: {
    label: 'Brouillon',
    color: 'bg-slate-100 text-slate-700 ring-slate-300',
    help: "Facture saisie mais pas encore déposée chez le client. Elle n'est pas comptée dans les sommes dues."
  },
  envoyee: {
    label: 'Envoyée',
    color: 'bg-sky-50 text-sky-700 ring-sky-300',
    help: 'Facture déposée ou envoyée au client. Le délai de paiement court à partir de la date de dépôt (ou d’émission selon la convention).'
  },
  acceptee: {
    label: 'Acceptée',
    color: 'bg-indigo-50 text-indigo-700 ring-indigo-300',
    help: 'Le client a confirmé que la facture est conforme et sera payée.'
  },
  rejetee: {
    label: 'Rejetée',
    color: 'bg-red-50 text-red-700 ring-red-300',
    help: 'Le client a refusé la facture (bon de commande manquant, pièce absente, mauvais format…). Il faut la corriger puis la redéposer : le délai repart à zéro.'
  },
  partiellement_payee: {
    label: 'Partiellement payée',
    color: 'bg-amber-50 text-amber-800 ring-amber-300',
    help: 'Une partie du montant a été encaissée, le reste est encore dû.'
  },
  soldee: {
    label: 'Soldée',
    color: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
    help: 'La facture est entièrement payée. Plus rien à recouvrer.'
  },
  contentieux: {
    label: 'Contentieux',
    color: 'bg-purple-50 text-purple-700 ring-purple-300',
    help: 'Le dossier est passé en recouvrement juridique (avocat, huissier). Les relances automatiques sont suspendues.'
  },
  annulee: {
    label: 'Annulée',
    color: 'bg-slate-100 text-slate-500 ring-slate-300 line-through',
    help: 'Facture annulée (erreur de saisie ou annulée par un avoir). Elle ne compte plus dans les sommes dues.'
  },
  avoir: {
    label: 'Avoir',
    color: 'bg-teal-50 text-teal-700 ring-teal-300',
    help: 'Note de crédit : elle diminue le montant dû d’une facture (remise, erreur de montant, prestation non due).'
  }
}

export const INVOICE_ACTIONS = {
  envoyer: { label: 'Marquer envoyée / déposée', from: ['brouillon'] as WorkflowStatus[], to: 'envoyee' as WorkflowStatus },
  accepter: { label: 'Marquer acceptée', from: ['envoyee'] as WorkflowStatus[], to: 'acceptee' as WorkflowStatus },
  rejeter: { label: 'Enregistrer un rejet', from: ['envoyee', 'acceptee'] as WorkflowStatus[], to: 'rejetee' as WorkflowStatus },
  redeposer: { label: 'Redéposer (après correction)', from: ['rejetee'] as WorkflowStatus[], to: 'envoyee' as WorkflowStatus },
  contentieux: { label: 'Passer en contentieux', from: ['envoyee', 'acceptee', 'rejetee'] as WorkflowStatus[], to: 'contentieux' as WorkflowStatus },
  sortir_contentieux: { label: 'Sortir du contentieux', from: ['contentieux'] as WorkflowStatus[], to: 'acceptee' as WorkflowStatus },
  brouillon: { label: 'Remettre en brouillon', from: ['envoyee'] as WorkflowStatus[], to: 'brouillon' as WorkflowStatus },
  annuler: { label: 'Annuler la facture', from: ['brouillon'] as WorkflowStatus[], to: 'annulee' as WorkflowStatus }
} as const
export type InvoiceAction = keyof typeof INVOICE_ACTIONS

export const REJECTION_REASONS = {
  po_manquant: 'Bon de commande (PO) manquant',
  bon_manquant: 'Bon de prise en charge manquant',
  piece_absente: 'Pièce justificative absente',
  mauvais_format: 'Mauvais format / portail',
  montant_errone: 'Montant erroné',
  doublon: 'Facture en double',
  hors_convention: 'Hors convention / non couvert',
  autre: 'Autre motif'
} as const
export type RejectionReason = keyof typeof REJECTION_REASONS

export const COMPANY_TYPES = {
  petrolier: 'Compagnie pétrolière',
  sous_traitant: 'Sous-traitant',
  autre: 'Autre entreprise'
} as const
export type CompanyType = keyof typeof COMPANY_TYPES

export const CONTACT_ROLES = {
  compta_fournisseurs: 'Comptabilité fournisseurs',
  rh: 'Ressources humaines',
  hse_medecin: 'HSE / Médecin du travail',
  gestionnaire_tiers: 'Société tierce de gestion',
  direction: 'Direction',
  juridique: 'Juridique',
  autre: 'Autre'
} as const
export type ContactRole = keyof typeof CONTACT_ROLES

export const BENEFICIARY_TYPES = {
  salarie: 'Salarié',
  sous_traitant: 'Salarié d’un sous-traitant',
  ayant_droit: 'Ayant droit (famille)'
} as const
export type BeneficiaryType = keyof typeof BENEFICIARY_TYPES

export const PAYMENT_METHODS = { virement: 'Virement', cheque: 'Chèque', especes: 'Espèces' } as const
export type PaymentMethod = keyof typeof PAYMENT_METHODS

export const TERMS_START = {
  emission: 'Date d’émission de la facture',
  depot: 'Date de dépôt chez le client'
} as const
export type TermsStart = keyof typeof TERMS_START

export const PENALTY_TYPES = {
  aucune: 'Aucune pénalité',
  taux_annuel: 'Taux annuel (%)',
  taux_mensuel: 'Taux mensuel (%)',
  forfait: 'Forfait fixe'
} as const
export type PenaltyType = keyof typeof PENALTY_TYPES

export const CHANNELS = { email: 'E-mail', whatsapp: 'WhatsApp', courrier: 'Courrier' } as const
export type Channel = keyof typeof CHANNELS

export const TONES = { courtois: 'Rappel courtois', ferme: 'Relance ferme', mise_en_demeure: 'Mise en demeure' } as const
export type Tone = keyof typeof TONES

export const DELIVERY_LABELS = {
  envoye_smtp: 'E-mail envoyé',
  brouillon_eml: 'Brouillon e-mail préparé',
  whatsapp_ouvert: 'Message WhatsApp ouvert',
  imprime: 'Lettre PDF générée'
} as const
export type Delivery = keyof typeof DELIVERY_LABELS

export const TEMPLATE_VARIABLES: { key: string; help: string }[] = [
  { key: 'entreprise', help: 'Nom de l’entreprise' },
  { key: 'contact', help: 'Nom de l’interlocuteur (ou « Madame, Monsieur »)' },
  { key: 'n_facture', help: 'Numéro(s) de facture' },
  { key: 'montant', help: 'Montant restant dû' },
  { key: 'echeance', help: 'Date d’échéance (la plus ancienne)' },
  { key: 'jours_retard', help: 'Nombre de jours de retard (le plus grand)' },
  { key: 'liste_factures', help: 'Liste détaillée des factures' },
  { key: 'total_du', help: 'Total dû par l’entreprise sur ces factures' },
  { key: 'nb_factures', help: 'Nombre de factures' },
  { key: 'penalites', help: 'Pénalités de retard calculées selon la convention' },
  { key: 'hopital', help: 'Nom de l’hôpital' },
  { key: 'telephone_hopital', help: 'Téléphone de l’hôpital' },
  { key: 'email_hopital', help: 'E-mail de l’hôpital' },
  { key: 'signataire', help: 'Votre nom' },
  { key: 'fonction', help: 'Votre fonction' },
  { key: 'date', help: 'Date du jour' }
]

export const AGING_BUCKETS = [
  { key: 'non_echu', label: 'Non échu' },
  { key: 'j0_30', label: '1 à 30 j' },
  { key: 'j31_60', label: '31 à 60 j' },
  { key: 'j61_90', label: '61 à 90 j' },
  { key: 'j90_plus', label: '+ de 90 j' }
] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]['key']

// ---------------------------------------------------------------- V2

export const ACTIVITY_TYPES = {
  appel: 'Appel téléphonique',
  visite: 'Visite',
  reunion: 'Réunion',
  email_recu: 'E-mail reçu',
  email_envoye: 'E-mail envoyé',
  courrier_recu: 'Courrier reçu',
  note: 'Note'
} as const
export type ActivityType = keyof typeof ACTIVITY_TYPES

export const PROMISE_STATUS = {
  en_attente: { label: 'En attente', color: 'bg-sky-50 text-sky-800 ring-sky-200' },
  tenue: { label: 'Tenue', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partielle: { label: 'Partiellement tenue', color: 'bg-amber-50 text-amber-800 ring-amber-200' },
  non_tenue: { label: 'Non tenue', color: 'bg-red-50 text-red-700 ring-red-200' },
  annulee: { label: 'Annulée', color: 'bg-slate-100 text-slate-500 ring-slate-200' }
} as const
export type PromiseStatus = keyof typeof PROMISE_STATUS

export const VOUCHER_STATES = {
  actif: { label: 'Valide', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  expire_bientot: { label: 'Expire bientôt', color: 'bg-amber-50 text-amber-800 ring-amber-200' },
  expire: { label: 'Expiré', color: 'bg-red-50 text-red-700 ring-red-200' },
  consomme: { label: 'Plafond atteint', color: 'bg-slate-100 text-slate-600 ring-slate-300' },
  annule: { label: 'Annulé', color: 'bg-slate-100 text-slate-500 ring-slate-200 line-through' }
} as const
export type VoucherState = keyof typeof VOUCHER_STATES
/** Jours avant expiration à partir desquels un bon est signalé. */
export const VOUCHER_WARN_DAYS = 15

export const REJECTION_STATUS = {
  ouvert: { label: 'À corriger', color: 'bg-red-50 text-red-700 ring-red-200' },
  redepose: { label: 'Redéposée', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  clos: { label: 'Clos', color: 'bg-slate-100 text-slate-600 ring-slate-300' }
} as const
export type RejectionStatus = keyof typeof REJECTION_STATUS

export const DEPOSIT_MODES = {
  main_propre: 'Remise en main propre',
  courrier: 'Courrier',
  email: 'E-mail',
  portail: 'Portail fournisseur'
} as const
export type DepositMode = keyof typeof DEPOSIT_MODES

export const LITIGATION_HANDLERS = { avocat: 'Avocat', huissier: 'Huissier de justice', interne: 'Service juridique interne' } as const
export type LitigationHandler = keyof typeof LITIGATION_HANDLERS

export const LITIGATION_PROCEDURES = {
  mise_en_demeure: 'Mise en demeure',
  injonction_de_payer: 'Injonction de payer (OHADA)',
  assignation: 'Assignation en paiement',
  execution: 'Saisie / exécution',
  transaction: 'Négociation / transaction'
} as const
export type LitigationProcedure = keyof typeof LITIGATION_PROCEDURES

export const LITIGATION_STATUS = {
  ouvert: { label: 'En cours', color: 'bg-purple-50 text-purple-700 ring-purple-200' },
  suspendu: { label: 'Suspendu', color: 'bg-slate-100 text-slate-600 ring-slate-300' },
  clos_gagne: { label: 'Clos – recouvré', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  transige: { label: 'Clos – transaction', color: 'bg-teal-50 text-teal-700 ring-teal-200' },
  clos_perdu: { label: 'Clos – irrécouvrable', color: 'bg-red-50 text-red-700 ring-red-200' }
} as const
export type LitigationStatus = keyof typeof LITIGATION_STATUS

export const BANK_LINE_STATUS = {
  non_rapproche: { label: 'À rapprocher', color: 'bg-amber-50 text-amber-800 ring-amber-200' },
  rapproche: { label: 'Rapproché', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  ignore: { label: 'Ignoré', color: 'bg-slate-100 text-slate-500 ring-slate-200' }
} as const
export type BankLineStatus = keyof typeof BANK_LINE_STATUS

export const MEDICAL_WARNING =
  'Confidentialité médicale : ne saisissez jamais de diagnostic, de pathologie ou d’acte médical. Seuls le nom ou matricule du patient, la date, le montant et le n° de bon sont autorisés.'
