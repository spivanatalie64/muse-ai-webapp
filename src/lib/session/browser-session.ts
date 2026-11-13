import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  findGeckodriver,
  startGeckoSession,
  type GeckoSession,
} from "@/lib/gecko/geckodriver";
import { MuseAdapter } from "@/lib/muse/muse-adapter";

/** Where the browser profile lives, so a signed-in Muse session survives restarts. */
export const PROFILE_DIR =
  process.env.MUSE_PROFILE_DIR ??
  join(homedir(), ".local", "share", "muse-ai-webapp", "firefox-profile");

/** The Firefox binary to drive. */
const FIREFOX_BINARY =
  process.env.MUSE_FIREFOX_BINARY ?? "/usr/lib/firefox/firefox";

/**
 * Preferences applied to every Firefox session.
 *
 * These keep the browser quiet and predictable. Nothing here affects how Muse
 * renders; they exist so the browser does not phone home about itself or try to
 * show the user first-run flows.
 */
const FIREFOX_PREFS = {
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage": "about:blank",
  "browser.startup.page": 0,
  "datareporting.healthreport.uploadEnabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.enabled": false,
  "toolkit.telemetry.unified": false,
  "app.update.enabled": false,
  "extensions.update.enabled": false,
  "browser.safebrowsing.malware.enabled": false,
  "browser.safebrowsing.phishing.enabled": false,
  "network.captive-portal-service.enabled": false,
  "dom.disable_beforeunload": true,
};

/** The state of the managed browser session, as reported to the UI. */
export interface SessionStatus {
  /** Whether a browser session is running. */
  running: boolean;
  /** Whether the session is signed in to Muse. */
  signedIn: boolean | null;
  /** The Firefox version driving the session. */
  browserVersion: string | null;
  /** The geckodriver version in use. */
  geckodriverVersion: string | null;
  /** Whether Firefox is running with a visible window. */
  headed: boolean;
  /** A human-readable description of the last error, if any. */
  lastError: string | null;
}

/**
 * Owns the application's single browser session.
 *
 * There is one session rather than one per request because Muse's own session
 * is the scarce resource: signing in is interactive, and a signed-in session
 * lives in the Firefox profile. Sharing a single browser across requests keeps
 * that login intact.
 */
export class BrowserSessionManager {
  private session: GeckoSession | null = null;
  private adapter: MuseAdapter | null = null;
  private headed: boolean;
  private lastError: string | null = null;
  private starting: Promise<void> | null = null;

  constructor() {
    this.headed = process.env.MUSE_HEADED === "1";
  }

  /** The Muse adapter for the current session, or null when not running. */
  get muse(): MuseAdapter | null {
    return this.adapter;
  }

  /** Whether a browser session is currently running. */
  get isRunning(): boolean {
    return this.session !== null;
  }

  /**
   * Starts a browser session, if one is not already running.
   *
   * Concurrent callers share one start-up attempt rather than racing to spawn
   * two browsers, which would leave an orphaned geckodriver behind.
   */
  async start(): Promise<void> {
    if (this.session) return;
    if (this.starting) return this.starting;

    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  /** Performs the actual start-up. */
  private async doStart(): Promise<void> {
    const binary = findGeckodriver();
    if (!binary) {
      throw new Error(
        "geckodriver was not found. Install it with: pacman -S geckodriver",
      );
    }

    await mkdir(PROFILE_DIR, { recursive: true });

    this.session = await startGeckoSession({
      binary,
      session: {
        binary: FIREFOX_BINARY,
        profile: PROFILE_DIR,
        // A headed window is what makes the interactive login possible: the
        // user signs in to Muse in a real Firefox window that is already
        // signed into their account.
        headless: !this.headed,
        prefs: FIREFOX_PREFS,
        windowSize: { width: 1400, height: 900 },
      },
    });

    this.adapter = new MuseAdapter(this.session.driver);
    this.lastError = null;
  }

  /** Stops the browser session, if one is running. */
  async stop(): Promise<void> {
    if (this.session) {
      await this.session.dispose();
      this.session = null;
      this.adapter = null;
    }
  }

  /** Restarts the browser session. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Records the most recent error for display in the UI. */
  recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  /** Clears the recorded error. */
  clearError(): void {
    this.lastError = null;
  }

  /** Describes the current session for the UI. */
  async status(): Promise<SessionStatus> {
    if (!this.session || !this.adapter) {
      return {
        running: false,
        signedIn: null,
        browserVersion: null,
        geckodriverVersion: null,
        headed: this.headed,
        lastError: this.lastError,
      };
    }

    const caps = this.session.driver.sessionCapabilities;
    let signedIn: boolean | null = null;

    try {
      signedIn = await this.adapter.isSignedIn();
    } catch (error) {
      // A page that is still loading is not a signed-out session, so we report
      // "unknown" rather than claiming the user is logged out.
      this.recordError(error);
      signedIn = null;
    }

    return {
      running: true,
      signedIn,
      browserVersion: (caps.browserVersion as string) ?? null,
      geckodriverVersion: (caps["moz:geckodriverVersion"] as string) ?? null,
      headed: this.headed,
      lastError: this.lastError,
    };
  }

  /** Whether Firefox should run with a visible window. */
  get isHeaded(): boolean {
    return this.headed;
  }

  /**
   * Switches between headed and headless operation.
   *
   * Headless is the better default for routine use: it is faster and cannot
   * steal focus. Headed is required for the interactive sign-in.
   */
  async setHeaded(headed: boolean): Promise<void> {
    if (this.headed === headed) return;
    this.headed = headed;
    await this.restart();
  }
}
