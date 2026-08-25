# src/assets/

## Responsibility
Static assets bundled by Vite. Currently a single file.

## Design
- `vite.svg` — the Vite default logo SVG left over from scaffolding. It is not referenced anywhere in source (`rg vite.svg` finds no import), so it is dead weight; the app's real logo is served from `/logo.png` and `/favicon.png` at the site root (see `LoginPage`/`SetupPage` and `index.html`).

## Flow
None — nothing imports from this folder. If an asset is ever referenced by name it is served through Vite's `/assets` resolution.

## Integration
- Imported by nothing in `src/`.
- `index.html` references `/favicon.png` and `/logo.png` directly (public-root assets, not this folder).
