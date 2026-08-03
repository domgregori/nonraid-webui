import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AppsPage } from './pages/AppsPage';
import { BrowsePage } from './pages/BrowsePage';
import { DashboardPage } from './pages/DashboardPage';
import { DockerPage } from './pages/DockerPage';
import { HistoryPage } from './pages/HistoryPage';
import { LxcPage } from './pages/LxcPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharesPage } from './pages/SharesPage';
import { UsersPage } from './pages/UsersPage';

function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/shares" element={<SharesPage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/docker" element={<DockerPage />} />
        <Route path="/lxc" element={<LxcPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export default App;
