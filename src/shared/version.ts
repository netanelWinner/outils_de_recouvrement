// Numéros de version et notes de version (« Quoi de neuf »).

/** 1 si a > b, -1 si a < b, 0 si égales (« 1.10.0 » > « 1.9.0 »). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export const CHANGELOG: { version: string; title: string; items: string[] }[] = [
  {
    version: '1.2.1',
    title: 'Affichage plus net',
    items: [
      'Les montants ne débordent plus jamais de leur cadre, même en milliards : la taille s’ajuste automatiquement.',
      'Unités (FCFA, USD) plus discrètes, pour une lecture plus rapide des chiffres.',
      'Mise en page adaptée aux écrans d’ordinateur portable (tableaux, cartes, barre du haut, fiche entreprise).'
    ]
  },
  {
    version: '1.2.0',
    title: 'Pilotage et rapports',
    items: [
      'Score de fiabilité (A à E) pour chaque entreprise : retard moyen réel, factures payées à l’échéance, rejets, promesses tenues.',
      'Prévisions d’encaissement sur 3 mois, facture par facture, visibles aussi sur le tableau de bord.',
      'Rapport mensuel pour la direction (PDF), généré automatiquement chaque début de mois et envoyable par e-mail.',
      'Mises à jour simplifiées : depuis un fichier d’installation ou en ligne, avec sauvegarde automatique avant.'
    ]
  },
  {
    version: '1.1.0',
    title: 'Suivi complet du recouvrement',
    items: [
      'Bons de prise en charge, bordereaux de dépôt, suivi détaillé des rejets.',
      'Échanges et promesses de paiement, agenda du jour enrichi et notifications.',
      'Rapprochement bancaire et contentieux.'
    ]
  },
  { version: '1.0.0', title: 'Première version', items: ['Factures, paiements, relances sur 3 canaux, tableau de bord, documents PDF, import/export Excel, sauvegardes.'] }
]

/** Notes des versions installées depuis `previous` (exclue) jusqu'à `current` (incluse). */
export function changesSince(previous: string | null, current: string) {
  return CHANGELOG.filter((c) => compareVersions(c.version, current) <= 0 && (!previous || compareVersions(c.version, previous) > 0))
}
