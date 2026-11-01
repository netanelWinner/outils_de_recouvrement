// Liste blanche des fonctions accessibles depuis l'interface (un seul canal IPC, « espace.méthode »).
// L'interface ne transmet jamais de chemin de fichier : toutes les boîtes de dialogue sont ouvertes ici.
import { app, shell } from 'electron'
import { auth } from './security/auth'
import { settings } from './services/settings'
import { companies } from './services/companies'
import { invoices } from './services/invoices'
import { payments } from './services/payments'
import { reminders } from './services/reminders'
import { dashboard } from './services/dashboard'
import { documents } from './services/documents'
import { search } from './services/search'
import { attachments } from './services/attachments'
import { trash, auditLog } from './services/trash'
import { excel } from './services/excel'
import { backup } from './services/backup'
import { demo } from './services/demo'
import { messaging } from './services/messaging'
import { scheduler } from './scheduler'
import { vouchers } from './services/vouchers'
import { rejections } from './services/rejections'
import { batches } from './services/batches'
import { activities } from './services/activities'
import { bank } from './services/bank'
import { litigation } from './services/litigation'
import { agenda } from './services/agenda'
import { analytics } from './services/analytics'
import { reports } from './services/reports'
import { updates } from './services/updates'

export const api = {
  auth,
  settings,
  companies,
  invoices: {
    list: invoices.list,
    listIds: invoices.listIds,
    get: invoices.get,
    previewDueDate: invoices.previewDueDate,
    numberExists: invoices.numberExists,
    create: invoices.create,
    update: invoices.update,
    applyAction: invoices.applyAction,
    createCreditNote: invoices.createCreditNote,
    remove: invoices.remove,
    openForPayment: invoices.openForPayment
  },
  payments,
  reminders,
  dashboard,
  documents,
  search,
  attachments: { list: attachments.list, add: attachments.add, open: attachments.open, remove: attachments.remove },
  trash,
  audit: auditLog,
  excel,
  backup,
  demo,
  mail: { testSmtp: messaging.testSmtp },
  vouchers,
  rejections,
  batches,
  activities: {
    list: activities.list,
    create: activities.create,
    remove: activities.remove,
    promises: activities.promises,
    acknowledge: activities.acknowledge,
    cancelPromise: activities.cancelPromise
  },
  bank,
  litigation,
  agenda: { today: agenda.today },
  analytics,
  reports: {
    compute: reports.compute,
    generate: reports.generate,
    list: reports.list,
    open: reports.open,
    email: reports.email,
    dir: reports.dir,
    chooseDir: reports.chooseDir
  },
  updates,
  app: {
    version: () => app.getVersion(),
    today: () => scheduler.today(),
    refresh: () => scheduler.tick(),
    openDataFolder: async () => {
      await shell.openPath(app.getPath('userData'))
      return true
    }
  }
}

export type Api = typeof api

/** Fonctions accessibles sans être connecté. */
export const PUBLIC_METHODS = new Set(['auth.status', 'auth.setup', 'auth.unlock', 'auth.recover', 'app.version'])
