// Paramètres (stockés dans la base chiffrée, donc y compris le mot de passe SMTP).
import { dialog, BrowserWindow } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { z } from 'zod'
import { db } from '../db/connection'
import { audit } from '../db/util'
import { AppError } from '../errors'
import {
  backupSettingsSchema,
  currencySettingsSchema,
  hospitalSettingsSchema,
  legalSettingsSchema,
  reportsSettingsSchema,
  securitySettingsSchema,
  updatesSettingsSchema,
  signatorySettingsSchema,
  smtpSettingsSchema
} from '@shared/schemas'
import type { Currency } from '@shared/constants'

export interface Settings {
  hospital: {
    name: string
    address: string | null
    city: string | null
    country: string | null
    phone: string | null
    email: string | null
    website: string | null
    niu: string | null
    rccm: string | null
    bank_details: string | null
  }
  signatory: { name: string; title: string; show_stamp: boolean }
  currency: { default: Currency; usd_rate: number }
  smtp: {
    host: string | null
    port: number
    secure: boolean
    user: string | null
    pass: string | null
    from_name: string | null
    from_email: string | null
  }
  backup: { dir: string | null; keep: number; auto: boolean; last_at: string | null }
  security: { lock_minutes: number }
  legal: { prescription_years: number }
  reports: { auto: boolean; dir: string | null; email_to: string | null }
  updates: { url: string | null; last_check: string | null }
  onboarding_done: boolean
  demo_loaded: boolean
}

const DEFAULTS: Settings = {
  hospital: {
    name: '',
    address: null,
    city: 'Pointe-Noire',
    country: 'République du Congo',
    phone: null,
    email: null,
    website: null,
    niu: null,
    rccm: null,
    bank_details: null
  },
  signatory: { name: '', title: 'Chargée de recouvrement', show_stamp: true },
  currency: { default: 'XAF', usd_rate: 600 },
  smtp: { host: null, port: 587, secure: false, user: null, pass: null, from_name: null, from_email: null },
  backup: { dir: null, keep: 30, auto: true, last_at: null },
  security: { lock_minutes: 5 },
  legal: { prescription_years: 5 },
  reports: { auto: true, dir: null, email_to: null },
  updates: { url: null, last_check: null },
  onboarding_done: false,
  demo_loaded: false
}

const SECTION_SCHEMAS = {
  hospital: hospitalSettingsSchema,
  signatory: signatorySettingsSchema,
  currency: currencySettingsSchema,
  smtp: smtpSettingsSchema,
  backup: backupSettingsSchema,
  security: securitySettingsSchema,
  legal: legalSettingsSchema,
  reports: reportsSettingsSchema,
  updates: updatesSettingsSchema
} as const
export type SettingsSection = keyof typeof SECTION_SCHEMAS

export function getSettings(): Settings {
  const rows = db().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const out = structuredClone(DEFAULTS) as unknown as Record<string, unknown>
  for (const r of rows) {
    const v = JSON.parse(r.value)
    const def = out[r.key]
    out[r.key] = def && typeof def === 'object' && v && typeof v === 'object' ? { ...def, ...v } : v
  }
  return out as unknown as Settings
}

export function setSetting(key: string, value: unknown): void {
  db().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}

type AssetKind = 'logo' | 'signature' | 'cachet'
const ASSET_LABELS: Record<AssetKind, string> = { logo: 'le logo', signature: 'la signature', cachet: 'le cachet' }
const MIMES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }

export function getAssetDataUrl(kind: AssetKind): string | null {
  const row = db().prepare('SELECT mime, data FROM assets WHERE kind = ?').get(kind) as { mime: string; data: Buffer } | undefined
  return row ? `data:${row.mime};base64,${row.data.toString('base64')}` : null
}

export const settings = {
  get(): Settings & { smtp_configured: boolean } {
    const s = getSettings()
    // Le mot de passe SMTP ne quitte jamais le processus principal.
    return { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? '••••••••' : null }, smtp_configured: !!(s.smtp.host && s.smtp.from_email) }
  },

  update(section: SettingsSection, value: unknown) {
    const schema = SECTION_SCHEMAS[section] as z.ZodType
    if (!schema) throw new AppError('Section de paramètres inconnue')
    const current = getSettings()[section] as Record<string, unknown>
    const input = { ...(value as Record<string, unknown>) }
    if (section === 'smtp' && input.pass === '••••••••') input.pass = current.pass
    const parsed = schema.parse(input) as Record<string, unknown>
    const next = { ...current, ...parsed }
    setSetting(section, next)
    const safe = (o: Record<string, unknown>) => (section === 'smtp' ? { ...o, pass: o.pass ? '***' : null } : o)
    audit('modification', 'parametres', null, `Paramètres « ${section} » modifiés`, safe(current), safe(next))
    return true
  },

  setFlag(key: 'onboarding_done', value: boolean) {
    setSetting(key, value)
    return true
  },

  getAssets() {
    return { logo: getAssetDataUrl('logo'), signature: getAssetDataUrl('signature'), cachet: getAssetDataUrl('cachet') }
  },

  /** Ouvre un sélecteur d'image et enregistre l'image (PNG/JPG, 2 Mo max). */
  async pickAsset(kind: AssetKind) {
    if (!(kind in ASSET_LABELS)) throw new AppError('Type d’image inconnu')
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: `Choisir ${ASSET_LABELS[kind]}`,
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const file = res.filePaths[0]
    const mime = MIMES[extname(file).toLowerCase()]
    if (!mime) throw new AppError('Format non pris en charge : choisissez une image PNG ou JPG.')
    if (statSync(file).size > 2 * 1024 * 1024) throw new AppError('Image trop lourde (2 Mo maximum). Réduisez-la avant de l’importer.')
    db()
      .prepare(`INSERT INTO assets (kind, mime, data, updated_at) VALUES (?,?,?, datetime('now','localtime'))
        ON CONFLICT(kind) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at`)
      .run(kind, mime, readFileSync(file))
    audit('modification', 'parametres', null, `Image « ${kind} » remplacée`)
    return getAssetDataUrl(kind)
  },

  removeAsset(kind: AssetKind) {
    db().prepare('DELETE FROM assets WHERE kind = ?').run(kind)
    audit('suppression', 'parametres', null, `Image « ${kind} » supprimée`)
    return true
  }
}
