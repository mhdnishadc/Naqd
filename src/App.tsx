import { NavLink, Navigate, Outlet, Route, Routes, Link } from 'react-router-dom'
import { configured } from './lib/supabase'
import { useAuth } from './lib/auth'
import { useAutoSync, useOnline, useOutbox } from './lib/hooks'
import { useT } from './lib/i18n'
import { syncOutbox } from './lib/outbox'
import { Login, NotConfigured, WorkspaceSetup } from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewEntry, { NewEntryHome } from './pages/NewEntry'
import Ledger from './pages/Ledger'
import Parties from './pages/Parties'
import PartyDetail from './pages/PartyDetail'
import Receivables from './pages/Receivables'
import Advances from './pages/Advances'
import Statements from './pages/Statements'
import Settings from './pages/Settings'

function More() {
  const { t } = useT()
  return (
    <div className="page narrow">
      <h1>{t('more')}</h1>
      <ul className="rows">
        {([['/parties', 'parties'], ['/advances', 'advances'], ['/statements', 'statements'], ['/settings', 'settings']] as const).map(([to, k]) => (
          <li key={to} className="row"><Link className="row-main" to={to}><span className="row-title">{t(k)}</span></Link></li>
        ))}
      </ul>
    </div>
  )
}

function Shell() {
  const { t } = useT()
  const { tenantName } = useAuth()
  const online = useOnline()
  const { waiting, rejected } = useOutbox()
  useAutoSync(true)
  const nav: [string, string, boolean?][] = [['/', t('home'), true], ['/ledger', t('ledger')], ['/new', '+'], ['/receivables', t('receivables')], ['/more', t('more')]]
  return (
    <div className="shell">
      <aside className="side no-print">
        <div className="brand"><span className="mark" aria-hidden>ن</span><div><strong>{t('appName')}</strong><small>{tenantName}</small></div></div>
        <Link className="btn primary block" to="/new">{t('newEntry')}</Link>
        <nav>
          {([['/', 'home', true], ['/ledger', 'ledger'], ['/receivables', 'receivables'], ['/advances', 'advances'], ['/statements', 'statements'], ['/parties', 'parties'], ['/settings', 'settings']] as const).map(([to, k, end]) => (
            <NavLink key={to} to={to} end={Boolean(end)}>{t(k)}</NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        {(!online || waiting > 0 || rejected > 0) && (
          <div className="banner no-print" role="status">
            <span>{!online ? t('offline') : `${waiting} ${t('pending')}`}{rejected > 0 && ` · ${rejected} ${t('rejected')}`}</span>
            {online && <button className="link" onClick={() => syncOutbox()}>{t('syncNow')}</button>}
          </div>
        )}
        <Outlet />
      </div>
      <nav className="tabs no-print" aria-label="Main">
        {nav.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={Boolean(end)} className={to === '/new' ? 'fab' : ''} aria-label={to === '/new' ? t('newEntry') : undefined}>{label}</NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  const { session, loading, profile } = useAuth()
  const { t } = useT()
  if (!configured) return <NotConfigured />
  if (loading) return <div className="splash">{t('loading')}</div>
  if (!session) return <Login />
  if (!profile) return <WorkspaceSetup />
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="new" element={<NewEntryHome />} />
        <Route path="new/:kind" element={<NewEntry />} />
        <Route path="receivables" element={<Receivables />} />
        <Route path="advances" element={<Advances />} />
        <Route path="statements" element={<Statements />} />
        <Route path="parties" element={<Parties />} />
        <Route path="parties/:id" element={<PartyDetail />} />
        <Route path="more" element={<More />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
