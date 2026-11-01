// Agenda « Aujourd'hui » : ce qu'il faut faire en priorité.
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Check, FileWarning, Gavel, HandCoins, Inbox, Send, Ticket } from 'lucide-react'
import { api } from '@/lib/api'
import { Alert, Button, Card, Stat, cx } from '@/components/ui'
import { DateText, Money } from '@/components/display'
import { useRun } from '@/components/feedback'
import { REJECTION_REASONS } from '@shared/constants'
import { formatDateLong } from '@shared/dates'
import { TasksList } from './reminders/RemindersPage'
import { ActionDialog } from './invoices/dialogs'
import { VoucherStateBadge } from './vouchers/VoucherForm'
import { useWorkspace } from './workspace'

export function TodayPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const ws = useWorkspace()
  const { run } = useRun()
  const [redeposit, setRedeposit] = useState<number | null>(null)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const summary = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard.summary() })
  const today = useQuery({ queryKey: ['today'], queryFn: () => api.app.today(), refetchInterval: 5 * 60_000 })
  const agenda = useQuery({ queryKey: ['agenda'], queryFn: () => api.agenda.today() })

  // Travaux du jour à l'ouverture (sauvegarde, promesses, relances) puis rafraîchissement complet
  useEffect(() => {
    void api.app.refresh().then(() => qc.invalidateQueries())
  }, [qc])

  const s = summary.data
  const a = agenda.data
  const hour = new Date().getHours()
  const name = settings.data?.signatory.name?.split(' ')[0]
  const nothing = a && !a.promises_broken.length && !a.promises_due.length && !a.rejections_due.length && !a.vouchers_expiring.length && !a.litigation_steps.length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {hour < 18 ? 'Bonjour' : 'Bonsoir'}
          {name ? ` ${name}` : ''} 👋
        </h1>
        <p className="text-sm text-slate-500">{today.data ? formatDateLong(today.data.date) : ''} – voici vos priorités du jour.</p>
      </div>

      {today.data?.backup_error && (
        <Alert tone="danger" title="La sauvegarde automatique a échoué" action={<Button size="sm" onClick={() => navigate('/parametres?onglet=sauvegarde')}>Vérifier</Button>}>
          {today.data.backup_error}
        </Alert>
      )}
      {settings.data && !settings.data.backup.last_at && (
        <Alert tone="warning" title="Aucune sauvegarde n’a encore été faite" action={<Button size="sm" onClick={() => navigate('/parametres?onglet=sauvegarde')}>Configurer</Button>}>
          Choisissez un dossier de sauvegarde (clé USB ou dossier OneDrive / Google Drive) pour ne jamais perdre vos données.
        </Alert>
      )}

      {s && (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Stat label="Total dû (équiv. FCFA)" value={<Money minor={s.outstanding} currency="XAF" />} sub={`${s.open_count} facture(s) en attente`} onClick={() => navigate('/factures?statut=envoyee,acceptee,partiellement_payee,rejetee,contentieux')} />
          <Stat label="En retard" value={<Money minor={s.overdue} currency="XAF" />} sub={`${s.overdue_count} facture(s)`} tone={s.overdue > 0 ? 'danger' : 'default'} onClick={() => navigate('/factures?retard=1')} />
          <Stat label="Encaissé ce mois-ci" value={<Money minor={s.collected_this_month} currency="XAF" />} tone="success" onClick={() => navigate('/paiements')} />
          <Stat label="Taux de recouvrement (12 mois)" value={s.recovery_rate === null ? '—' : `${s.recovery_rate.toLocaleString('fr-FR')} %`} tip="taux_recouvrement" onClick={() => navigate('/tableau-de-bord')} />
        </div>
      )}

      {a && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {a.promises_broken.length > 0 && (
            <AgendaCard tone="danger" icon={<HandCoins className="size-4" />} title={`Promesses non tenues (${a.promises_broken.length})`} onMore={() => navigate('/echanges')}>
              {a.promises_broken.slice(0, 5).map((p) => (
                <Row key={p.id}>
                  <span className="flex-1 truncate">
                    <b>{p.company_name}</b> – <Money minor={p.amount_minor} currency={p.currency} /> promis pour le <DateText iso={p.promised_date} />
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Send className="size-3.5" />}
                    onClick={async () => {
                      const ids = p.invoice_ids ? p.invoice_ids.split(',').map(Number) : await api.invoices.listIds({ company_id: p.company_id, overdue_only: true })
                      ws.compose({ company_id: p.company_id, invoice_ids: ids })
                    }}
                  >
                    Relancer
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Check className="size-3.5" />} title="Retirer l’alerte" onClick={() => void run(() => api.activities.acknowledge(p.id))} />
                </Row>
              ))}
            </AgendaCard>
          )}
          {a.promises_due.length > 0 && (
            <AgendaCard tone="info" icon={<CalendarClock className="size-4" />} title={`Promesses à vérifier aujourd’hui (${a.promises_due.length})`} onMore={() => navigate('/echanges')}>
              {a.promises_due.slice(0, 5).map((p) => (
                <Row key={p.id}>
                  <span className="flex-1 truncate">
                    <b>{p.company_name}</b> – <Money minor={p.amount_minor} currency={p.currency} />
                  </span>
                  <span className="text-xs text-slate-500">
                    reçu : <Money minor={p.paid_since_minor} currency={p.currency} />
                  </span>
                </Row>
              ))}
              <p className="pt-1 text-xs text-slate-500">Enregistrez le paiement s’il est arrivé ; sinon, une alerte apparaîtra demain.</p>
            </AgendaCard>
          )}
          {a.rejections_due.length > 0 && (
            <AgendaCard tone="danger" icon={<FileWarning className="size-4" />} title={`Factures rejetées à redéposer (${a.rejections_due.length})`} onMore={() => navigate('/rejets')}>
              {a.rejections_due.slice(0, 5).map((r) => (
                <Row key={r.id}>
                  <button className="font-medium text-brand-700 hover:underline" onClick={() => ws.openInvoice(r.invoice_id)}>
                    {r.invoice_number}
                  </button>
                  <span className="flex-1 truncate text-slate-600">
                    {r.company_name} · {r.missing_document ? `manque : ${r.missing_document}` : REJECTION_REASONS[r.reason_code]}
                  </span>
                  <Button size="sm" variant="primary" onClick={() => setRedeposit(r.invoice_id)}>
                    Redéposer
                  </Button>
                </Row>
              ))}
            </AgendaCard>
          )}
          {a.vouchers_expiring.length > 0 && (
            <AgendaCard tone="warning" icon={<Ticket className="size-4" />} title={`Bons qui expirent bientôt (${a.vouchers_expiring.length})`} onMore={() => navigate('/bons')}>
              {a.vouchers_expiring.slice(0, 5).map((v) => (
                <Row key={v.id}>
                  <button className="font-medium text-brand-700 hover:underline" onClick={() => ws.openVoucher(v.id)}>
                    {v.number}
                  </button>
                  <span className="flex-1 truncate text-slate-600">
                    {v.company_name} · {v.patient_name || v.patient_matricule}
                  </span>
                  <span className="text-xs">
                    jusqu’au <DateText iso={v.valid_until} />
                  </span>
                  <VoucherStateBadge state={v.state} />
                </Row>
              ))}
              <p className="pt-1 text-xs text-slate-500">Facturez les soins couverts avant la fin de validité, ou demandez une prolongation.</p>
            </AgendaCard>
          )}
          {a.litigation_steps.length > 0 && (
            <AgendaCard tone="purple" icon={<Gavel className="size-4" />} title={`Échéances de contentieux (7 jours)`} onMore={() => navigate('/contentieux')}>
              {a.litigation_steps.map((st) => (
                <Row key={st.id}>
                  <span className="flex-1 truncate">
                    <b>{st.reference}</b> – {st.title}
                  </span>
                  <span className={st.due_date < (today.data?.date ?? '') ? 'font-semibold text-red-700' : ''}>
                    <DateText iso={st.due_date} />
                  </span>
                </Row>
              ))}
            </AgendaCard>
          )}
          {a.prescriptions_count > 0 && (
            <AgendaCard tone="danger" icon={<AlertTriangle className="size-4" />} title={`Créances proches de la prescription (${a.prescriptions_count})`} onMore={() => navigate('/contentieux')}>
              <p className="text-sm text-slate-600">Ces créances anciennes risquent de ne plus pouvoir être réclamées en justice. Faites le point avec le service juridique.</p>
            </AgendaCard>
          )}
          {s && s.drafts > 0 && (
            <AgendaCard tone="info" icon={<Inbox className="size-4" />} title={`${s.drafts} brouillon(s) à déposer`} onMore={() => navigate('/bordereaux')}>
              <p className="text-sm text-slate-600">Regroupez-les dans un bordereau de dépôt : le délai de paiement ne court qu’à partir du dépôt.</p>
            </AgendaCard>
          )}
        </div>
      )}
      {nothing && s?.drafts === 0 && <p className="text-sm text-slate-500">Rien d’urgent en dehors des relances ci-dessous.</p>}

      <Card
        title={
          <>
            <AlertTriangle className="size-4 text-orange-500" /> Relances à envoyer aujourd’hui
          </>
        }
        actions={
          <Button size="sm" variant="ghost" onClick={() => navigate('/relances')}>
            Tout voir
          </Button>
        }
      >
        <TasksList compact />
      </Card>
      {redeposit !== null && <ActionDialog ids={[redeposit]} action="redeposer" onClose={() => setRedeposit(null)} />}
    </div>
  )
}

function AgendaCard({ tone, icon, title, children, onMore }: { tone: 'danger' | 'warning' | 'info' | 'purple'; icon: ReactNode; title: string; children: ReactNode; onMore: () => void }) {
  const tones = { danger: 'text-red-700', warning: 'text-amber-700', info: 'text-sky-700', purple: 'text-purple-700' }
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className={cx('flex items-center gap-2 text-sm font-semibold', tones[tone])}>
          {icon} {title}
        </h2>
        <button className="text-xs text-slate-500 hover:underline" onClick={onMore}>
          Tout voir
        </button>
      </header>
      <div className="space-y-1.5 px-4 py-2.5">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 text-sm">{children}</div>
}
