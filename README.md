# muse-ai-webapp

A web app for [Meta's Muse](https://muse.ai) that runs on a **Firefox/Gecko browser backend**.

Muse does not expose a public consumer API (the only supported surface is the web UI, with chat over `wss://edge-chat.meta.ai`). So this app drives the real muse.ai in a real browser instead of pretending an API exists.

## Gecko backend

- **Driver:** geckodriver 0.37.1 (W3C WebDriver) — not Playwright, not Chromium.
- **Browser:** system Firefox 159.0.1 (`/usr/lib/firefox/firefox`).
- **Verified end-to-end:** session create, navigate, type, submit (Enter keycode), read reply from DOM, screenshot, and cookie persistence across restarts.

See `docs/architecture.md` for the DOM-driven adapter design and the constraints we found (e.g. geckodriver 0.37 rejects `moz:firefoxOptions.profile` with "Invalid padding", so profiles are passed via `-profile` arg; Firefox only persists cookies with a real expiry).

## Quick start

```bash
# prerequisites (Arch)
pacman -S firefox geckodriver
# node >= 20.9, pnpm

pnpm install
pnpm dev
```

Open http://localhost:3000, click **Start browser**, sign in to Muse interactively in the headed Firefox window, then chat.

For a visible login window (required for first sign-in):
```bash
MUSE_HEADED=1 pnpm dev
```

Environment (see `.env.example`): `MUSE_GECKODRIVER`, `MUSE_FIREFOX_BINARY`, `MUSE_PROFILE_DIR`, `MUSE_HEADED`, `MUSE_COMPOSER_SELECTORS`, `MUSE_MESSAGE_SELECTORS`.

## Commands

- `pnpm dev` — Next.js dev server
- `pnpm build` / `pnpm start` — production
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest
- `pnpm gecko:check` — end-to-end Gecko/driver smoke test (no Muse account needed)
- `pnpm check` — typecheck + test + build

## Structure

- `src/lib/gecko/` — minimal W3C WebDriver client over geckodriver (`firefox-driver.ts`, `geckodriver.ts` process manager)
- `src/lib/muse/` — DOM adapter for muse.ai (`muse-adapter.ts`, `selectors.ts`)
- `src/lib/session/` — single shared browser session manager
- `src/app/api/` — `session`, `chat` (SSE streaming), `screenshot`, `diagnostics`
- `scripts/gecko-check.ts` — fixture-based Gecko smoke test

## Notes

- Replies are extracted by **polling the rendered transcript DOM** (Muse's WebSocket protocol is private/undocumented), streamed to the UI as they grow.
- The Firefox profile holds the signed-in session and is **never committed** (see `.gitignore`).
- Markup selectors are configurable/env-overridable because Muse ships changes without notice.
