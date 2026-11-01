// Authentification et gestion de la clé de chiffrement.
//
// Principe : une CLÉ MAÎTRESSE aléatoire (256 bits) chiffre la base et les pièces jointes.
// Elle est stockée dans auth.json, « enveloppée » deux fois :
//   - par une clé dérivée du mot de passe (scrypt) ;
//   - par une clé dérivée de la clé de secours (à imprimer).
// Le mot de passe n'est jamais stocké. Changer de mot de passe ne re-chiffre pas la base.
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { AppError } from '../errors'
import { paths, ensureDir } from '../paths'
import { closeDatabase, openDatabase, setDb, isOpen } from '../db/connection'
import { decrypt, deriveKey, encrypt, generateRecoveryKey, normalizeRecoveryKey } from './crypto'
import { passwordSchema } from '@shared/schemas'

interface Wrapped {
  salt: string
  wrapped: string
}
interface AuthFile {
  version: 1
  kdf: 'scrypt'
  password: Wrapped
  recovery: Wrapped
  created_at: string
}

let masterKey: Buffer | null = null
let failures = 0
let blockedUntil = 0
const listeners: { unlock: (() => void)[]; lock: (() => void)[] } = { unlock: [], lock: [] }

export function onUnlock(cb: () => void): void {
  listeners.unlock.push(cb)
}
export function onLock(cb: () => void): void {
  listeners.lock.push(cb)
}

function wrap(secret: string, key: Buffer): Wrapped {
  const salt = randomBytes(16)
  return { salt: salt.toString('base64'), wrapped: encrypt(deriveKey(secret, salt), key).toString('base64') }
}

function unwrap(secret: string, w: Wrapped): Buffer | null {
  try {
    return decrypt(deriveKey(secret, Buffer.from(w.salt, 'base64')), Buffer.from(w.wrapped, 'base64'))
  } catch {
    return null
  }
}

function readAuth(): AuthFile {
  return JSON.parse(readFileSync(paths.auth, 'utf8')) as AuthFile
}

/** Écriture atomique (fichier temporaire puis renommage) pour ne jamais corrompre auth.json. */
function writeAuth(a: AuthFile): void {
  ensureDir(paths.data)
  const tmp = paths.auth + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2), 'utf8')
  renameSync(tmp, paths.auth)
}

function open(key: Buffer): void {
  const db = openDatabase(paths.db, key.toString('hex'))
  setDb(db)
  masterKey = key
  failures = 0
  for (const cb of listeners.unlock) {
    try {
      cb()
    } catch (e) {
      console.error('onUnlock', e)
    }
  }
}

function checkThrottle(): void {
  const wait = Math.ceil((blockedUntil - Date.now()) / 1000)
  if (wait > 0) throw new AppError(`Trop d’essais incorrects. Patientez ${wait} secondes avant de réessayer.`)
}

function registerFailure(): never {
  failures++
  if (failures >= 5) {
    blockedUntil = Date.now() + 30_000
    failures = 0
    throw new AppError('Mot de passe incorrect. Trop d’essais : l’application est bloquée 30 secondes.')
  }
  throw new AppError(`Mot de passe incorrect (essai ${failures} sur 5).`)
}

export const auth = {
  status() {
    return { configured: existsSync(paths.auth), unlocked: isOpen() }
  },

  /** Premier lancement : création du mot de passe. Retourne la clé de secours à imprimer. */
  setup(password: string) {
    if (existsSync(paths.auth)) throw new AppError('Un mot de passe est déjà configuré.')
    passwordSchema.parse(password)
    const key = randomBytes(32)
    const recoveryKey = generateRecoveryKey()
    // Une ancienne base sans auth.json serait illisible : on la met de côté plutôt que de l'écraser.
    if (existsSync(paths.db)) renameSync(paths.db, paths.db + `.orpheline-${Date.now()}`)
    rmSync(paths.db + '-wal', { force: true })
    rmSync(paths.db + '-shm', { force: true })
    writeAuth({
      version: 1,
      kdf: 'scrypt',
      password: wrap(password, key),
      recovery: wrap(normalizeRecoveryKey(recoveryKey), key),
      created_at: new Date().toISOString()
    })
    open(key)
    return { recoveryKey }
  },

  unlock(password: string) {
    checkThrottle()
    const key = unwrap(password, readAuth().password)
    if (!key) registerFailure()
    open(key)
    return true
  },

  /** Mot de passe oublié : la clé de secours permet d'en définir un nouveau. */
  recover(recoveryKey: string, newPassword: string) {
    checkThrottle()
    passwordSchema.parse(newPassword)
    const a = readAuth()
    const key = unwrap(normalizeRecoveryKey(recoveryKey), a.recovery)
    if (!key) {
      failures++
      if (failures >= 5) blockedUntil = Date.now() + 30_000
      throw new AppError('Clé de secours incorrecte. Vérifiez chaque caractère (les tirets sont facultatifs).')
    }
    writeAuth({ ...a, password: wrap(newPassword, key) })
    open(key)
    return true
  },

  changePassword(oldPassword: string, newPassword: string) {
    passwordSchema.parse(newPassword)
    const a = readAuth()
    const key = unwrap(oldPassword, a.password)
    if (!key) throw new AppError('L’ancien mot de passe est incorrect.')
    writeAuth({ ...a, password: wrap(newPassword, key) })
    return true
  },

  /** Génère une nouvelle clé de secours (l'ancienne ne fonctionne plus). */
  regenerateRecoveryKey(password: string) {
    const a = readAuth()
    const key = unwrap(password, a.password)
    if (!key) throw new AppError('Mot de passe incorrect.')
    const recoveryKey = generateRecoveryKey()
    writeAuth({ ...a, recovery: wrap(normalizeRecoveryKey(recoveryKey), key) })
    return { recoveryKey }
  },

  lock() {
    for (const cb of listeners.lock) {
      try {
        cb()
      } catch (e) {
        console.error('onLock', e)
      }
    }
    closeDatabase()
    if (masterKey) masterKey.fill(0)
    masterKey = null
    return true
  }
}

export function getMasterKey(): Buffer {
  if (!masterKey) throw new AppError('L’application est verrouillée.')
  return masterKey
}
