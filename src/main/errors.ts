import { ZodError } from 'zod'

/** Erreur « métier » dont le message (en français) peut être montré tel quel à l'utilisatrice. */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

/** Transforme n'importe quelle erreur en message lisible. */
export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.message
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return first ? first.message : 'Données invalides'
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (/UNIQUE constraint failed: invoices\.number/i.test(msg)) return 'Ce numéro de facture existe déjà (vérifiez aussi la corbeille).'
  if (/UNIQUE constraint failed/i.test(msg)) return 'Cet élément existe déjà.'
  if (/FOREIGN KEY constraint failed/i.test(msg)) return 'Cet élément est lié à d’autres données et ne peut pas être modifié ainsi.'
  if (/SQLITE_BUSY|database is locked/i.test(msg)) return 'La base de données est occupée, réessayez dans un instant.'
  return 'Une erreur inattendue est survenue : ' + msg
}
