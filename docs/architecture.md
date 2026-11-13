# Architecture

## Why a browser backend

Meta's Muse (muse.ai) has no public consumer API. Probing shows:
- `/api/*` routes return `401 {"error":"Authentication required"}` unauthenticated; `/mcp` returns `401/403`.
- Chat transport is `wss://edge-chat.meta.ai` (CSP `connect-src`) — a private protocol.
- `platform.muse.ai` is the *connector* platform (MCP servers Muse calls), not a way to consume Muse.

Therefore the only honest interface is the web UI itself: drive muse.ai in a real browser.

## Gecko stack

- **geckodriver 0.37.1** over HTTP (W3C WebDriver). Chosen to satisfy "Firefox/Gecko backend" with the system Firefox (159.0.1, `/usr/lib/firefox/firefox`), no bundled Chromium.
- Minimal in-house client (`src/lib/gecko/firefox-driver.ts`) — no automation framework that ships Chromium.
- Process manager (`src/lib/gecko/geckodriver.ts`) spawns geckodriver per session (isolated failure domain).

### Constraints discovered

- `moz:firefoxOptions.profile` capability is rejected by geckodriver 0.37.1 with `Invalid padding`. **Workaround:** pass profile via `-profile` arg (`args`). Verified working.
- Firefox persists **only cookies with a real `expiry`** across restarts (session cookies die with the browser). Profile dir at `MUSE_PROFILE_DIR` (default `~/.local/share/muse-ai-webapp/firefox-profile`).
- WebDriver Enter is the Unicode PUA keycode `\uE007`, sent to the element (not a literal newline).

## DOM adapter (`src/lib/muse/`)

- Selectors for composer/messages live in `selectors.ts`, tried in order, overridable via `MUSE_COMPOSER_SELECTORS` / `MUSE_MESSAGE_SELECTORS` (Muse ships markup changes without notice).
- `inspect()` is a page-side script returning `{hasComposer, hasLoginField, messageTexts,...}`; also powers `/api/diagnostics`.
- **Reply extraction:** poll rendered transcript until text stabilizes. Excludes the echoed prompt and guards against returning the previous turn's reply. Streams deltas to the client as text grows (DOM polling, not the private WS).
- Login is interactive/headed (`MUSE_HEADED=1`) — user signs in once in real Firefox; session persists in profile.

## App shape

- Next.js app (app router). Single shared `BrowserSessionManager` (stashed on `globalThis` to survive dev reloads) owns one geckodriver+Firefox session.
- API: `POST /api/session` start/open, `GET /api/session` status, `DELETE` stop; `POST /api/chat` SSE stream (`start`/`delta`/`done`/`error`); `GET /api/screenshot` live PNG; `GET /api/diagnostics` adapter view.
- UI: chat pane + live Gecko screenshot so the user can watch/take over.

## Verification

- `scripts/gecko-check.ts` (`pnpm gecko:check`): fixture-based, no account — proves geckodriver launch, Firefox 159, type, Enter submit, DOM readback, screenshot.
- Unit tests (`vitest`): selector fallbacks/overrides, reply detection (no prompt-echo, no previous-turn leak, streaming deltas, timeout).
- `pnpm check` = typecheck + test + build.
