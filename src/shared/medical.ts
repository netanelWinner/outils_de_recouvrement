// Garde-fou confidentialité : détecte des termes médicaux dans les champs libres.
// Ce n'est pas un filtre exhaustif, seulement un rappel avant l'enregistrement.
// Un mot terminé par « * » est un radical (séropositif, séropositive…), sinon mot entier.

const KEYWORDS = [
  'diagnostic', 'pathologie', 'paludisme', 'palu', 'vih', 'sida', 'séropositi*', 'tuberculose', 'diabète',
  'hypertension', 'cancer', 'tumeur', 'grossesse', 'enceinte', 'accouchement', 'césarienne', 'chirurgie',
  'opération', 'fracture', 'infection', 'hépatite', 'covid', 'typhoïde', 'ordonnance', 'traitement',
  'radiographie', 'scanner', 'irm', 'échographie', 'biopsie', 'hospitalisé pour', 'psychiatr*', 'dépression'
]

const LETTER = 'a-zà-ÿ'

export function findMedicalTerms(...texts: (string | null | undefined)[]): string[] {
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  if (!hay) return []
  return KEYWORDS.filter((k) => {
    const stem = k.endsWith('*')
    const word = stem ? k.slice(0, -1) : k
    return new RegExp(`(^|[^${LETTER}])${word}${stem ? '' : `(?![${LETTER}])`}`, 'i').test(hay)
  }).map((k) => k.replace('*', ''))
}
