import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { RecordPaymentModal } from './components/modals/RecordPaymentModal';

// Views
import { OverviewView } from './views/OverviewView';
import { MembersView } from './views/MembersView';
import { CollectionsView } from './views/CollectionsView';
import { InvestmentsView } from './views/InvestmentsView';
import { ExpensesView } from './views/ExpensesView';
import { EntryCenterView } from './views/EntryCenterView';
import { MasterDataView } from './views/MasterDataView';
import { UserManagementView } from './views/UserManagementView';
import { BackupRestoreView } from './views/BackupRestoreView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';

const MainLayout: React.FC = () => {
  const { activeTab } = useApp();

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewView />;
      case 'members':
        return <MembersView />;
      case 'collections':
        return <CollectionsView />;
      case 'investments':
        return <InvestmentsView />;
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
      case 'reports':
        return <ReportsView />;
      case 'settings':
        return <SettingsView />;
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
        <main className="flex-1 overflow-y-auto bg-slate-100/80 dark:bg-[#0b1317] transition-colors">
          {renderActiveView()}
        </main>
      </div>

      {/* Global Record Payment Dialog */}
      <RecordPaymentModal />
    </div>
  );
};

export function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}

export default App;

