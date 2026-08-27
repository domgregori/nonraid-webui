import { useTranslation } from 'react-i18next';
import { OnboardingGate } from './components/onboarding/OnboardingGate';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ArrayStatusProvider } from './state/ArrayStatusProvider';
import { NotificationsProvider } from './state/NotificationsProvider';
import { SettingsProvider } from './state/SettingsProvider';
import { useAuth } from './state/useAuth';

/**
 * The only branching point between "not authenticated yet" and the real
 * app - App.tsx's route table is untouched. ArrayStatusProvider/
 * NotificationsProvider (and their polls) only mount once authenticated, so
 * the login/setup screens never generate a stream of 401s in the
 * background. OnboardingGate (not App directly) decides whether a
 * just-authenticated user with a genuinely blank array sees the first-run
 * setup wizard before the real dashboard - see its own doc comment.
 */
export function AuthGate() {
  const { t } = useTranslation('app');
  const { loadState, configured, authenticated, error } = useAuth();

  if (loadState === 'loading') {
    return <div className="auth-screen" />;
  }
  if (loadState === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-card card">
          <div className="status-note status-note--error">{t('AuthGate.backendUnreachable', { error })}</div>
        </div>
      </div>
    );
  }
  if (!configured) return <SetupPage />;
  if (!authenticated) return <LoginPage />;

  return (
    <ArrayStatusProvider>
      <SettingsProvider>
        <NotificationsProvider>
          <OnboardingGate />
        </NotificationsProvider>
      </SettingsProvider>
    </ArrayStatusProvider>
  );
}
