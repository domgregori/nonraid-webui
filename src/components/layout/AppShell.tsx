import type { ReactNode } from 'react';
import { DiskDetailPanel } from '../disk-detail/DiskDetailPanel';
import { ArrayStopBlockedModal } from '../shared/ArrayStopBlockedModal';
import { Footer } from './Footer';
import { Header } from './Header';
import { NavTabs } from './NavTabs';
import { ToastStack } from './ToastStack';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Header />
      <NavTabs />
      <ToastStack />
      {children}
      <Footer />
      <DiskDetailPanel />
      <ArrayStopBlockedModal />
    </div>
  );
}
