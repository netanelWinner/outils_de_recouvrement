// Sauvegarde (quotidienne automatique ou manuelle) vers un dossier choisi : clé USB, OneDrive, Google Drive…
// Une sauvegarde = un dossier contenant la base CHIFFRÉE, auth.json et les pièces jointes chiffrées.
// Elle ne peut être relue qu'avec le mot de passe (ou la clé de secours) en vigueur au moment de la sauvegarde.
import { app, BrowserWindow, dialog } from 'electron'
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { db } from '../db/connection'
import { audit } from '../db/util'
import { AppError } from '../errors'
import { paths, ensureDir } from '../paths'
import { auth, getMasterKey } from '../security/auth'
import { getSettings, setSetting } from './settings'
import { todayISO } from '@shared/dates'

const PREFIX = 'Sauvegarde Recouvrement '

interface Manifest {
  app: 'Recouvrement'
  app_version: string
  created_at: string
  reason: string
  invoices: number
  companies: number
}

function backupDir(): string {
  return getSettings().backup.dir || paths.defaultBackupDir
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`
}

/** Ouvre la copie avec la clé et vérifie son intégrité. */
function verify(file: string): void {
  const copy = new Database(file, { readonly: true })
  try {
    copy.pragma(`cipher='sqlcipher'`)
    copy.pragma('legacy=4')
    copy.pragma(`key='${getMasterKey().toString('hex')}'`)
    const r = copy.pragma('quick_check', { simple: true })
    if (r !== 'ok') throw new AppError('La copie de sauvegarde est endommagée : ' + r)
  } finally {
    copy.close()
  }
}

function readManifest(dir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
  } catch {
    return null
  }
}

export const backup = {
  info() {
    const s = getSettings().backup
    return { ...s, dir: backupDir(), is_default_dir: !s.dir }
  },

  async chooseDir() {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Choisir le dossier de sauvegarde (clé USB, OneDrive, Google Drive…)', properties: ['openDirectory' as const, 'createDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const s = getSettings().backup
    setSetting('backup', { ...s, dir: res.filePaths[0] })
    audit('modification', 'parametres', null, `Dossier de sauvegarde : ${res.filePaths[0]}`)
    return res.filePaths[0]
  },

  run(reason: 'auto' | 'manuelle' | 'avant-restauration' | 'avant-mise-a-jour' = 'manuelle') {
    const root = backupDir()
    try {
      ensureDir(root)
    } catch {
      throw new AppError(`Le dossier de sauvegarde « ${root} » est inaccessible (clé USB débranchée ?). Choisissez un autre dossier dans Paramètres → Sauvegarde.`)
    }
    const target = join(root, `${PREFIX}${stamp()}${reason === 'auto' ? '' : ` (${reason})`}`)
    ensureDir(target)
    try {
      db().pragma('wal_checkpoint(TRUNCATE)')
      // Copie synchrone : aucune écriture ne peut intervenir pendant la copie.
      copyFileSync(paths.db, join(target, 'recouvrement.db'))
      copyFileSync(paths.auth, join(target, 'auth.json'))
      if (existsSync(paths.pieces)) cpSync(paths.pieces, join(target, 'pieces'), { recursive: true })
      verify(join(target, 'recouvrement.db'))
      const counts = db()
        .prepare('SELECT (SELECT count(*) FROM invoices WHERE deleted_at IS NULL) AS invoices, (SELECT count(*) FROM companies WHERE deleted_at IS NULL) AS companies')
        .get() as { invoices: number; companies: number }
      const manifest: Manifest = { app: 'Recouvrement', app_version: app.getVersion(), created_at: new Date().toISOString(), reason, ...counts }
      writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
      writeFileSync(
        join(target, 'LISEZ-MOI.txt'),
        'Sauvegarde chiffrée de l’application Recouvrement.\r\nPour restaurer : Paramètres → Sauvegarde → « Restaurer une sauvegarde », puis choisir ce dossier.\r\nLe mot de passe à utiliser sera celui en vigueur à la date de cette sauvegarde.\r\n'
      )
    } catch (e) {
      rmSync(target, { recursive: true, force: true })
      if (e instanceof AppError) throw e
      throw new AppError('La sauvegarde a échoué : ' + (e instanceof Error ? e.message : String(e)))
    }
    setSetting('backup', { ...getSettings().backup, last_at: new Date().toISOString() })
    backup.prune()
    audit('sauvegarde', 'systeme', null, `Sauvegarde ${reason} créée : ${target}`)
    return target
  },

  /** Sauvegarde automatique si aucune n'a été faite aujourd'hui. */
  autoIfDue(): { done: boolean; error?: string; path?: string } {
    const s = getSettings().backup
    if (!s.auto) return { done: false }
    if (s.last_at && s.last_at.slice(0, 10) === new Date().toISOString().slice(0, 10)) return { done: false }
    try {
      return { done: true, path: backup.run('auto') }
    } catch (e) {
      return { done: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  list() {
    const root = backupDir()
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((n) => n.startsWith(PREFIX))
      .map((name) => {
        const dir = join(root, name)
        const m = readManifest(dir)
        let size = 0
        try {
          size = statSync(join(dir, 'recouvrement.db')).size
        } catch {
          /* rien */
        }
        return { name, dir, manifest: m, size }
      })
      .filter((b) => b.manifest)
      .sort((a, b) => b.manifest!.created_at.localeCompare(a.manifest!.created_at))
  },

  /** Ne garde que les N sauvegardes automatiques les plus récentes (les manuelles sont conservées). */
  prune() {
    const keep = getSettings().backup.keep
    const autos = backup.list().filter((b) => b.manifest?.reason === 'auto')
    for (const b of autos.slice(keep)) rmSync(b.dir, { recursive: true, force: true })
  },

  /** Restauration : sauvegarde de l'état actuel, remplacement des fichiers, redémarrage. */
  async restore(dir?: string) {
    let source = dir
    if (!source) {
      const win = BrowserWindow.getFocusedWindow()
      const opts = { title: 'Choisir le dossier de sauvegarde à restaurer', defaultPath: backupDir(), properties: ['openDirectory' as const] }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return { restored: false }
      source = res.filePaths[0]
    }
    const m = readManifest(source)
    if (!m || !existsSync(join(source, 'recouvrement.db')) || !existsSync(join(source, 'auth.json')))
      throw new AppError('Ce dossier n’est pas une sauvegarde valide de l’application (fichiers manquants).')
    backup.run('avant-restauration')
    auth.lock()
    for (const f of [paths.db, paths.db + '-wal', paths.db + '-shm']) rmSync(f, { force: true })
    copyFileSync(join(source, 'recouvrement.db'), paths.db)
    copyFileSync(join(source, 'auth.json'), paths.auth)
    rmSync(paths.pieces, { recursive: true, force: true })
    if (existsSync(join(source, 'pieces'))) cpSync(join(source, 'pieces'), paths.pieces, { recursive: true })
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 300)
    return { restored: true, date: m.created_at.slice(0, 10) || todayISO() }
  }
}
