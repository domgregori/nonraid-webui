# nonraid-webui

A web dashboard for [nonraid](https://github.com/qvr/nonraid) / `nmdctl` — an unRAID-style storage
array driver + CLI. Surfaces array status, parity protection, per-disk detail, shares, users, Docker
containers, historical metrics (via Grafana), and array settings.

This is currently a **frontend-only build on mocked data** — pixel-accurate recreation of the design
handoff prototype, with no backend wired up yet. State lives in a single React context + reducer
store (`src/state/`) and is seeded from mock data (`src/mock/`), so swapping in a real backend later
means replacing the initial-state source and dispatch side effects without touching components.

## Stack

- React 19 + TypeScript, Vite
- react-router-dom (routes: `/`, `/shares`, `/users`, `/docker`, `/history`, `/settings`)
- Plain CSS with a token file (`src/styles/tokens.css`) — no CSS-in-JS, no component library

## Getting started

```bash
npm install
npm run dev
```

## Project layout

```
src/
  types/       domain types (Disk, Parity, Container, User, Share, Settings, ...)
  mock/        hardcoded mock data
  state/       app store: reducer, actions, context/provider, scenario presets
  selectors/   pure derivation functions (state -> view models)
  components/  layout, dashboard, disk-detail, shared UI primitives
  pages/       one component per route
  styles/      CSS token file + per-area stylesheets
```

## Notes

- The scenario switcher in the header (Healthy / Degraded / Parity Check) is a **demo-only** control
  for previewing array states without a real backend. It's isolated into its own component
  (`ScenarioSwitcher.tsx`) and action (`SET_SCENARIO`) so it can be removed cleanly once real
  `nmdctl status` data is wired in.
- See the original design handoff notes (not included in this repo) for backend integration points:
  `nmdctl status -o json` for array/disk state, `nmdctl start`/`stop`/`check` for controls, the
  Docker Engine API for containers, and a stored Grafana embed URL for History.
