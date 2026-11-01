// Connexion à la base SQLite chiffrée (SQLCipher via better-sqlite3-multiple-ciphers).
import Database from 'better-sqlite3-multiple-ciphers'
import { AppError } from '../errors'
import { MIGRATIONS } from './migrations'
import { seedDefaults } from './seed'

export type DB = Database.Database

let current: DB | null = null

/** Ouvre (ou crée) la base avec la clé ; lève une erreur si la clé est fausse. */
export function openDatabase(file: string, keyHex: string): DB {
  const db = new Database(file)
  try {
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${keyHex.replace(/[^0-9a-f]/gi, '')}'`)
    db.prepare('SELECT count(*) FROM sqlite_master').get() // échoue si la clé est fausse
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    migrate(db)
    return db
  } catch (e) {
    db.close()
    throw e
  }
}

export function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((m) => m.version > version).sort((a, b) => a.version - b.version)
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })()
  }
  seedDefaults(db)
}

export function setDb(db: DB | null): void {
  current = db
}

export function db(): DB {
  if (!current) throw new AppError('L’application est verrouillée. Reconnectez-vous.')
  return current
}

export function isOpen(): boolean {
  return current !== null
}

export function closeDatabase(): void {
  if (current) {
    try {
      current.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* rien */
    }
    current.close()
    current = null
  }
}
