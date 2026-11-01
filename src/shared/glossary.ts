// Définitions affichées dans les infobulles « ? » et la page d'aide.

export const GLOSSARY = {
  bon: {
    term: 'Bon de prise en charge',
    def: 'Document émis par l’entreprise qui garantit qu’elle paiera les soins de son salarié (ou du salarié d’un sous-traitant). Il porte un numéro, parfois un plafond et une date de validité. Sans bon, la facture est souvent rejetée.'
  },
  convention: {
    term: 'Convention',
    def: 'Contrat signé entre l’hôpital et l’entreprise : délai de paiement, pièces à joindre aux factures, pénalités de retard éventuelles.'
  },
  po: {
    term: 'PO (bon de commande)',
    def: '« Purchase Order » : numéro de commande interne exigé par la plupart des pétroliers. Une facture sans PO est presque toujours rejetée.'
  },
  echeance: {
    term: 'Échéance',
    def: 'Date limite de paiement. Elle est calculée automatiquement : date de dépôt (ou d’émission) + délai de la convention. Après un rejet et un re-dépôt, elle repart de la nouvelle date de dépôt.'
  },
  depot: {
    term: 'Dépôt',
    def: 'Date à laquelle la facture a été remise au client (courrier, portail, e-mail). Chez les pétroliers, c’est souvent elle qui fait partir le délai de paiement.'
  },
  avoir: {
    term: 'Avoir (note de crédit)',
    def: 'Document qui annule tout ou partie d’une facture (erreur de montant, remise, prestation contestée). Le reste dû de la facture diminue d’autant.'
  },
  imputation: {
    term: 'Imputation',
    def: 'Rattacher un paiement reçu aux factures qu’il règle. Un même virement peut payer plusieurs factures ; une facture peut être payée en plusieurs fois.'
  },
  balance_agee: {
    term: 'Balance âgée',
    def: 'Répartition des sommes dues selon l’ancienneté du retard : pas encore échu, 1 à 30 jours, 31 à 60, 61 à 90, plus de 90 jours. Plus une créance est ancienne, plus elle est difficile à recouvrer : priorité aux dernières colonnes.'
  },
  dso: {
    term: 'DSO (délai moyen de paiement)',
    def: '« Days Sales Outstanding » : nombre moyen de jours que mettent les clients à payer. Calcul : sommes dues ÷ montant facturé sur 90 jours × 90. Plus il baisse, mieux c’est.'
  },
  taux_recouvrement: {
    term: 'Taux de recouvrement',
    def: 'Part du montant facturé sur les 12 derniers mois qui a déjà été encaissée. Objectif : le plus proche possible de 100 %.'
  },
  mise_en_demeure: {
    term: 'Mise en demeure',
    def: 'Dernière lettre formelle avant une action en justice (droit OHADA). Elle doit être validée par le service juridique de l’hôpital avant envoi, et remise contre décharge ou en recommandé.'
  },
  relance_groupee: {
    term: 'Relance groupée',
    def: 'Une seule relance qui liste toutes les factures en retard d’une même entreprise, au lieu d’un message par facture.'
  },
  scenario: {
    term: 'Scénario de relance',
    def: 'Calendrier automatique des relances après l’échéance (par exemple : rappel courtois à J+3, relance ferme à J+15, mise en demeure à J+30). Chaque matin, l’application prépare la liste des relances à envoyer.'
  },
  penalites: {
    term: 'Pénalités de retard',
    def: 'Intérêts ou forfait dus en cas de retard, si la convention le prévoit. Ils sont calculés automatiquement et peuvent être cités dans les relances.'
  },
  prescription: {
    term: 'Prescription',
    def: 'Au-delà d’un certain délai (5 ans en principe en droit OHADA, à confirmer avec le juridique), une créance ne peut plus être réclamée en justice.'
  },
  bordereau: {
    term: 'Bordereau de dépôt',
    def: 'Liste des factures déposées ensemble chez un client. Faites-le tamponner à la réception : c’est votre preuve de dépôt, qui fait partir le délai de paiement.'
  },
  rapprochement: {
    term: 'Rapprochement bancaire',
    def: 'Comparer le relevé de la banque avec les paiements attendus : chaque virement reçu est rattaché aux factures qu’il règle. L’application propose automatiquement les correspondances.'
  },
  promesse: {
    term: 'Promesse de paiement',
    def: 'Engagement du client de payer un montant à une date donnée. Les relances automatiques sont suspendues jusqu’à cette date ; si rien n’est payé, une alerte apparaît.'
  },
  fiabilite: {
    term: 'Score de fiabilité',
    def: 'Note de A (très fiable) à E (à risque), calculée sur 24 mois d’historique : retard moyen réel de paiement (40 %), part des factures payées à l’échéance (25 %), factures sans rejet (20 %), promesses tenues (15 %). Il faut au moins 3 factures payées pour calculer une note.'
  },
  prevision: {
    term: 'Prévision d’encaissement',
    def: 'Pour chaque facture due, l’application estime une date de paiement (échéance + retard habituel du client, ou date promise) et une probabilité (selon la note du client, l’ancienneté, un rejet ou un contentieux). Le « probable » est la somme des montants multipliés par ces probabilités.'
  },
  contentieux: {
    term: 'Contentieux',
    def: 'Dossier confié à un avocat ou un huissier parce que les relances amiables n’ont pas abouti.'
  }
} as const

export type GlossaryKey = keyof typeof GLOSSARY
