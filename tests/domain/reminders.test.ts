import { describe, expect, it } from 'vitest'
import { planReminders, type ReminderCandidate, type ScenarioStep } from '@shared/domain/reminders'
import { buildVariables, renderTemplate, unknownVariables } from '@shared/domain/templating'

// Scénario standard : J+3 courtois, J+15 ferme, J+30 mise en demeure
const steps = new Map<number | null, ScenarioStep[]>([[null, [{ id: 1, offsetDays: 3 }, { id: 2, offsetDays: 15 }, { id: 3, offsetDays: 30 }]]])
const today = '2026-12-31'
const cand = (o: Partial<ReminderCandidate>): ReminderCandidate => ({
  invoiceId: 1,
  companyId: 10,
  scenarioId: null,
  dueDate: '2026-12-20',
  balance: 1000,
  status: 'envoyee',
  handledStepIds: [],
  ...o
})

describe('scénario de relance', () => {
  it('rien avant J+3', () => {
    expect(planReminders([cand({ dueDate: '2026-12-29' })], steps, today)).toEqual([])
  })
  it('rappel courtois à J+3', () => {
    expect(planReminders([cand({ dueDate: '2026-12-28' })], steps, today)).toEqual([{ companyId: 10, stepId: 1, invoiceIds: [1] }])
  })
  it('relance ferme à J+15 si le rappel a été fait', () => {
    expect(planReminders([cand({ dueDate: '2026-12-16', handledStepIds: [1] })], steps, today)).toEqual([
      { companyId: 10, stepId: 2, invoiceIds: [1] }
    ])
  })
  it('ne renvoie jamais une étape déjà traitée', () => {
    expect(planReminders([cand({ dueDate: '2026-12-16', handledStepIds: [1, 2] })], steps, today)).toEqual([])
  })
  it('une facture découverte à J+40 saute directement à la mise en demeure', () => {
    expect(planReminders([cand({ dueDate: '2026-11-21' })], steps, today)).toEqual([{ companyId: 10, stepId: 3, invoiceIds: [1] }])
  })
  it('regroupe les factures d’une même entreprise à la même étape', () => {
    const res = planReminders(
      [
        cand({ invoiceId: 1, dueDate: '2026-12-25' }),
        cand({ invoiceId: 2, dueDate: '2026-12-20' }),
        cand({ invoiceId: 3, companyId: 11, dueDate: '2026-12-20' })
      ],
      steps,
      today
    )
    expect(res).toEqual([
      { companyId: 10, stepId: 1, invoiceIds: [1, 2] },
      { companyId: 11, stepId: 1, invoiceIds: [3] }
    ])
  })
  it('exclut soldées, brouillons, rejets, contentieux et promesses en cours', () => {
    const late = '2026-11-01'
    expect(
      planReminders(
        [
          cand({ dueDate: late, balance: 0 }),
          cand({ dueDate: late, status: 'brouillon' }),
          cand({ dueDate: late, status: 'rejetee' }),
          cand({ dueDate: late, status: 'contentieux' }),
          cand({ dueDate: late, hasPendingPromise: true })
        ],
        steps,
        today
      )
    ).toEqual([])
  })
  it('utilise le scénario propre à l’entreprise s’il existe', () => {
    const custom = new Map(steps)
    custom.set(5, [{ id: 50, offsetDays: 1 }])
    expect(planReminders([cand({ scenarioId: 5, dueDate: '2026-12-30' })], custom, today)).toEqual([
      { companyId: 10, stepId: 50, invoiceIds: [1] }
    ])
  })
})

describe('modèles de relance', () => {
  const vars = buildVariables({
    companyName: 'Kouilou Energy',
    contactName: 'M. Mabiala',
    invoices: [
      { number: 'F-001', issueDate: '2026-10-01', dueDate: '2026-11-30', balance: 1_250_000, currency: 'XAF', daysLate: 31, penalty: 0 },
      { number: 'F-002', issueDate: '2026-10-05', dueDate: '2026-12-04', balance: 500_000, currency: 'XAF', daysLate: 27, penalty: 0 }
    ],
    hospital: { name: 'Hôpital Test' },
    signatory: { name: 'Grace', title: 'Chargée de recouvrement' },
    today: '2026-12-31'
  })

  it('remplace toutes les variables', () => {
    const out = renderTemplate('{contact}, {entreprise} doit {montant} ({nb_factures} factures : {n_facture}), retard {jours_retard} j, échéance {echeance}.', vars)
    expect(out).toBe('M. Mabiala, Kouilou Energy doit 1 750 000 FCFA (2 factures : F-001, F-002), retard 31 j, échéance 30/11/2026.')
  })
  it('liste les factures ligne par ligne', () => {
    expect(vars.liste_factures.split('\n')).toHaveLength(2)
    expect(vars.liste_factures).toContain('F-001 du 01/10/2026')
  })
  it('laisse intactes et signale les variables inconnues', () => {
    expect(renderTemplate('{inconnue} {entreprise}', vars)).toBe('{inconnue} Kouilou Energy')
    expect(unknownVariables('{inconnue} {entreprise}', Object.keys(vars))).toEqual(['inconnue'])
  })
  it('« Madame, Monsieur » si aucun contact', () => {
    expect(buildVariables({ ...{ companyName: 'X', invoices: [], hospital: { name: 'H' }, signatory: { name: 'a', title: 'b' }, today } }).contact).toBe(
      'Madame, Monsieur'
    )
  })
})
