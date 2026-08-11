import { useCallback, useEffect, useRef, useState } from 'react';
import App from '../../App';
import { settingsApi } from '../../api/settingsApi';
import { OnboardingContext } from '../../state/OnboardingContext';
import { useArrayStatus } from '../../state/useArrayStatus';
import { OnboardingWizard } from './OnboardingWizard';

/**
 * Sits between ArrayStatusProvider and App (see ../../AuthGate.tsx) — the one place that decides
 * whether a freshly-logged-in user sees the real dashboard or the first-run setup wizard first.
 * App is always mounted underneath, wizard or not: closing/finishing the wizard needs nothing
 * more than hiding it, since the dashboard is already there and already reflects live state.
 *
 * Auto-opens at most once per page load, the moment the array status settles and turns out to be
 * genuinely unconfigured (see OnboardingWizard's deriveStartStep — total_slots === 0, not
 * array.state, is the real "nothing assigned yet" signal) and the wizard hasn't been dismissed
 * before. "Replay setup tour" (Settings → About) reopens it manually any time after that via the
 * same OnboardingContext this provides to the rest of the app.
 */
export function OnboardingGate() {
  const { status, loadState } = useArrayStatus();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    settingsApi
      .getSettings()
      .then((s) => setDismissed(s.onboarding.dismissed))
      .catch(() => setDismissed(true)); // fail safe: never block the dashboard behind a settings-load error
  }, []);

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (loadState !== 'ready' || dismissed === null) return;
    autoOpenedRef.current = true;
    if (status?.array.total_slots === 0 && !dismissed) setOpen(true);
  }, [loadState, status, dismissed]);

  const finish = useCallback(() => {
    setOpen(false);
    settingsApi.updateSettings({ onboarding: { dismissed: true } }).then((s) => setDismissed(s.onboarding.dismissed)).catch(() => {});
  }, []);

  const replay = useCallback(() => setOpen(true), []);

  return (
    <OnboardingContext.Provider value={{ replay }}>
      {open && <OnboardingWizard onFinish={finish} />}
      <App />
    </OnboardingContext.Provider>
  );
}
