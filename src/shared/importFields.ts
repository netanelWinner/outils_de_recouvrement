// Champs reconnus à l'import Excel et noms de colonnes courants (sans accents, en minuscules).

export const IMPORT_FIELDS = [
  { key: 'number', label: 'N° de facture', required: true, aliases: ['n facture', 'no facture', 'numero facture', 'num facture', 'facture', 'numero', 'n', 'invoice', 'ref facture'] },
  { key: 'company', label: 'Entreprise (client)', required: true, aliases: ['entreprise', 'client', 'societe', 'compagnie', 'payeur', 'company', 'debiteur'] },
  { key: 'amount', label: 'Montant', required: true, aliases: ['montant', 'montant ttc', 'montant facture', 'total', 'total ttc', 'amount', 'net a payer'] },
  { key: 'currency', label: 'Devise', required: false, aliases: ['devise', 'monnaie', 'currency'] },
  { key: 'issue_date', label: 'Date d’émission', required: true, aliases: ['date', 'date facture', 'date emission', 'date d emission', 'emission', 'date de facturation'] },
  { key: 'deposit_date', label: 'Date de dépôt', required: false, aliases: ['date depot', 'date de depot', 'depot', 'date reception', 'date envoi'] },
  { key: 'due_date', label: 'Date d’échéance', required: false, aliases: ['echeance', 'date echeance', 'date d echeance', 'date limite'] },
  { key: 'voucher_number', label: 'N° de bon de prise en charge', required: false, aliases: ['bon', 'n bon', 'numero bon', 'bon de prise en charge', 'prise en charge', 'pec', 'n pec', 'n bpc', 'bpc'] },
  { key: 'po_number', label: 'N° de PO / bon de commande', required: false, aliases: ['po', 'n po', 'bon de commande', 'commande', 'purchase order', 'n commande'] },
  { key: 'patient_name', label: 'Nom du patient', required: false, aliases: ['patient', 'nom patient', 'nom du patient', 'nom', 'beneficiaire', 'nom beneficiaire', 'salarie'] },
  { key: 'patient_matricule', label: 'Matricule du patient', required: false, aliases: ['matricule', 'n matricule', 'id salarie', 'matricule salarie'] },
  { key: 'convention', label: 'Convention (référence)', required: false, aliases: ['convention', 'ref convention', 'reference convention', 'contrat'] },
  { key: 'status', label: 'Statut', required: false, aliases: ['statut', 'etat', 'status', 'situation'] },
  { key: 'paid_amount', label: 'Montant déjà payé', required: false, aliases: ['paye', 'montant paye', 'regle', 'montant regle', 'encaisse', 'deja paye'] },
  { key: 'paid_date', label: 'Date du paiement', required: false, aliases: ['date paiement', 'date de paiement', 'date reglement', 'date encaissement'] },
  { key: 'notes', label: 'Observations', required: false, aliases: ['observations', 'observation', 'remarques', 'remarque', 'commentaire', 'commentaires', 'notes'] }
] as const

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key']
export type ImportMapping = Partial<Record<ImportFieldKey, number | null>>

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[°º#'’.:_/()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Devine la correspondance colonne → champ à partir des en-têtes (factures par défaut, ou autre liste de champs). */
export function guessMapping<K extends string = ImportFieldKey>(
  headers: string[],
  fields: readonly { key: K; aliases: readonly string[] }[] = IMPORT_FIELDS as unknown as { key: K; aliases: readonly string[] }[]
): Partial<Record<K, number | null>> {
  const norm = headers.map(normalizeHeader)
  const used = new Set<number>()
  const mapping: Partial<Record<K, number | null>> = {}
  // Passe 1 : correspondance exacte ; passe 2 : l'en-tête commence ou finit par l'alias
  for (const pass of [0, 1]) {
    for (const f of fields) {
      if (mapping[f.key] !== undefined) continue
      const idx = norm.findIndex(
        (h, i) => !used.has(i) && f.aliases.some((a) => (pass === 0 ? h === a : a.length > 3 && (h.startsWith(a + ' ') || h.endsWith(' ' + a))))
      )
      if (idx >= 0) {
        mapping[f.key] = idx
        used.add(idx)
      }
    }
  }
  return mapping
}
