// Relances : à envoyer aujourd'hui, historique, modèles personnalisables, scénario automatique.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, CheckCircle2, Download, Eye, Mail, Plus, Send, Trash2, X } from 'lucide-react'
import { api, type TaskRow, type TemplateRow } from '@/lib/api'
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, HelpTip, Input, Modal, PageHeader, Pagination, Select, Spinner, Tabs, Textarea } from '@/components/ui'
import { ChannelIcon, LateBadge, MoneyByCurrency, ToneBadge } from '@/components/display'
import { useFeedback, useRun } from '@/components/feedback'
import { CHANNELS, DELIVERY_LABELS, TEMPLATE_VARIABLES, TONES, type Channel, type Tone } from '@shared/constants'
import { addDays, todayISO } from '@shared/dates'
import { buildVariables, renderTemplate, unknownVariables } from '@shared/domain/templating'
import { useWorkspace } from '../workspace'

type Tab = 'a_envoyer' | 'historique' | 'modeles' | 'scenario'

export function RemindersPage() {
  const [tab, setTab] = useState<Tab>('a_envoyer')
  const pending = useQuery({ queryKey: ['reminders', 'pendingCount'], queryFn: () => api.reminders.pendingCount() })
  const { run } = useRun()
  return (
    <>
      <PageHeader
        title="Relances"
        subtitle="Chaque matin, l’application prépare les relances à envoyer selon votre scénario. Vous les vérifiez et les validez en un clic."
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => void run(() => api.excel.export('relances'), (p) => (p ? 'Export Excel créé.' : null))}>
            Exporter l’historique
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'a_envoyer', label: 'À envoyer', count: pending.data },
          { key: 'historique', label: 'Historique' },
          { key: 'modeles', label: 'Modèles de messages' },
          { key: 'scenario', label: 'Scénario automatique' }
        ]}
      />
      {tab === 'a_envoyer' && <TasksList />}
      {tab === 'historique' && <ReminderHistory />}
      {tab === 'modeles' && <TemplatesTab />}
      {tab === 'scenario' && <ScenarioTab />}
    </>
  )
}

// ---------------------------------------------------------------- À envoyer

export function TasksList({ compact }: { compact?: boolean }) {
  const ws = useWorkspace()
  const { run, busy } = useRun()
  const { confirm, toast } = useFeedback()
  const tasks = useQuery({ queryKey: ['reminders', 'tasks'], queryFn: () => api.reminders.tasks() })
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const [postpone, setPostpone] = useState<TaskRow | null>(null)

  if (!tasks.data) return <Spinner />
  const list = tasks.data.filter((t) => t.invoices.length > 0)
  const emailTasks = list.filter((t) => t.channel === 'email' && t.has_recipient)

  const sendAll = async () => {
    if (
      !(await confirm({
        title: `Envoyer ${emailTasks.length} relance(s) par e-mail ?`,
        message: 'Chaque entreprise recevra le message prévu par le scénario, avec la liste de ses factures en retard. Pour vérifier un message avant envoi, utilisez plutôt « Préparer ».',
        confirmLabel: 'Tout envoyer'
      }))
    )
      return
    const res = await run(() => api.reminders.sendAllEmails(emailTasks.map((t) => t.id)))
    if (res) {
      const ok = res.filter((r) => r.ok).length
      const ko = res.filter((r) => !r.ok)
      toast({ tone: ko.length ? 'error' : 'success', message: `${ok} e-mail(s) envoyé(s).${ko.length ? `\nÉchecs : ${ko.map((k) => `${k.company} (${k.message})`).join(' ; ')}` : ''}` })
    }
  }

  if (list.length === 0)
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 className="size-10 text-emerald-400" />} title="Aucune relance à envoyer aujourd’hui" text="Bravo ! Les prochaines relances apparaîtront ici automatiquement selon le scénario." />
      </Card>
    )

  return (
    <div className="space-y-3">
      {!compact && emailTasks.length > 1 && settings.data?.smtp_configured && (
        <div className="flex justify-end">
          <Button variant="primary" icon={<Mail className="size-4" />} loading={busy} onClick={() => void sendAll()}>
            Envoyer toutes les relances e-mail ({emailTasks.length})
          </Button>
        </div>
      )}
      {list.map((t) => {
        const maxLate = Math.max(...t.invoices.map((i) => i.days_late))
        const totals = new Map<string, number>()
        t.invoices.forEach((i) => totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.balance_minor))
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <ChannelIcon channel={t.channel} className="size-5" />
            <div className="min-w-60 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{t.company_name}</span>
                <ToneBadge tone={t.tone} />
                <span className="text-xs text-slate-500">
                  {t.step_label} (J+{t.offset_days}) · {CHANNELS[t.channel]}
                </span>
                {t.status === 'reportee' && <Badge className="bg-slate-100 text-slate-600 ring-slate-300">Reportée</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
                <span>
                  {t.invoices.length} facture(s) · <b className="text-slate-900"><MoneyByCurrency items={[...totals].map(([currency, amount]) => ({ currency: currency as never, amount }))} /></b>
                </span>
                <span className="flex items-center gap-1">
                  retard max <LateBadge days={maxLate} />
                </span>
                <span className="text-xs">
                  {t.contact ? `→ ${t.contact.full_name}` : ''}
                  {!t.has_recipient && <span className="ml-1 text-amber-700">(aucun {t.channel === 'email' ? 'e-mail' : 'numéro'} connu)</span>}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" icon={<Send className="size-4" />} onClick={() => ws.compose({ company_id: t.company_id, invoice_ids: t.invoices.map((i) => i.id), task_id: t.id, channel: t.channel, template_id: t.template_id })}>
                Préparer
              </Button>
              <Button icon={<CalendarClock className="size-4" />} onClick={() => setPostpone(t)} title="Reporter (ex. promesse de paiement)">
                Reporter
              </Button>
              <Button variant="ghost" icon={<X className="size-4" />} title="Ne pas envoyer cette relance" onClick={() => void run(() => api.reminders.ignore(t.id), 'Relance ignorée.')}>
                Ignorer
              </Button>
            </div>
          </div>
        )
      })}
      {postpone && <PostponeDialog task={postpone} onClose={() => setPostpone(null)} />}
    </div>
  )
}

function PostponeDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const [date, setDate] = useState(addDays(todayISO(), 7))
  const { run, busy } = useRun()
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Reporter la relance – ${task.company_name}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void run(() => api.reminders.postpone(task.id, date), 'Relance reportée.').then((r) => r && onClose())}>
            Reporter
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Utile si l’entreprise a promis de payer à une date précise : la relance réapparaîtra ce jour-là si rien n’a été payé.</p>
      <Field label="Nouvelle date">
        <Input type="date" value={date} min={addDays(todayISO(), 1)} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Modal>
  )
}

// ---------------------------------------------------------------- Historique

export function ReminderHistory({ companyId }: { companyId?: number }) {
  const [channel, setChannel] = useState<Channel | null>(null)
  const [page, setPage] = useState(1)
  const [view, setView] = useState<number | null>(null)
  const list = useQuery({ queryKey: ['reminders', 'history', companyId, channel, page], queryFn: () => api.reminders.history({ company_id: companyId, channel, page }) })
  const detail = useQuery({ queryKey: ['reminder', view], queryFn: () => api.reminders.getReminder(view!), enabled: view !== null })
  return (
    <Card padded={false}>
      <div className="flex gap-3 border-b border-slate-100 p-3">
        <Select className="w-44" value={channel ?? ''} onChange={(e) => setChannel((e.target.value as Channel) || null)}>
          <option value="">Tous les canaux</option>
          {Object.entries(CHANNELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            {!companyId && <th>Entreprise</th>}
            <th>Canal</th>
            <th>Type</th>
            <th>Destinataire</th>
            <th>Factures</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="tabular px-3 py-2 whitespace-nowrap">{r.sent_at.slice(0, 16).replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1')}</td>
              {!companyId && <td className="max-w-52 truncate">{r.company_name}</td>}
              <td>
                <span className="flex items-center gap-1.5">
                  <ChannelIcon channel={r.channel} /> {DELIVERY_LABELS[r.delivery]}
                </span>
              </td>
              <td>
                <ToneBadge tone={r.tone} />
              </td>
              <td className="max-w-48 truncate text-slate-600">{r.contact_name ?? r.recipient}</td>
              <td className="max-w-60 truncate text-xs text-slate-600">{r.invoice_numbers}</td>
              <td className="px-2">
                <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setView(r.id)}>
                  Voir
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.rows.length === 0 && <EmptyState title="Aucune relance envoyée" />}
      {list.data && list.data.total > list.data.page_size && (
        <div className="border-t border-slate-200 p-3">
          <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
        </div>
      )}
      {view !== null && (
        <Modal open onClose={() => setView(null)} title="Contenu de la relance">
          {detail.data ? (
            <div className="space-y-2 text-sm">
              <div className="text-slate-500">
                {detail.data.company_name} · {DELIVERY_LABELS[detail.data.delivery]} · {detail.data.recipient ?? ''}
              </div>
              {detail.data.subject && <div className="font-semibold">Objet : {detail.data.subject}</div>}
              <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm">{detail.data.body}</pre>
            </div>
          ) : (
            <Spinner />
          )}
        </Modal>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- Modèles

function TemplatesTab() {
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.reminders.templates() })
  const [edit, setEdit] = useState<TemplateRow | 'new' | null>(null)
  const { run } = useRun()
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
          Nouveau modèle
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {list.data?.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <ChannelIcon channel={t.channel} />
                <span className="font-semibold text-slate-900">{t.name}</span>
              </div>
              <ToneBadge tone={t.tone} />
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs text-slate-500">{t.body}</p>
            <div className="mt-3 flex items-center gap-2">
              {t.requires_legal_review ? (
                t.legal_validated ? (
                  <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">Validé par le juridique</Badge>
                ) : (
                  <Badge className="bg-amber-50 text-amber-800 ring-amber-200">À faire valider par le service juridique</Badge>
                )
              ) : null}
              {t.used_in_steps > 0 && <Badge>Utilisé par le scénario</Badge>}
              <div className="ml-auto flex gap-1">
                <Button size="sm" onClick={() => setEdit(t)}>
                  Modifier
                </Button>
                {t.used_in_steps === 0 && (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => api.reminders.removeTemplate(t.id), 'Modèle mis à la corbeille.', () => api.trash.restore('template', t.id))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {edit && <TemplateEditor template={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

const SAMPLE = buildVariables({
  companyName: 'Exemple Pétrole SA',
  contactName: 'M. Jean Exemple',
  invoices: [
    { number: 'FAC-2026-0101', issueDate: '2026-09-01', dueDate: '2026-10-31', balance: 1_250_000, currency: 'XAF', daysLate: 21, penalty: 7_200 },
    { number: 'FAC-2026-0117', issueDate: '2026-09-08', dueDate: '2026-11-07', balance: 480_000, currency: 'XAF', daysLate: 14, penalty: 0 }
  ],
  hospital: { name: 'Votre hôpital', phone: '+242 …', email: 'recouvrement@…' },
  signatory: { name: 'Votre nom', title: 'Chargée de recouvrement' },
  today: todayISO()
})

function TemplateEditor({ template, onClose }: { template: TemplateRow | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: template?.name ?? '',
    channel: (template?.channel ?? 'email') as Channel,
    tone: (template?.tone ?? 'courtois') as Tone,
    subject: template?.subject ?? '',
    body: template?.body ?? '',
    requires_legal_review: !!template?.requires_legal_review,
    legal_validated: !!template?.legal_validated
  })
  const [preview, setPreview] = useState(false)
  const { run, busy } = useRun()
  const unknown = unknownVariables(f.subject + ' ' + f.body, Object.keys(SAMPLE))
  const isLegal = f.tone === 'mise_en_demeure' || f.requires_legal_review
  const insert = (v: string) => {
    const el = document.getElementById('tpl-body') as HTMLTextAreaElement | null
    const pos = el?.selectionStart ?? f.body.length
    setF({ ...f, body: f.body.slice(0, pos) + `{${v}}` + f.body.slice(pos) })
  }
  useEffect(() => {
    if (f.tone === 'mise_en_demeure' && !f.requires_legal_review) setF((x) => ({ ...x, requires_legal_review: true }))
  }, [f.tone, f.requires_legal_review])

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={template ? `Modèle : ${template.name}` : 'Nouveau modèle'}
      footer={
        <>
          <Button onClick={() => setPreview(!preview)} icon={<Eye className="size-4" />} className="mr-auto">
            {preview ? 'Revenir à l’édition' : 'Aperçu avec un exemple'}
          </Button>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void run(() => api.reminders.saveTemplate(template?.id ?? null, f), 'Modèle enregistré.').then((r) => r && onClose())}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_260px] gap-5">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Nom du modèle" required>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Canal">
              <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Channel })}>
                {Object.entries(CHANNELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ton">
              <Select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value as Tone })}>
                {Object.entries(TONES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {f.channel !== 'whatsapp' && (
            <Field label={f.channel === 'email' ? 'Objet de l’e-mail' : 'Objet de la lettre'}>
              <Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </Field>
          )}
          {preview ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              {f.subject && <p className="mb-2 font-semibold">Objet : {renderTemplate(f.subject, SAMPLE)}</p>}
              <pre className="whitespace-pre-wrap font-sans">{renderTemplate(f.body, SAMPLE)}</pre>
            </div>
          ) : (
            <Field label="Texte" required>
              <Textarea id="tpl-body" rows={16} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            </Field>
          )}
          {unknown.length > 0 && <Alert tone="warning">Variables inconnues (ne seront pas remplacées) : {unknown.map((u) => `{${u}}`).join(', ')}</Alert>}
          {isLegal && (
            <Alert tone="warning" title="Modèle juridique (OHADA)">
              <p>Ce texte engage l’hôpital : il doit être relu et validé par le service juridique avant utilisation.</p>
              <div className="mt-2">
                <Checkbox
                  checked={f.legal_validated}
                  onChange={(v) => setF({ ...f, legal_validated: v })}
                  label="Ce modèle a été validé par le service juridique de l’hôpital"
                  help="Tant que cette case n’est pas cochée, les lettres porteront la mention « PROJET »."
                />
              </div>
            </Alert>
          )}
        </div>
        <aside>
          <h4 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
            Variables <HelpTip text="Cliquez pour insérer à l’endroit du curseur. Elles sont remplacées automatiquement au moment de la relance." />
          </h4>
          <div className="space-y-1">
            {TEMPLATE_VARIABLES.map((v) => (
              <button key={v.key} onClick={() => insert(v.key)} className="block w-full rounded-md border border-slate-200 px-2 py-1 text-left text-xs hover:border-brand-600 hover:bg-brand-50">
                <code className="font-semibold text-brand-800">{`{${v.key}}`}</code>
                <span className="block text-slate-500">{v.help}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- Scénario

function ScenarioTab() {
  const sc = useQuery({ queryKey: ['scenario'], queryFn: () => api.reminders.scenario() })
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.reminders.templates() })
  const [steps, setSteps] = useState<{ id: number | null; offset_days: number; channel: Channel; template_id: number; label: string }[]>([])
  const { run, busy } = useRun()
  useEffect(() => {
    if (sc.data) setSteps(sc.data.steps.map((s) => ({ id: s.id, offset_days: s.offset_days, channel: s.channel, template_id: s.template_id, label: s.label })))
  }, [sc.data])
  if (!sc.data || !templates.data) return <Spinner />
  const tpl = templates.data
  const update = (i: number, patch: Partial<(typeof steps)[number]>) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)))

  return (
    <Card
      title={
        <>
          Scénario de relance automatique <HelpTip k="scenario" />
        </>
      }
      actions={
        <Button variant="primary" loading={busy} onClick={() => void run(() => api.reminders.saveScenario({ id: sc.data!.id, name: sc.data!.name, steps }), 'Scénario enregistré.')}>
          Enregistrer
        </Button>
      }
    >
      <Alert tone="info">
        Pour chaque facture échue et non payée, l’application propose l’étape correspondant à son retard. Une étape n’est jamais proposée deux fois, et les factures d’une même entreprise sont regroupées dans une seule
        relance. Les factures rejetées, en contentieux ou en brouillon ne sont pas relancées automatiquement.
      </Alert>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-2">Jours après l’échéance</th>
            <th>Nom de l’étape</th>
            <th>Canal</th>
            <th>Modèle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-2 pr-3">
                <div className="flex items-center gap-1">
                  J+
                  <Input type="number" className="w-20" value={s.offset_days} onChange={(e) => update(i, { offset_days: Number(e.target.value) })} />
                </div>
              </td>
              <td className="pr-3">
                <Input value={s.label} onChange={(e) => update(i, { label: e.target.value })} />
              </td>
              <td className="pr-3">
                <Select
                  value={s.channel}
                  onChange={(e) => {
                    const ch = e.target.value as Channel
                    update(i, { channel: ch, template_id: tpl.find((t) => t.channel === ch)?.id ?? s.template_id })
                  }}
                >
                  {Object.entries(CHANNELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="pr-3">
                <Select value={s.template_id} onChange={(e) => update(i, { template_id: Number(e.target.value) })}>
                  {tpl
                    .filter((t) => t.channel === s.channel)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </Select>
              </td>
              <td>
                <Button size="sm" variant="ghost" onClick={() => setSteps(steps.filter((_, k) => k !== i))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        size="sm"
        className="mt-3"
        icon={<Plus className="size-3.5" />}
        disabled={steps.length >= 10}
        onClick={() => setSteps([...steps, { id: null, offset_days: (steps.at(-1)?.offset_days ?? 0) + 15, channel: 'email', template_id: tpl.find((t) => t.channel === 'email')?.id ?? tpl[0].id, label: 'Nouvelle étape' }])}
      >
        Ajouter une étape
      </Button>
    </Card>
  )
}
