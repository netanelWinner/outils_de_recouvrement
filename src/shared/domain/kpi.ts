// Indicateurs du tableau de bord.

/**
 * DSO (Days Sales Outstanding) : nombre moyen de jours pour être payé.
 * DSO = encours clients / chiffre facturé sur la période × nombre de jours de la période.
 */
export function computeDso(outstanding: number, billedOnPeriod: number, periodDays = 90): number | null {
  if (billedOnPeriod <= 0) return null
  return Math.round((outstanding / billedOnPeriod) * periodDays)
}

/** Taux de recouvrement : part du montant facturé déjà encaissée (0 à 100). */
export function recoveryRate(billed: number, collected: number): number | null {
  if (billed <= 0) return null
  return Math.min(100, Math.round((collected / billed) * 1000) / 10)
}

/** Liste des 12 derniers mois « AAAA-MM », du plus ancien au plus récent. */
export function lastMonths(today: string, count = 12): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
