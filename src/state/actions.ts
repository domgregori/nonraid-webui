export type AppAction =
  | { type: 'TOGGLE_TURBO' }
  | { type: 'TOGGLE_NOTIFY' }
  | { type: 'SET_GRAFANA_DRAFT'; value: string }
  | { type: 'CONNECT_GRAFANA' };
