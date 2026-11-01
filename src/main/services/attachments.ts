// Pièces jointes (scans de factures, bons, conventions…), chiffrées sur le disque et rangées par dossier.
import { BrowserWindow, dialog, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { db } from '../db/connection'
import { audit, nowLocal } from '../db/util'
import { AppError } from '../errors'
import { paths, ensureDir } from '../paths'
import { decrypt, encrypt, subKey } from '../security/crypto'
import { getMasterKey } from '../security/auth'

export const OWNER_TYPES = ['company', 'convention', 'invoice', 'payment', 'voucher', 'litigation'] as const
export type OwnerType = (typeof OWNER_TYPES)[number]

export interface AttachmentRow {
  id: number
  owner_type: OwnerType
  owner_id: number
  category: string | null
  original_name: string
  size: number
  mime: string | null
  created_at: string
}

const MAX_SIZE = 25 * 1024 * 1024
const MIMES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.msg': 'application/vnd.ms-outlook',
  '.eml': 'message/rfc822'
}

const key = () => subKey(getMasterKey(), 'recouvrement/pieces-jointes')
const fileOf = (r: { owner_type: string; owner_id: number; stored_name: string }) => join(paths.pieces, r.owner_type, String(r.owner_id), r.stored_name)

function checkOwner(type: OwnerType, id: number): void {
  if (!OWNER_TYPES.includes(type)) throw new AppError('Type de dossier inconnu.')
  const table = { company: 'companies', convention: 'conventions', invoice: 'invoices', payment: 'payments', voucher: 'coverage_vouchers', litigation: 'litigation_cases' }[type]
  if (!db().prepare(`SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id)) throw new AppError('Élément introuvable.')
}

export const attachments = {
  list(ownerType: OwnerType, ownerId: number): AttachmentRow[] {
    return db()
      .prepare(`SELECT id, owner_type, owner_id, category, original_name, size, mime, created_at FROM attachments
        WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`)
      .all(ownerType, ownerId) as AttachmentRow[]
  },

  async add(ownerType: OwnerType, ownerId: number, category: string | null = null) {
    checkOwner(ownerType, ownerId)
    const win = BrowserWindow.getFocusedWindow()
    const opts = {
      title: 'Ajouter des pièces jointes',
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [
        { name: 'Documents', extensions: Object.keys(MIMES).map((e) => e.slice(1)) },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return { added: 0 }
    const dir = ensureDir(join(paths.pieces, ownerType, String(ownerId)))
    let added = 0
    for (const file of res.filePaths) {
      const size = statSync(file).size
      if (size > MAX_SIZE) throw new AppError(`« ${basename(file)} » est trop lourd (25 Mo maximum).`)
      const plain = readFileSync(file)
      const stored = `${randomUUID()}.bin`
      writeFileSync(join(dir, stored), encrypt(key(), plain))
      const r = db()
        .prepare(`INSERT INTO attachments (owner_type, owner_id, category, original_name, stored_name, sha256, size, mime) VALUES (?,?,?,?,?,?,?,?)`)
        .run(ownerType, ownerId, category, basename(file), stored, createHash('sha256').update(plain).digest('hex'), size, MIMES[extname(file).toLowerCase()] ?? null)
      audit('creation', 'piece_jointe', Number(r.lastInsertRowid), `Pièce jointe « ${basename(file)} » ajoutée (${ownerType} n° ${ownerId})`)
      added++
    }
    return { added }
  },

  /** Déchiffre la pièce dans un dossier temporaire (vidé au verrouillage) et l'ouvre. */
  async open(id: number) {
    const r = db().prepare('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id) as
      | { owner_type: string; owner_id: number; stored_name: string; original_name: string }
      | undefined
    if (!r) throw new AppError('Pièce jointe introuvable.')
    const src = fileOf(r)
    if (!existsSync(src)) throw new AppError('Le fichier de cette pièce jointe est introuvable sur le disque.')
    const out = join(ensureDir(join(paths.tmp, String(id))), r.original_name)
    writeFileSync(out, decrypt(key(), readFileSync(src)))
    const err = await shell.openPath(out)
    if (err) throw new AppError('Impossible d’ouvrir le fichier : ' + err)
    return true
  },

  remove(id: number) {
    const r = db().prepare('SELECT original_name FROM attachments WHERE id = ? AND deleted_at IS NULL').get(id) as { original_name: string } | undefined
    if (!r) throw new AppError('Pièce jointe introuvable.')
    db().prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?').run(nowLocal(), id)
    audit('corbeille', 'piece_jointe', id, `Pièce jointe « ${r.original_name} » mise à la corbeille`)
    return true
  },

  /** Suppression physique (corbeille vidée). */
  purgeFile(id: number) {
    const r = db().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as { owner_type: string; owner_id: number; stored_name: string } | undefined
    if (r) rmSync(fileOf(r), { force: true })
    db().prepare('DELETE FROM attachments WHERE id = ?').run(id)
  },

  clearTmp() {
    rmSync(paths.tmp, { recursive: true, force: true })
  }
}
