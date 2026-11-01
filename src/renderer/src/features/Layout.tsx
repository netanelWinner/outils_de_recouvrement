// Mise en page : menu latéral, barre du haut (recherche Ctrl+K, nouvelle facture, verrouillage), raccourcis.
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  CalendarCheck,
  FileSpreadsheet,
  FileText,
  FileWarning,
  FileBarChart,
  Gauge,
  TrendingUp,
  Gavel,
  Landmark,
  MessagesSquare,
  PackageCheck,
  Ticket,
  HelpCircle,
  History,
  LayoutDashboard,
  Lock,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  Wallet
} from 'lucide-react'
import { api } from '@/lib/api'
import { Badge, Button, cx } from '@/components/ui'
import { useWorkspace } from './workspace'
import { CommandPalette } from './CommandPalette'

const NAV_GROUPS = [
  {
    title: null,
    items: [{ to: '/', label: 'Aujourd’hui', icon: CalendarCheck, badge: true }]
  },
  {
    title: 'Pilotage',
    items: [
      { to: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard },
      { to: '/previsions', label: 'Prévisions', icon: TrendingUp },
      { to: '/fiabilite', label: 'Fiabilité des clients', icon: Gauge },
      { to: '/rapports', label: 'Rapports mensuels', icon: FileBarChart }
    ]
  },
  {
    title: 'Facturation',
    items: [
      { to: '/factures', label: 'Factures', icon: FileText },
      { to: '/bons', label: 'Bons de prise en charge', icon: Ticket },
      { to: '/bordereaux', label: 'Bordereaux de dépôt', icon: PackageCheck },
      { to: '/rejets', label: 'Rejets', icon: FileWarning },
      { to: '/entreprises', label: 'Entreprises', icon: Building2 }
    ]
  },
  {
    title: 'Recouvrement',
    items: [
      { to: '/relances', label: 'Relances', icon: Send },
      { to: '/echanges', label: 'Échanges et promesses', icon: MessagesSquare },
      { to: '/contentieux', label: 'Contentieux', icon: Gavel }
    ]
  },
  {
    title: 'Encaissement',
    items: [
      { to: '/paiements', label: 'Paiements', icon: Wallet },
      { to: '/banque', label: 'Rapprochement bancaire', icon: Landmark },
      { to: '/import-export', label: 'Import / Export', icon: FileSpreadsheet }
    ]
  }
]
const NAV2 = [
  { to: '/parametres', label: 'Paramètres', icon: Settings },
  { to: '/corbeille', label: 'Corbeille', icon: Trash2 },
  { to: '/journal', label: 'Journal d’audit', icon: History },
  { to: '/aide', label: 'Aide', icon: HelpCircle }
]

export function Layout({ children, onLock }: { children: ReactNode; onLock: () => void }) {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const [search, setSearch] = useState(false)
  const agenda = useQuery({ queryKey: ['agenda'], queryFn: () => api.agenda.today(), refetchInterval: 5 * 60_000 })
  const a = agenda.data
  // Pastille « Aujourd'hui » : nombre de points à traiter
  const agendaCount = a
    ? a.reminders_pending + a.promises_broken.length + a.promises_due.length + a.rejections_due.length + a.vouchers_expiring.length + a.litigation_steps.length
    : undefined
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const version = useQuery({ queryKey: ['version'], queryFn: () => api.app.version(), staleTime: Infinity })

  const lock = () => void api.auth.lock().finally(onLock)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (e.ctrlKey && k === 'k') {
        e.preventDefault()
        setSearch(true)
      } else if (e.ctrlKey && !e.shiftKey && k === 'n') {
        e.preventDefault()
        ws.newInvoice()
      } else if (e.ctrlKey && e.shiftKey && k === 'p') {
        e.preventDefault()
        ws.newPayment()
      } else if (e.ctrlKey && k === 'l') {
        e.preventDefault()
        lock()
      } else if (e.key === 'F1') {
        e.preventDefault()
        navigate('/aide')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hospital = settings.data?.hospital.name

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="border-b border-white/10 px-5 py-4">
          <div className="text-base font-semibold tracking-tight text-white">Recouvrement</div>
          <div className="truncate text-xs text-slate-400" title={hospital}>
            {hospital || 'Hôpital'}
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.title ?? 'main'} className={g.title ? 'pt-3' : ''}>
              {g.title && <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{g.title}</div>}
              {g.items.map((n) => (
                <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} count={'badge' in n && n.badge ? agendaCount : undefined} />
              ))}
            </div>
          ))}
          <div className="my-3 border-t border-white/10" />
          {NAV2.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-500">
          Version {version.data ?? ''} · Données chiffrées
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-6">
          <button
            onClick={() => setSearch(true)}
            className="flex h-9 min-w-0 flex-1 basis-64 items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-500 hover:border-brand-600 lg:max-w-md"
          >
            <Search className="size-4 shrink-0" />
            <span className="min-w-0 truncate">Rechercher une facture, un patient, une entreprise…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-slate-300 bg-white px-1.5 text-xs xl:inline">Ctrl+K</kbd>
          </button>
          {settings.data?.demo_loaded && (
            <NavLink to="/parametres?onglet=demo" className="shrink-0" title="Données fictives – cliquez pour les effacer">
              <Badge className="bg-amber-100 text-amber-800 ring-amber-300">
                <span className="2xl:hidden">Démo</span>
                <span className="hidden 2xl:inline">Mode démonstration (données fictives)</span>
              </Badge>
            </NavLink>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="secondary" icon={<Wallet className="size-4" />} onClick={() => ws.newPayment()} title="Paiement reçu (Ctrl+Maj+P)">
              <span className="hidden xl:inline">Paiement reçu</span>
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ws.newInvoice()} title="Nouvelle facture (Ctrl+N)">
              Nouvelle facture
            </Button>
            <Button variant="ghost" icon={<Lock className="size-4" />} onClick={lock} title="Verrouiller (Ctrl+L)">
              <span className="hidden xl:inline">Verrouiller</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>
      {search && <CommandPalette onClose={() => setSearch(false)} />}
    </div>
  )
}

function NavItem({ to, label, icon: Icon, count }: { to: string; label: string; icon: typeof FileText; count?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors', isActive ? 'bg-brand-700 text-white' : 'hover:bg-white/5 hover:text-white')
      }
    >
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
      {!!count && <span className="rounded-full bg-orange-500 px-1.5 text-xs font-semibold text-white">{count}</span>}
    </NavLink>
  )
}
