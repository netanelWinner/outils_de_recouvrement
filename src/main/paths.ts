import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// Toutes les données vivent dans %APPDATA%\Recouvrement (conservées à la désinstallation).
export const paths = {
  get data() {
    return app.getPath('userData')
  },
  get db() {
    return join(this.data, 'recouvrement.db')
  },
  get auth() {
    return join(this.data, 'auth.json')
  },
  get pieces() {
    return join(this.data, 'pieces')
  },
  /** Fichiers déchiffrés temporairement pour consultation (vidé au verrouillage). */
  get tmp() {
    return join(app.getPath('temp'), 'Recouvrement-consultation')
  },
  get defaultReportsDir() {
    if (process.env.RECOUVREMENT_DATA_DIR) return join(process.env.RECOUVREMENT_DATA_DIR, 'rapports')
    return join(app.getPath('documents'), 'Recouvrement - Rapports')
  },
  get defaultBackupDir() {
    if (process.env.RECOUVREMENT_DATA_DIR) return join(process.env.RECOUVREMENT_DATA_DIR, 'sauvegardes')
    return join(app.getPath('documents'), 'Recouvrement - Sauvegardes')
  }
}

/**
 * Tests automatisés uniquement : si RECOUVREMENT_AUTOSAVE_DIR est défini, les documents sont
 * enregistrés directement dans ce dossier, sans boîte de dialogue ni ouverture.
 */
export function autoSavePath(fileName: string): string | null {
  const dir = process.env.RECOUVREMENT_AUTOSAVE_DIR
  return dir ? join(ensureDir(dir), fileName) : null
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}
