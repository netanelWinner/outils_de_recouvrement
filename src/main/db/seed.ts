// Données initiales : modèles de relance et scénario par défaut (créés une seule fois).
import type { DB } from './connection'

const SIGNATURE = `{signataire}
{fonction}
{hopital}
Tél. : {telephone_hopital} – E-mail : {email_hopital}`

export const DEFAULT_TEMPLATES = [
  {
    key: 'email_courtois',
    name: 'E-mail – Rappel courtois',
    channel: 'email',
    tone: 'courtois',
    subject: 'Rappel – Facture(s) en attente de règlement – {hopital}',
    body: `Bonjour {contact},

Sauf erreur de notre part, les factures ci-dessous, arrivées à échéance, restent à ce jour en attente de règlement :

{liste_factures}

Montant total dû : {total_du}

Il s’agit peut-être d’un simple oubli. Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais. Si le paiement a déjà été effectué, merci de ne pas tenir compte de ce message et de nous communiquer la référence du virement.

Nous restons à votre disposition pour tout document complémentaire (copie de facture, bon de prise en charge, bon de commande).

Cordialement,

${SIGNATURE}`
  },
  {
    key: 'email_ferme',
    name: 'E-mail – Relance ferme',
    channel: 'email',
    tone: 'ferme',
    subject: 'RELANCE – Factures impayées depuis {jours_retard} jours – {entreprise}',
    body: `Bonjour {contact},

Malgré notre précédent rappel, nous constatons que les factures suivantes demeurent impayées :

{liste_factures}

Montant total dû : {total_du}
Retard maximal : {jours_retard} jours

Nous vous demandons de bien vouloir procéder à leur règlement sous huit (8) jours, ou de nous indiquer par retour la date de paiement prévue ainsi que tout motif de blocage (pièce manquante, validation interne en cours…), afin que nous puissions y remédier sans délai.

Dans l’attente de votre retour, nous vous prions d’agréer nos salutations distinguées.

${SIGNATURE}`
  },
  {
    key: 'courrier_mise_en_demeure',
    name: 'Courrier – Mise en demeure',
    channel: 'courrier',
    tone: 'mise_en_demeure',
    subject: 'Mise en demeure de payer',
    body: `Madame, Monsieur,

Par la présente, et malgré nos relances restées sans effet, nous vous mettons en demeure de procéder au règlement des sommes dont votre société reste redevable envers notre établissement, au titre des factures suivantes :

{liste_factures}

soit un montant total de {total_du} en principal, auquel s’ajoutent les pénalités de retard prévues par la convention qui nous lie, arrêtées à ce jour à : {penalites}.

Nous vous demandons de régler l’intégralité de ces sommes dans un délai de huit (8) jours à compter de la réception de la présente.

À défaut de règlement dans ce délai, nous nous réservons le droit d’engager, sans autre avis, toute procédure de recouvrement appropriée, notamment la procédure d’injonction de payer prévue par l’Acte uniforme OHADA portant organisation des procédures simplifiées de recouvrement et des voies d’exécution, les frais en résultant restant à votre charge.

La présente vaut mise en demeure au sens des dispositions légales applicables.

Nous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.`
  },
  {
    key: 'courrier_ferme',
    name: 'Courrier – Lettre de relance',
    channel: 'courrier',
    tone: 'ferme',
    subject: 'Relance – Factures impayées',
    body: `Madame, Monsieur,

Sauf erreur ou omission de notre part, nous restons dans l’attente du règlement des factures suivantes, échues à ce jour :

{liste_factures}

Montant total dû : {total_du}

Nous vous saurions gré de bien vouloir procéder à leur règlement dans les meilleurs délais, ou de nous faire connaître la date de paiement envisagée. Si le règlement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente.

Nous vous prions d’agréer, Madame, Monsieur, l’expression de nos salutations distinguées.`
  },
  {
    key: 'whatsapp_courtois',
    name: 'WhatsApp – Rappel courtois',
    channel: 'whatsapp',
    tone: 'courtois',
    subject: null,
    body: `Bonjour {contact}, c’est {signataire} du service recouvrement de {hopital}.
Petit rappel concernant {nb_factures} facture(s) échue(s) de {entreprise}, pour un total de {total_du} :
{liste_factures}
Pourriez-vous me confirmer la date de paiement prévue ? Merci beaucoup et bonne journée.`
  },
  {
    key: 'whatsapp_ferme',
    name: 'WhatsApp – Relance ferme',
    channel: 'whatsapp',
    tone: 'ferme',
    subject: null,
    body: `Bonjour {contact}, {signataire} de {hopital}.
Malgré nos relances, {nb_factures} facture(s) de {entreprise} restent impayées depuis {jours_retard} jours (total {total_du}).
Merci de me communiquer sous 48 h la date de règlement ou le motif de blocage, afin que nous puissions régulariser. Cordialement.`
  }
] as const

const DEFAULT_STEPS = [
  { offset: 3, channel: 'email', template: 'email_courtois', label: 'Rappel courtois' },
  { offset: 15, channel: 'email', template: 'email_ferme', label: 'Relance ferme' },
  { offset: 30, channel: 'courrier', template: 'courrier_mise_en_demeure', label: 'Mise en demeure' }
]

export function seedDefaults(db: DB): void {
  const count = (db.prepare('SELECT count(*) AS n FROM reminder_templates').get() as { n: number }).n
  if (count > 0) return
  db.transaction(() => {
    const ids = new Map<string, number>()
    const ins = db.prepare(
      `INSERT INTO reminder_templates (name, channel, tone, subject, body, requires_legal_review) VALUES (?,?,?,?,?,?)`
    )
    for (const t of DEFAULT_TEMPLATES) {
      const r = ins.run(t.name, t.channel, t.tone, t.subject, t.body, t.tone === 'mise_en_demeure' ? 1 : 0)
      ids.set(t.key, Number(r.lastInsertRowid))
    }
    const sc = db.prepare(`INSERT INTO reminder_scenarios (name, is_default) VALUES ('Scénario standard', 1)`).run()
    const insStep = db.prepare(
      `INSERT INTO reminder_steps (scenario_id, position, offset_days, channel, template_id, label) VALUES (?,?,?,?,?,?)`
    )
    DEFAULT_STEPS.forEach((s, i) => insStep.run(sc.lastInsertRowid, i + 1, s.offset, s.channel, ids.get(s.template), s.label))
  })()
}
