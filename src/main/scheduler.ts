// Tâches périodiques : sauvegarde du jour, promesses, génération des relances, notifications de bureau.
import { Notification } from 'electron'
import { isOpen } from './db/connection'
import { onLock, onUnlock } from './security/auth'
import { reminders } from './services/reminders'
import { backup } from './services/backup'
import { trash } from './services/trash'
import { attachments } from './services/attachments'
import { activities } from './services/activities'
import { agenda } from './services/agenda'
import { reports } from './services/reports'
import { formatMoney } from '@shared/money'
import { formatDate, todayISO } from '@shared/dates'

let timer: NodeJS.Timeout | null = null
let lastNotifiedDay = ''
let lastBackupError: string | null = null
let showWindow: () => void = () => {}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => showWindow())
  n.show()
}

export const scheduler = {
  init(show: () => void) {
    showWindow = show
    onUnlock(() => {
      // Après l'ouverture de la base : travaux du jour, puis contrôle toutes les heures.
      setTimeout(() => scheduler.tick(), 1500)
      if (timer) clearInterval(timer)
      timer = setInterval(() => scheduler.tick(), 60 * 60 * 1000)
    })
    onLock(() => {
      if (timer) clearInterval(timer)
      timer = null
      attachments.clearTmp()
    })
  },

  /** Exécute les travaux du jour (idempotent). */
  tick() {
    if (!isOpen()) return { created: 0, pending: 0 }
    const b = backup.autoIfDue()
    lastBackupError = b.error ?? null
    if (b.error) notify('Sauvegarde automatique impossible', b.error)
    try {
      trash.purgeOlderThan(30)
    } catch (e) {
      console.error('purge', e)
    }
    // Promesses : une promesse non tenue fait reprendre les relances et déclenche une alerte immédiate.
    const broken = activities.evaluatePromises()
    for (const p of broken.slice(0, 3)) {
      notify(
        'Promesse de paiement non tenue',
        `${p.company_name} avait promis ${formatMoney(p.amount_minor, p.currency)} pour le ${formatDate(p.promised_date)}.`
      )
    }
    // Début de mois : rapport du mois écoulé pour la direction (une seule fois)
    void reports.autoIfDue().then((r) => {
      if (r.generated) notify('Rapport mensuel prêt', `Le rapport de ${r.generated} est disponible${r.emailed ? ' et a été envoyé à la direction' : ''} (menu Rapports mensuels).`)
      if (r.error) notify('Rapport mensuel', r.error)
    })
    const { created } = reminders.generate()
    const pending = reminders.pendingCount()
    const day = todayISO()
    if (lastNotifiedDay !== day) {
      const lines = agenda.summaryLines()
      if (lines.length) {
        lastNotifiedDay = day
        notify('Votre journée de recouvrement', lines.join(' · '))
      }
    }
    return { created, pending }
  },

  today() {
    return { date: todayISO(), backup_error: lastBackupError }
  }
}
