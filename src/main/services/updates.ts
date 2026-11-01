// Mises à jour de l'application, en deux façons simples :
//  1. depuis un fichier d'installation reçu (clé USB, e-mail, WhatsApp…) ;
//  2. en ligne, depuis une adresse configurée (dossier web contenant latest.yml + l'installateur).
// Une sauvegarde est toujours faite avant. Les données (%APPDATA%) ne sont jamais touchées par l'installateur.
import { app, BrowserWindow, dialog, shell } from 'electron'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { autoUpdater } from 'electron-updater'
import { db } from '../db/connection'
import { audit } from '../db/util'
import { AppError } from '../errors'
import { getSettings, setSetting } from './settings'
import { backup } from './backup'
import { changesSince, compareVersions } from '@shared/version'

const pendingFiles = new Map<string, { file: string; version: string }>()

function meta(key: string): string | null {
  return (db().prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
}
function setMeta(key: string, value: string): void {
  db().prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function configureFeed(): void {
  const url = getSettings().updates.url
  if (!url) throw new AppError('Aucune adresse de mise à jour n’est configurée (Paramètres → Mises à jour). Vous pouvez installer depuis un fichier.')
  if (!app.isPackaged) throw new AppError('Les mises à jour en ligne ne fonctionnent que dans l’application installée.')
  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}

function explain(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::/i.test(msg)) throw new AppError('Impossible de joindre le serveur de mise à jour : vérifiez la connexion internet.')
  if (/404|latest\.yml/i.test(msg)) throw new AppError('Aucune mise à jour publiée à cette adresse (fichier latest.yml introuvable).')
  throw new AppError('Échec de la mise à jour : ' + msg)
}

export const updates = {
  info() {
    const s = getSettings().updates
    return { version: app.getVersion(), url: s.url, last_check: s.last_check, packaged: app.isPackaged }
  },

  async checkOnline() {
    configureFeed()
    try {
      const r = await autoUpdater.checkForUpdates()
      setSetting('updates', { ...getSettings().updates, last_check: new Date().toISOString() })
      const version = r?.updateInfo.version ?? app.getVersion()
      const available = compareVersions(version, app.getVersion()) > 0
      const notes = typeof r?.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes.replace(/<[^>]+>/g, '') : null
      return { available, version, notes }
    } catch (e) {
      explain(e)
    }
  },

  /** Télécharge puis installe la mise à jour en ligne (sauvegarde préalable). L'application redémarre. */
  async installOnline() {
    configureFeed()
    backup.run('avant-mise-a-jour')
    try {
      await autoUpdater.checkForUpdates()
      await autoUpdater.downloadUpdate()
    } catch (e) {
      explain(e)
    }
    audit('mise_a_jour', 'systeme', null, 'Mise à jour en ligne téléchargée, installation')
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 500)
    return true
  },

  /** Étape 1 : choisir le fichier d'installation reçu ; on lit sa version dans son nom. */
  async pickInstaller() {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: 'Choisir le fichier d’installation de la nouvelle version', properties: ['openFile' as const], filters: [{ name: 'Installateur', extensions: ['exe'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const file = res.filePaths[0]
    const name = basename(file)
    if (!/recouvrement/i.test(name)) throw new AppError('Ce fichier ne semble pas être un installateur de l’application Recouvrement.')
    const version = name.match(/(\d+\.\d+\.\d+)/)?.[1]
    if (!version) throw new AppError('Impossible de lire le numéro de version dans le nom du fichier (attendu : Recouvrement-Installation-x.y.z.exe).')
    const token = randomUUID()
    pendingFiles.set(token, { file, version })
    return { token, version, current: app.getVersion(), newer: compareVersions(version, app.getVersion()) > 0, file_name: name }
  },

  /** Étape 2 : sauvegarde, lancement de l'installateur, fermeture de l'application. */
  async installFromFile(token: string) {
    const p = pendingFiles.get(token)
    if (!p) throw new AppError('Fichier non sélectionné : recommencez.')
    backup.run('avant-mise-a-jour')
    audit('mise_a_jour', 'systeme', null, `Installation de la version ${p.version} depuis ${basename(p.file)}`)
    const err = await shell.openPath(p.file)
    if (err) throw new AppError('Impossible de lancer l’installateur : ' + err)
    setTimeout(() => app.quit(), 1500)
    return true
  },

  /** Nouveautés depuis la dernière version vue par l'utilisatrice (affichées une fois). */
  whatsNew() {
    const current = app.getVersion()
    const seen = meta('last_seen_version')
    if (!seen) {
      setMeta('last_seen_version', current) // première installation : rien à annoncer
      return []
    }
    return compareVersions(current, seen) > 0 ? changesSince(seen, current) : []
  },

  markSeen() {
    setMeta('last_seen_version', app.getVersion())
    return true
  }
}
