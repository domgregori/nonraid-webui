import type { ReactNode } from 'react';
import { DiskDetailPanel } from '../disk-detail/DiskDetailPanel';
import { ArrayErrorBanner } from './ArrayErrorBanner';
import { Footer } from './Footer';
import { Header } from './Header';
import { NavTabs } from './NavTabs';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <Header />
      <NavTabs />
      <ArrayErrorBanner />
      {children}
      <Footer />
      <DiskDetailPanel />
    </div>
  );
}
