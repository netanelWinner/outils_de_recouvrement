// Envoi d'e-mails (SMTP), brouillons .eml et liens WhatsApp (wa.me, gratuit, sans API).
import { shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { AppError } from '../errors'
import { paths, ensureDir } from '../paths'
import { getSettings } from './settings'

export interface MailAttachment {
  filename: string
  content: Buffer
}

function sender() {
  const s = getSettings().smtp
  if (!s.from_email) throw new AppError('Configurez d’abord votre adresse d’expéditeur dans Paramètres → E-mail.')
  return s.from_name ? `"${s.from_name.replace(/"/g, '')}" <${s.from_email}>` : s.from_email
}

function transport() {
  const s = getSettings().smtp
  if (!s.host) throw new AppError('Le serveur d’envoi (SMTP) n’est pas configuré : Paramètres → E-mail. Vous pouvez utiliser « Préparer un brouillon » en attendant.')
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000
  })
}

function explainSmtpError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (/EAUTH|Invalid login|authentication/i.test(msg))
    throw new AppError('Connexion refusée par le serveur e-mail : identifiant ou mot de passe incorrect. Pour Gmail ou Outlook, utilisez un « mot de passe d’application ».')
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) throw new AppError('Serveur e-mail introuvable : vérifiez la connexion internet et l’adresse du serveur SMTP.')
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|timeout/i.test(msg))
    throw new AppError('Le serveur e-mail ne répond pas : vérifiez la connexion internet, le port (587 ou 465) et l’option « connexion sécurisée ».')
  throw new AppError('Échec de l’envoi de l’e-mail : ' + msg)
}

export const messaging = {
  async testSmtp(to?: string) {
    const t = transport()
    try {
      await t.verify()
      if (to) {
        await t.sendMail({
          from: sender(),
          to,
          subject: 'Test – application Recouvrement',
          text: 'Ceci est un message de test : la configuration e-mail fonctionne.'
        })
      }
    } catch (e) {
      explainSmtpError(e)
    }
    return true
  },

  async send(p: { to: string; subject: string; text: string; attachments?: MailAttachment[] }) {
    const t = transport()
    try {
      const info = await t.sendMail({ from: sender(), to: p.to, subject: p.subject, text: p.text, attachments: p.attachments })
      return info.messageId as string
    } catch (e) {
      explainSmtpError(e)
    }
  },

  /** Crée un brouillon .eml (s'ouvre comme un nouveau message dans Outlook / Thunderbird). */
  async draft(p: { to: string | null; subject: string; text: string; attachments?: MailAttachment[]; fileName: string }) {
    const s = getSettings().smtp
    const mail = new MailComposer({
      from: s.from_email ? sender() : undefined,
      to: p.to ?? undefined,
      subject: p.subject,
      text: p.text,
      attachments: p.attachments,
      headers: { 'X-Unsent': '1' }
    })
    const buf: Buffer = await new Promise((resolve, reject) => mail.compile().build((err, msg) => (err ? reject(err) : resolve(msg))))
    const file = join(ensureDir(paths.tmp), p.fileName.replace(/[\\/:*?"<>|]+/g, '-') + '.eml')
    writeFileSync(file, buf)
    if (process.env.RECOUVREMENT_AUTOSAVE_DIR) return file
    const err = await shell.openPath(file)
    if (err) throw new AppError('Aucune messagerie (Outlook, Thunderbird…) n’est installée pour ouvrir le brouillon : ' + err)
    return file
  },

  /** Ouvre WhatsApp (application ou web) avec le message pré-rempli. */
  async whatsapp(phone: string, text: string) {
    const num = normalizePhone(phone)
    if (!num) throw new AppError('Numéro WhatsApp invalide. Format attendu : 06 123 45 67 ou +242 06 123 45 67.')
    await shell.openExternal(`https://wa.me/${num}?text=${encodeURIComponent(text)}`)
    return num
  }
}

/** Normalise un numéro pour wa.me (chiffres uniquement, indicatif international). Congo : +242, 9 chiffres. */
export function normalizePhone(phone: string): string | null {
  let d = phone.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.length === 9) d = '242' + d // numéro congolais local (06…, 05…, 04…)
  d = d.replace(/\D/g, '')
  return d.length >= 8 && d.length <= 15 ? d : null
}
