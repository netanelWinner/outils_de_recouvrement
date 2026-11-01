// Agenda « Aujourd'hui » : tout ce qui demande une action, rassemblé en un seul endroit.
import { activities } from './activities'
import { vouchers } from './vouchers'
import { rejections } from './rejections'
import { litigation } from './litigation'
import { reminders } from './reminders'

export const agenda = {
  today() {
    const prescriptions = litigation.prescriptions()
    return {
      reminders_pending: reminders.pendingCount(),
      promises_due: activities.promisesDueToday(),
      promises_broken: activities.promises({ status: 'alertes' }),
      vouchers_expiring: vouchers.expiring(),
      rejections_due: rejections.dueForRedeposit(),
      litigation_steps: litigation.upcomingSteps(7),
      prescriptions_count: prescriptions.length,
      prescriptions: prescriptions.slice(0, 8)
    }
  },

  /** Résumé en une phrase pour la notification de bureau (vide s'il n'y a rien). */
  summaryLines(): string[] {
    const a = agenda.today()
    const lines: string[] = []
    if (a.reminders_pending) lines.push(`${a.reminders_pending} relance(s) à envoyer`)
    if (a.promises_broken.length) lines.push(`${a.promises_broken.length} promesse(s) non tenue(s)`)
    if (a.promises_due.length) lines.push(`${a.promises_due.length} promesse(s) à vérifier`)
    if (a.rejections_due.length) lines.push(`${a.rejections_due.length} facture(s) rejetée(s) à redéposer`)
    if (a.vouchers_expiring.length) lines.push(`${a.vouchers_expiring.length} bon(s) expirant bientôt`)
    if (a.litigation_steps.length) lines.push(`${a.litigation_steps.length} échéance(s) de contentieux`)
    if (a.prescriptions_count) lines.push(`${a.prescriptions_count} créance(s) proche(s) de la prescription`)
    return lines
  }
}
