import { OnboardingGate } from './components/onboarding/OnboardingGate';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ArrayStatusProvider } from './state/ArrayStatusProvider';
import { useAuth } from './state/useAuth';

/**
 * The only branching point between "not authenticated yet" and the real
 * app — App.tsx's route table is untouched. ArrayStatusProvider (and its 2s
 * status poll) only mounts once authenticated, so the login/setup screens
 * never generate a stream of 401s in the background. OnboardingGate (not App
 * directly) decides whether a just-authenticated user with a genuinely blank
 * array sees the first-run setup wizard before the real dashboard — see its
 * own doc comment.
 */
export function AuthGate() {
  const { loadState, configured, authenticated, error } = useAuth();

  if (loadState === 'loading') {
    return <div className="auth-screen" />;
  }
  if (loadState === 'error') {
    return (
      <div className="auth-screen">
        <div className="auth-card card">
          <div className="status-note status-note--error">Can't reach the backend: {error}</div>
        </div>
      </div>
    );
  }
  if (!configured) return <SetupPage />;
  if (!authenticated) return <LoginPage />;

  return (
    <ArrayStatusProvider>
      <OnboardingGate />
    </ArrayStatusProvider>
  );
}
