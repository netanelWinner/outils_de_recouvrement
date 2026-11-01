// Rapprochement bancaire : importer le relevé, puis rattacher chaque encaissement aux factures (suggestions automatiques).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, EyeOff, Landmark, Link2, Sparkles, Trash2, Undo2, Upload } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, EmptyState, Field, HelpTip, Input, Modal, PageHeader, SearchSelect, Select, Spinner, cx } from '@/components/ui'
import { CurrencySelect, DateText, Money } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { BANK_LINE_STATUS, type BankLineStatus, type Currency } from '@shared/constants'
import { BANK_FIELDS, type BankFieldKey } from '@shared/domain/matching'
import { useWorkspace } from '../workspace'

type Line = Awaited<ReturnType<typeof api.bank.lines>>[number]

export function BankPage() {
  const [status, setStatus] = useState<BankLineStatus | null>('non_rapproche')
  const [importing, setImporting] = useState(false)
  const [line, setLine] = useState<Line | null>(null)
  const { run } = useRun()
  const { confirm } = useFeedback()
  const ws = useWorkspace()
  const lines = useQuery({ queryKey: ['bank', 'lines', status], queryFn: () => api.bank.lines({ status }) })
  const statements = useQuery({ queryKey: ['bank', 'statements'], queryFn: () => api.bank.statements() })

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Rapprochement bancaire <HelpTip k="rapprochement" />
          </span>
        }
        subtitle="Importez le relevé de la banque : l’application propose, pour chaque virement reçu, les factures correspondantes."
        actions={
          <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
            Importer un relevé (Excel / CSV)
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_280px]">
        <Card padded={false}>
          <div className="flex gap-2 border-b border-slate-100 p-3">
            {([['non_rapproche', 'À rapprocher'], ['rapproche', 'Rapprochés'], ['ignore', 'Ignorés'], [null, 'Tous']] as [BankLineStatus | null, string][]).map(([k, label]) => (
              <Button key={label} size="sm" variant={status === k ? 'primary' : 'secondary'} onClick={() => setStatus(k)}>
                {label}
              </Button>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th>Libellé</th>
                <th>Référence</th>
                <th className="text-right">Montant</th>
                <th className="px-3">Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.data?.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DateText iso={l.op_date} />
                  </td>
                  <td className="w-full max-w-0">
                    <div className="truncate" title={l.label}>
                      {l.label}
                    </div>
                    {l.payment_company && <div className="text-xs text-emerald-700">→ {l.payment_company}</div>}
                  </td>
                  <td className="px-3 whitespace-nowrap text-slate-500">{l.reference}</td>
                  <td className="text-right whitespace-nowrap">
                    <Money minor={l.amount_minor} currency={l.currency} strong />
                  </td>
                  <td className="px-3">
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', BANK_LINE_STATUS[l.status].color)}>{BANK_LINE_STATUS[l.status].label}</span>
                  </td>
                  <td className="px-2 text-right whitespace-nowrap">
                    {l.status === 'non_rapproche' && (
                      <>
                        <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => setLine(l)}>
                          Rapprocher
                        </Button>{' '}
                        <Button size="sm" variant="ghost" icon={<EyeOff className="size-3.5" />} title="Pas un paiement client (ignorer)" onClick={() => void run(() => api.bank.setStatus(l.id, 'ignore'), 'Ligne ignorée.')} />
                      </>
                    )}
                    {l.status === 'rapproche' && l.payment_id && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => ws.editPayment(l.payment_id!)}>
                          Voir le paiement
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="size-3.5" />}
                          title="Annuler le rapprochement (le paiement est conservé)"
                          onClick={() => void run(() => api.bank.setStatus(l.id, 'non_rapproche'), 'Rapprochement annulé. Le paiement est conservé : supprimez-le si besoin.')}
                        />
                      </>
                    )}
                    {l.status === 'ignore' && (
                      <Button size="sm" variant="ghost" onClick={() => void run(() => api.bank.setStatus(l.id, 'non_rapproche'), 'Ligne remise à rapprocher.')}>
                        Rétablir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lines.data?.length === 0 && (
            <EmptyState
              icon={<Landmark className="size-10" />}
              title={status === 'non_rapproche' ? 'Tout est rapproché' : 'Aucune ligne'}
              text="Téléchargez le relevé depuis la banque en ligne (format Excel ou CSV), puis importez-le ici."
            />
          )}
        </Card>
        <Card title="Relevés importés">
          <ul className="space-y-2 text-sm">
            {statements.data?.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 rounded-md border border-slate-100 p-2">
                <div>
                  <div className="font-medium">{s.file_name}</div>
                  <div className="text-xs text-slate-500">
                    {s.imported_at.slice(0, 10).split('-').reverse().join('/')} · {s.lines} ligne(s), {s.pending} à rapprocher
                  </div>
                </div>
                <button
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Supprimer ce relevé"
                  onClick={() =>
                    void confirm({ title: 'Supprimer ce relevé ?', message: 'Ses lignes non rapprochées seront supprimées.', danger: true }).then((ok) => ok && run(() => api.bank.removeStatement(s.id), 'Relevé supprimé.'))
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
            {statements.data?.length === 0 && <li className="text-slate-500">Aucun relevé importé.</li>}
          </ul>
        </Card>
      </div>
      {importing && <BankImportDialog onClose={() => setImporting(false)} />}
      {line && <ReconcileDialog line={line} onClose={() => setLine(null)} />}
    </>
  )
}

function BankImportDialog({ onClose }: { onClose: () => void }) {
  type Preview = NonNullable<Awaited<ReturnType<typeof api.bank.importPreview>>>
  const [prev, setPrev] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<Partial<Record<BankFieldKey, number | null>>>({})
  const [currency, setCurrency] = useState<Currency>('XAF')
  const [bankName, setBankName] = useState('')
  const { run, busy } = useRun()
  const choose = async () => {
    const p = await run(() => api.bank.importPreview())
    if (p) {
      setPrev(p)
      setMapping(p.mapping)
    }
  }
  const go = async () => {
    const r = await run(
      () => api.bank.importRun({ token: prev!.token, mapping, currency, bank_name: bankName || null }),
      (res) =>
        `${res.added} encaissement(s) importé(s).${res.duplicates ? ` ${res.duplicates} déjà présent(s), ignoré(s).` : ''}${res.skipped ? ` ${res.skipped} débit(s) ignoré(s).` : ''}${
          res.errors.length ? `\n${res.errors.length} ligne(s) illisible(s).` : ''
        }`
    )
    if (r) onClose()
  }
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Importer un relevé bancaire"
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {prev && (
            <Button variant="primary" loading={busy} onClick={() => void go()}>
              Importer
            </Button>
          )}
        </>
      }
    >
      {!prev ? (
        <div className="space-y-4 text-sm">
          <p>Téléchargez le relevé depuis la banque en ligne au format Excel (.xlsx) ou CSV. Seuls les <b>encaissements</b> (crédits) sont importés ; un même relevé importé deux fois ne crée pas de doublon.</p>
          <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={() => void choose()}>
            Choisir le fichier…
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{prev.file_name}</b> – {prev.row_count} ligne(s)
          </p>
          <div className="grid grid-cols-2 gap-3">
            {BANK_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <Select value={mapping[f.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">— Aucune —</option>
                  {prev.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <Field label="Devise du compte">
              <CurrencySelect value={currency} onChange={setCurrency} />
            </Field>
            <Field label="Banque">
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </Field>
          </div>
          <Alert tone="info">Indiquez la colonne « Crédit » si le relevé sépare débits et crédits ; sinon la colonne « Montant » (les montants négatifs sont ignorés).</Alert>
        </div>
      )}
    </Modal>
  )
}

function ReconcileDialog({ line, onClose }: { line: Line; onClose: () => void }) {
  const sugg = useQuery({ queryKey: ['bank', 'suggest', line.id], queryFn: () => api.bank.suggest(line.id) })
  const companies = useQuery({ queryKey: ['companies', 'options'], queryFn: () => api.companies.options() })
  const [company, setCompany] = useState<number | null>(null)
  const manual = useQuery({
    queryKey: ['bank', 'manual', company, line.id],
    queryFn: () => api.payments.suggest({ company_id: company!, currency: line.currency, amount_minor: line.amount_minor }),
    enabled: !!company
  })
  const { run, busy } = useRun()
  const confirmAlloc = async (companyId: number, allocations: { invoice_id: number; amount_minor: number }[]) => {
    const r = await run(() => api.bank.confirm(line.id, { company_id: companyId, allocations }), 'Paiement enregistré et rapproché.')
    if (r) onClose()
  }
  return (
    <Modal open size="lg" onClose={onClose} title="Rapprocher un encaissement">
      <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>
            <DateText iso={line.op_date} /> · {line.label}
          </span>
          <Money minor={line.amount_minor} currency={line.currency} strong />
        </div>
        {line.reference && <div className="text-xs text-slate-500">Réf. {line.reference}</div>}
      </div>
      <h3 className="mb-2 text-sm font-semibold text-brand-800">Correspondances proposées</h3>
      {!sugg.data ? (
        <Spinner />
      ) : sugg.data.length === 0 ? (
        <Alert tone="info">Aucune correspondance évidente. Choisissez l’entreprise ci-dessous.</Alert>
      ) : (
        <ul className="space-y-2">
          {sugg.data.map((s, k) => (
            <li key={k} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <span className={cx('mt-0.5 rounded px-1.5 text-xs font-bold', s.score >= 80 ? 'bg-emerald-100 text-emerald-800' : s.score >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>{s.score} %</span>
              <div className="flex-1 text-sm">
                <div className="font-medium">{s.company_name}</div>
                <div className="text-xs text-slate-500">{s.reason}</div>
                {s.allocations.length > 0 && (
                  <div className="mt-1 text-xs">
                    {s.allocations.map((a) => (
                      <span key={a.invoice_id} className="mr-3">
                        {a.number} : <Money minor={a.amount} currency={line.currency} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {s.kind === 'paiement' ? (
                <Button size="sm" icon={<Link2 className="size-3.5" />} loading={busy} onClick={() => void run(() => api.bank.linkPayment(line.id, s.payment_id!), 'Ligne associée au paiement existant.').then((r) => r && onClose())}>
                  Associer
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<CheckCircle2 className="size-3.5" />}
                  loading={busy}
                  onClick={() => void confirmAlloc(s.company_id, s.allocations.map((a) => ({ invoice_id: a.invoice_id, amount_minor: a.amount })))}
                >
                  Valider
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-5 mb-2 text-sm font-semibold text-brand-800">Ou choisir l’entreprise</h3>
      <SearchSelect options={companies.data ?? []} value={company} onChange={(v) => setCompany(v)} placeholder="Entreprise qui a payé…" />
      {manual.data && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
          {manual.data.allocations.length === 0 ? (
            <p className="text-slate-500">Aucune facture en attente en {line.currency} : le paiement sera enregistré comme non imputé.</p>
          ) : (
            <p className="mb-2 text-slate-600">Imputation proposée (plus anciennes d’abord) :</p>
          )}
          {manual.data.allocations.map((a) => (
            <div key={a.invoice_id} className="flex justify-between text-xs">
              <span>{manual.data!.open.find((o) => o.id === a.invoice_id)?.number}</span>
              <Money minor={a.amount_minor} currency={line.currency} />
            </div>
          ))}
          {manual.data.remaining > 0 && (
            <div className="mt-1 text-xs text-amber-700">
              Non imputé : <Money minor={manual.data.remaining} currency={line.currency} />
            </div>
          )}
          <div className="mt-3 text-right">
            <Button variant="primary" loading={busy} onClick={() => void confirmAlloc(company!, manual.data!.allocations)}>
              Valider ce rapprochement
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
