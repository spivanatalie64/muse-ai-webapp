import { BrowserSessionManager } from "./browser-session";

/**
 * The application-wide browser session.
 *
 * Next.js reloads modules in development, which would otherwise leave an
 * orphaned geckodriver behind every time a file changed. Stashing the manager
 * on `globalThis` keeps one browser alive across reloads.
 */
const globalForSession = globalThis as typeof globalThis & {
  __museBrowserSession?: BrowserSessionManager;
};

/** The shared browser session manager. */
export function getSessionManager(): BrowserSessionManager {
  if (!globalForSession.__museBrowserSession) {
    globalForSession.__museBrowserSession = new BrowserSessionManager();
  }
  return globalForSession.__museBrowserSession;
}
