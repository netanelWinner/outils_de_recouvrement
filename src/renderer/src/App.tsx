// Racine : contrôle d'accès (mot de passe), verrouillage automatique, guide de démarrage, routes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setLockedHandler } from './lib/api'
import { Spinner } from './components/ui'
import { LoginScreen, RecoveryKeyScreen, SetupScreen } from './features/auth'
import { Onboarding } from './features/Onboarding'
import { Layout } from './features/Layout'
import { WorkspaceProvider } from './features/workspace'
import { TodayPage } from './features/TodayPage'
import { DashboardPage } from './features/DashboardPage'
import { InvoicesPage } from './features/invoices/InvoicesPage'
import { PaymentsPage } from './features/payments/PaymentsPage'
import { CompaniesPage } from './features/companies/CompaniesPage'
import { CompanyDetailPage } from './features/companies/CompanyDetailPage'
import { RemindersPage } from './features/reminders/RemindersPage'
import { ImportExportPage } from './features/ImportExportPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TrashPage, AuditPage } from './features/TrashAuditPages'
import { HelpPage } from './features/HelpPage'
import { VouchersPage } from './features/vouchers/VouchersPage'
import { BatchesPage } from './features/followup/BatchesPage'
import { RejectionsPage } from './features/followup/RejectionsPage'
import { FollowupPage } from './features/followup/FollowupPage'
import { LitigationPage } from './features/litigation/LitigationPage'
import { BankPage } from './features/bank/BankPage'
import { ForecastPage, ReliabilityPage, ReportsPage } from './features/analytics/AnalyticsPages'
import { WhatsNew } from './features/WhatsNew'

type Phase = 'loading' | 'setup' | 'recovery' | 'login' | 'app'

export function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [recoveryKey, setRecoveryKey] = useState('')
  const qc = useQueryClient()

  const toLogin = useCallback(() => {
    qc.clear()
    setPhase('login')
  }, [qc])

  useEffect(() => {
    setLockedHandler(toLogin)
    const off = window.bridge.onLocked(toLogin)
    api.auth
      .status()
      .then((s) => setPhase(!s.configured ? 'setup' : s.unlocked ? 'app' : 'login'))
      .catch(() => setPhase('login'))
    return off
  }, [toLogin])

  if (phase === 'loading') return <Spinner />
  if (phase === 'setup')
    return (
      <SetupScreen
        onDone={(k) => {
          setRecoveryKey(k)
          setPhase('recovery')
        }}
      />
    )
  if (phase === 'recovery')
    return (
      <RecoveryKeyScreen
        recoveryKey={recoveryKey}
        onDone={() => {
          setRecoveryKey('')
          setPhase('app')
        }}
      />
    )
  if (phase === 'login') return <LoginScreen onUnlocked={() => setPhase('app')} />
  return <Unlocked onLock={toLogin} />
}

function Unlocked({ onLock }: { onLock: () => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
  const lockMinutes = settings.data?.security.lock_minutes ?? 5
  useAutoLock(lockMinutes, onLock)

  if (!settings.data) return <Spinner />
  if (!settings.data.onboarding_done) return <Onboarding />

  return (
    <WorkspaceProvider>
      <Layout onLock={onLock}>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/tableau-de-bord" element={<DashboardPage />} />
          <Route path="/factures" element={<InvoicesPage />} />
          <Route path="/paiements" element={<PaymentsPage />} />
          <Route path="/entreprises" element={<CompaniesPage />} />
          <Route path="/entreprises/:id" element={<CompanyDetailPage />} />
          <Route path="/relances" element={<RemindersPage />} />
          <Route path="/import-export" element={<ImportExportPage />} />
          <Route path="/bons" element={<VouchersPage />} />
          <Route path="/bordereaux" element={<BatchesPage />} />
          <Route path="/rejets" element={<RejectionsPage />} />
          <Route path="/echanges" element={<FollowupPage />} />
          <Route path="/contentieux" element={<LitigationPage />} />
          <Route path="/banque" element={<BankPage />} />
          <Route path="/previsions" element={<ForecastPage />} />
          <Route path="/fiabilite" element={<ReliabilityPage />} />
          <Route path="/rapports" element={<ReportsPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/corbeille" element={<TrashPage />} />
          <Route path="/journal" element={<AuditPage />} />
          <Route path="/aide" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      <WhatsNew />
    </WorkspaceProvider>
  )
}

/** Verrouille l'application après `minutes` sans clavier ni souris. */
function useAutoLock(minutes: number, onLock: () => void) {
  const last = useRef(Date.now())
  useEffect(() => {
    const bump = () => (last.current = Date.now())
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) {
        void api.auth.lock().finally(onLock)
      }
    }, 15_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(t)
    }
  }, [minutes, onLock])
}
