import { createContext, useContext } from 'react';

export interface OnboardingContextValue {
  /** Reopens the setup wizard on demand — "Replay setup tour" in Settings → About. Always starts
   *  from whatever step deriveStartStep() computes for the array's current live state, same as
   *  the automatic first-run open (see OnboardingGate) — there's no separate "step 1 only" mode. */
  replay: () => void;
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within an OnboardingGate');
  return ctx;
}
