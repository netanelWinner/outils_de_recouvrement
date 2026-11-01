// Montants stockés en ENTIERS dans l'unité mineure de la devise (FCFA : unité ; USD/EUR : centimes).
// Aucun calcul en virgule flottante sur les montants stockés → pas d'erreur d'arrondi.
import { CURRENCY_DECIMALS, CURRENCY_LABELS, EUR_TO_XAF, type Currency } from './constants'

const NBSP = ' '

export function toMinor(amount: number, currency: Currency): number {
  return Math.round(amount * 10 ** CURRENCY_DECIMALS[currency])
}

export function fromMinor(minor: number, currency: Currency): number {
  return minor / 10 ** CURRENCY_DECIMALS[currency]
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** 1250000 XAF → « 1 250 000 FCFA » ; 125050 USD → « 1 250,50 USD ». */
export function formatMoney(minor: number, currency: Currency, withLabel = true): string {
  const dec = CURRENCY_DECIMALS[currency]
  const negative = minor < 0
  const abs = Math.abs(Math.round(minor))
  const intPart = Math.floor(abs / 10 ** dec).toString()
  let out = groupThousands(intPart)
  if (dec > 0) out += ',' + (abs % 10 ** dec).toString().padStart(dec, '0')
  if (negative) out = '-' + out
  return withLabel ? `${out}${NBSP}${CURRENCY_LABELS[currency]}` : out
}

/**
 * Lit un montant saisi librement : « 1 250 000 », « 1250000,50 », « 1.250.000 », 1250000.
 * Retourne le montant en unité mineure, ou null si illisible.
 */
export function parseAmount(input: string | number | null | undefined, currency: Currency): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') return Number.isFinite(input) ? toMinor(input, currency) : null
  let s = input.replace(/[\s  ]/g, '').replace(/(FCFA|XAF|USD|EUR|€|\$)/gi, '')
  if (s === '') return null
  const dots = (s.match(/\./g) || []).length
  const commas = (s.match(/,/g) || []).length
  if (dots > 1) s = s.replace(/\./g, '')
  if (commas > 1) s = s.replace(/,/g, '')
  if (dots === 1 && commas === 1) {
    // « 1.250,50 » ou « 1,250.50 » : le dernier séparateur est la virgule décimale
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace('.', '').replace(',', '.') : s.replace(',', '')
  } else {
    s = s.replace(',', '.')
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return toMinor(parseFloat(s), currency)
}

/** Conversion en FCFA (unité) pour les totaux consolidés. */
export function toXaf(minor: number, currency: Currency, usdRate: number): number {
  if (currency === 'XAF') return minor
  if (currency === 'EUR') return Math.round((minor / 100) * EUR_TO_XAF)
  return Math.round((minor / 100) * usdRate)
}

/** Expression SQL équivalente à toXaf, pour les agrégats en base. */
export function xafSql(amountExpr: string, currencyExpr: string, usdRate: number): string {
  const rate = Number(usdRate) || 0
  return `(CASE ${currencyExpr} WHEN 'XAF' THEN ${amountExpr} WHEN 'EUR' THEN ROUND(${amountExpr} * ${EUR_TO_XAF / 100}) ELSE ROUND(${amountExpr} * ${rate / 100}) END)`
}
