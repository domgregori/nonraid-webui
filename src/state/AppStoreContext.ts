import { createContext, type Dispatch } from 'react';
import type { AppAction } from './actions';
import type { AppState } from './appReducer';

export interface AppStoreContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

export const AppStoreContext = createContext<AppStoreContextValue | null>(null);
