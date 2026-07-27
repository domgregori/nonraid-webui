import type { SettingsState } from '../types';
import type { AppAction } from './actions';

export interface AppState {
  settings: SettingsState;
  grafanaUrl: string;
  grafanaDraft: string;
}

export const initialAppState: AppState = {
  settings: { turboWrite: false, notifyEnabled: true },
  grafanaUrl: '',
  grafanaDraft: '',
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'TOGGLE_TURBO':
      return { ...state, settings: { ...state.settings, turboWrite: !state.settings.turboWrite } };

    case 'TOGGLE_NOTIFY':
      return { ...state, settings: { ...state.settings, notifyEnabled: !state.settings.notifyEnabled } };

    case 'SET_GRAFANA_DRAFT':
      return { ...state, grafanaDraft: action.value };

    case 'CONNECT_GRAFANA':
      return state.grafanaUrl
        ? { ...state, grafanaUrl: '', grafanaDraft: '' }
        : { ...state, grafanaUrl: state.grafanaDraft.trim() };

    default:
      return state;
  }
}
