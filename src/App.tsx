import React from 'react';
import { AlertTriangle, Copy, RotateCw, Lock } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { RecordPaymentModal } from './components/modals/RecordPaymentModal';
import { LoginScreen, ChangePasswordPrompt } from './views/LoginScreen';
import { useLicense, refreshLicense } from './utils/licenseStore';
import { onLicenseChanged, getSession } from './services/db';
import { TAB_MODULE } from './utils/access';

// Views
import { ActionTips } from './components/common/ActionTips';
import { ClearButtons } from './components/common/ClearButtons';
const OverviewView = React.lazy(() => import('./views/OverviewView').then(m => ({ default: m.OverviewView })));
const FinesView = React.lazy(() => import('./views/FinesView').then(m => ({ default: m.FinesView })));
const MembersView = React.lazy(() => import('./views/MembersView').then(m => ({ default: m.MembersView })));
const CollectionsView = React.lazy(() => import('./views/CollectionsView').then(m => ({ default: m.CollectionsView })));
const InvestmentsView = React.lazy(() => import('./views/InvestmentsView').then(m => ({ default: m.InvestmentsView })));
const InvestmentReturnsView = React.lazy(() => import('./views/InvestmentReturnsView').then(m => ({ default: m.InvestmentReturnsView })));
const PersonalLoansView = React.lazy(() => import('./views/PersonalLoansView').then(m => ({ default: m.PersonalLoansView })));
const ExpensesView = React.lazy(() => import('./views/ExpensesView').then(m => ({ default: m.ExpensesView })));
const EntryCenterView = React.lazy(() => import('./views/EntryCenterView').then(m => ({ default: m.EntryCenterView })));
const MasterDataView = React.lazy(() => import('./views/MasterDataView').then(m => ({ default: m.MasterDataView })));
const UserManagementView = React.lazy(() => import('./views/UserManagementView').then(m => ({ default: m.UserManagementView })));
const BackupRestoreView = React.lazy(() => import('./views/BackupRestoreView').then(m => ({ default: m.BackupRestoreView })));
const ReportsView = React.lazy(() => import('./views/ReportsView').then(m => ({ default: m.ReportsView })));
const LicenseControlView = React.lazy(() => import('./views/LicenseControlView').then(m => ({ default: m.LicenseControlView })));
const SettingsView = React.lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const UserProfileView = React.lazy(() => import('./views/UserProfileView').then(m => ({ default: m.UserProfileView })));

interface ErrorBoundaryProps { resetKey: string; children: React.ReactNode; t: (key: string, fallback?: string) => string }
interface ErrorBoundaryState { error: Error | null; copied: boolean }

