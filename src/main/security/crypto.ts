// Primitives cryptographiques (Node crypto, aucune dépendance externe).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scryptSync } from 'node:crypto'

/** Paramètres scrypt : ~100 ms par essai, ce qui freine fortement les attaques par force brute. */
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret.normalize('NFC'), salt, 32, SCRYPT)
}

/** Chiffrement authentifié AES-256-GCM : iv(12) | tag(16) | données. */
export function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data])
}

/** Lève une erreur si la clé est mauvaise ou si les données ont été altérées. */
export function decrypt(key: Buffer, blob: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
  decipher.setAuthTag(blob.subarray(12, 28))
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()])
}

/** Sous-clé dédiée à un usage (ex. pièces jointes), dérivée de la clé maîtresse. */
export function subKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), purpose, 32))
}

/** Clé de secours lisible : 6 groupes de 4 caractères sans ambiguïté (pas de O/0, I/1). */
export function generateRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(24)
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length])
  return [0, 4, 8, 12, 16, 20].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

export function normalizeRecoveryKey(k: string): string {
  return k.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
