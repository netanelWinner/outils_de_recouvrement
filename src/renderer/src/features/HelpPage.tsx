// Aide : premiers pas, glossaire, statuts, raccourcis clavier.
import { Card, PageHeader } from '@/components/ui'
import { StatusBadge } from '@/components/display'
import { GLOSSARY } from '@shared/glossary'
import { INVOICE_STATUSES, STATUS_INFO } from '@shared/constants'

const SHORTCUTS = [
  ['Ctrl + K', 'Rechercher (facture, patient, bon, entreprise)'],
  ['Ctrl + N', 'Nouvelle facture'],
  ['Ctrl + Maj + P', 'Enregistrer un paiement reçu'],
  ['Ctrl + L', 'Verrouiller l’application'],
  ['F1', 'Ouvrir cette aide'],
  ['Échap', 'Fermer une fenêtre']
]

const ROUTINE = [
  ['Chaque matin', 'Ouvrez « Aujourd’hui » : envoyez les relances proposées, traitez les rejets et les brouillons.'],
  ['À chaque facture', 'Saisissez-la avec son n° de bon, son PO et la date de dépôt. Vérifiez les pièces exigées par la convention.'],
  ['À chaque paiement', 'Enregistrez-le dans « Paiement reçu » et imputez-le sur les factures réglées.'],
  ['À chaque rejet', 'Ouvrez la facture → « Enregistrer un rejet » avec le motif ; corrigez ; puis « Redéposer ».'],
  ['En fin de mois', 'Tableau de bord → exportez la balance âgée ; générez les relevés de compte des plus gros débiteurs.']
]

export function HelpPage() {
  return (
    <>
      <PageHeader title="Aide" subtitle="Les bons réflexes et le vocabulaire du recouvrement." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Votre routine">
          <ul className="space-y-3 text-sm">
            {ROUTINE.map(([t, d]) => (
              <li key={t}>
                <b className="text-brand-800">{t}</b> – {d}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Raccourcis clavier">
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-4">
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-xs">{k}</kbd>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Les statuts d’une facture">
          <ul className="space-y-2.5 text-sm">
            {INVOICE_STATUSES.map((s) => (
              <li key={s} className="flex items-start gap-3">
                <span className="w-40 shrink-0">
                  <StatusBadge status={s} />
                </span>
                <span className="text-slate-600">{STATUS_INFO[s].help}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Glossaire">
          <dl className="space-y-3 text-sm">
            {Object.values(GLOSSARY).map((g) => (
              <div key={g.term}>
                <dt className="font-semibold text-slate-900">{g.term}</dt>
                <dd className="text-slate-600">{g.def}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  )
}