/** Keeps one broken screen from blanking the whole app. Resets when the user navigates to another tab. */
class ViewErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('View crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, copied: false });
  }

  private copy = () => {
    const e = this.state.error;
    const text = `${e?.message || 'Unknown error'}\n\n${e?.stack || ''}`;
    const done = () => this.setState({ copied: true });
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
    else done();
  };

  render() {
    const { error, copied } = this.state;
    const { t } = this.props;
    if (!error) return this.props.children;
    return (
      <div className="p-8 flex justify-center">
        <div className="card-base max-w-xl w-full p-6 text-xs">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={20} className="text-rose-600" />
            <h2 className="text-base font-black text-slate-900 dark:text-white">{t('shell.crash_title', 'This screen ran into a problem')}</h2>
          </div>
          <p className="text-slate-600 dark:text-slate-400 mb-3">
            {t('shell.crash_body', 'Your data is safe. You can switch to another screen from the sidebar, or reload the app.')}
          </p>
          <pre className="whitespace-pre-wrap break-words select-text bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900 rounded-xl p-3 font-mono text-[11px] max-h-48 overflow-auto">
            {error.message || String(error)}
          </pre>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={this.copy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
            >
              <Copy size={13} /> {copied ? t('shell.copied', 'Copied!') : t('shell.copy', 'Copy')}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary"
            >
              <RotateCw size={13} /> {t('shell.reload', 'Reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const MainLayout: React.FC = () => {
  const { activeTab, t, can, canUpload, language, toBanglaDigits, formatDate, session } = useApp();
  const lic = useLicense();
  const who = session?.user?.username;
  React.useEffect(() => { void refreshLicense(); }, [who]);      // the notice below is about the signed-in user's own licence
  const expiring = !!lic && lic.enforced && !lic.locked && !canUpload && lic.daysLeft !== null && lic.daysLeft <= 7;
  const tabModules = TAB_MODULE[activeTab] ?? null;
  const noAccess = !!tabModules && !can(tabModules, 'view');
  // Overview and Reports only read and export, so their buttons stay visible for everyone who can open them
  const viewOnly = !!tabModules && !noAccess && !can(tabModules, 'edit') && activeTab !== 'overview' && activeTab !== 'reports';

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewView />;
      case 'members':
        return <MembersView />;
      case 'fines':
        return <FinesView />;
      case 'collections':
        return <CollectionsView />;
      case 'investments':
        return <InvestmentsView />;
      case 'returns':
        return <InvestmentReturnsView />;
      case 'loans':
        return <PersonalLoansView />;
      case 'expenses':
        return <ExpensesView />;
      case 'entry':
        return <EntryCenterView />;
      case 'master':
        return <MasterDataView />;
      case 'users':
        return <UserManagementView />;
      case 'backup':
        return <BackupRestoreView />;
      case 'license':
        return canUpload ? <LicenseControlView /> : <OverviewView />;
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
      case 'profile':
        return <UserProfileView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100/80 dark:bg-[#0b1317] text-slate-800 dark:text-slate-100 transition-colors">
      {/* Dark Slate Teal Sidebar (Matching Mockups) */}
      <Sidebar />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <TopBar />

        {/* Viewport Scrollable Content */}
        <main className={`relative flex-1 min-h-0 overflow-y-auto overscroll-contain bg-slate-100/80 dark:bg-[#0b1317] transition-colors ${viewOnly ? 'view-only' : ''}`}>
          {expiring && lic && (
            <div className="sticky top-0 z-30 px-6 lg:px-8 py-2 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-900 text-[11px] font-bold text-rose-800 dark:text-rose-200 flex items-center gap-2">
              <Lock size={13} />{t('license.expiring', 'The licence ends in {n} day(s) ({date}). Please renew it with the software provider.').replace('{n}', language === 'bn' ? toBanglaDigits(Math.max(lic.daysLeft ?? 0, 0)) : String(Math.max(lic.daysLeft ?? 0, 0))).replace('{date}', formatDate(lic.paidUntil))}
            </div>
          )}
          {viewOnly && (
            <div className="sticky top-0 z-30 px-6 lg:px-8 py-2 bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-900 text-[11px] font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
              <Lock size={13} />{t('access.view_only_bar', 'You have view-only access to this section. Ask the Super User if you need to make changes.')}
            </div>
          )}
          <ViewErrorBoundary resetKey={activeTab} t={t}>
            <React.Suspense fallback={<div className="p-8 flex items-center gap-2 text-xs text-slate-500"><RotateCw size={14} className="animate-spin" />{t('common.loading', 'Loading…')}</div>}>
              {noAccess ? (
                <div className="p-8 flex justify-center"><div className="card-base max-w-md w-full p-8 text-center">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400"><Lock size={22} /></div>
                  <h2 className="mt-4 text-base font-black text-slate-900 dark:text-white">{t('access.no_access_title', 'No access to this section')}</h2>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{t('access.no_access_body', 'Your account does not have access to this part of the app. Ask the Super User (iqbal_labs) to grant it.')}</p>
                </div></div>
              ) : renderActiveView()}
            </React.Suspense>
          </ViewErrorBoundary>
        </main>
      </div>

      <ActionTips />

      {/* Global Record Payment Dialog */}
      <RecordPaymentModal />
    </div>
  );
};

/** Sign-in gate: nothing behind it is rendered (or queried) without a session. */
const AuthGate: React.FC = () => {
  const { session, sessionChecked, signOut, showToast, t } = useApp();
  const lic = useLicense();
  const [promptDismissed, setPromptDismissed] = React.useState(false);
  React.useEffect(() => { if (!session) setPromptDismissed(false); }, [session]);
  // When a licence check ends (suspended, expired, released) the main process signs that user out. Notice it here and return to the sign-in page.
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  React.useEffect(() => onLicenseChanged(() => {
    if (!sessionRef.current) return;
    getSession().then(s => { if (!s && sessionRef.current) { showToast(t('license.session_ended', 'Your licence has ended, so you were signed out. Your data is safe.'), 'error'); signOut().catch(() => undefined); } }, () => undefined);
  }), [signOut, showToast, t]);
  if (!sessionChecked || lic === null) {
    return <div className="h-screen w-screen flex items-center justify-center bg-slate-100 dark:bg-[#0b1317]"><RotateCw size={18} className="animate-spin text-slate-400" /></div>;
  }
  if (!session) return <LoginScreen />;
  return (
    <>
      <MainLayout />
      <ChangePasswordPrompt open={session.mustChangePassword && !promptDismissed} forced onDone={() => setPromptDismissed(true)} />
    </>
  );
};

export function App() {
  return (
    <AppProvider>
      <AuthGate />
      <ClearButtons />
    </AppProvider>
  );
}

export default App;

