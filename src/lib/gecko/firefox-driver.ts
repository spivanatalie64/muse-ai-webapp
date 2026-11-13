/**
 * A minimal W3C WebDriver client that speaks to `geckodriver` over HTTP.
 *
 * Scope is deliberately narrow: this project needs a real Firefox it can log into,
 * type into, screenshot, and read back out of. That is the whole surface, so we
 * talk to geckodriver directly rather than pulling in a browser-automation
 * framework that would also ship a Chromium build we would never use.
 *
 * Keeping the dependency list empty here is deliberate. A framework that bundles
 * Chromium would defeat the point of running on Gecko.
 */

/** Element reference as returned by WebDriver's "Find Element" command. */
export interface WebDriverElement {
  /** W3C element identifier key. */
  "element-6066-11e4-a52e-4f735466cecf": string;
}

/** The `value` envelope every W3C WebDriver response is wrapped in. */
interface WebDriverEnvelope<T> {
  value: T;
  error?: string;
  message?: string;
  stacktrace?: string;
}

/** Error carrying the WebDriver error code and message so callers can branch on it. */
export class WebDriverError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stacktrace?: string,
  ) {
    super(message);
    this.name = "WebDriverError";
  }
}

/** Firefox preferences that the app sets for every session. */
export interface FirefoxPreferences {
  [key: string]: string | number | boolean;
}

/** Options accepted when creating a Firefox session. */
export interface FirefoxSessionOptions {
  /** Absolute path to the Firefox binary. Defaults to the system `firefox`. */
  binary?: string;
  /**
   * Absolute path to a Firefox profile directory.
   *
   * NOTE: geckodriver 0.37.x rejects the `moz:firefoxOptions.profile` capability
   * with "Invalid padding", so this is passed as a `-profile` command line argument
   * instead. See `FirefoxDriver` for the details.
   */
  profile?: string;
  /** Run without a visible window. */
  headless?: boolean;
  /** Extra command line arguments passed to Firefox. */
  args?: string[];
  /** Preferences applied to the profile before launch. */
  prefs?: FirefoxPreferences;
  /** Window size in pixels, used for screenshots. */
  windowSize?: { width: number; height: number };
}

/** A cookie as WebDriver represents it. */
export interface WebDriverCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expiry?: number;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Capabilities reported by the browser for an active session. */
export interface SessionCapabilities {
  browserName?: string;
  browserVersion?: string;
  platformName?: string;
  acceptInsecureCerts?: boolean;
  "moz:geckodriverVersion"?: string;
  "moz:headless"?: boolean;
  [key: string]: unknown;
}

/**
 * Controls a Firefox instance through `geckodriver`.
 *
 * One instance owns one Firefox session. The session is created lazily so that
 * constructing a driver never launches a browser as a side effect.
 */
export class FirefoxDriver {
  private sessionId: string | null = null;
  private capabilities: SessionCapabilities = {};

  constructor(
    private readonly baseUrl: string,
    private readonly options: FirefoxSessionOptions = {},
  ) {}

  /** True when a browser session is currently open. */
  get isRunning(): boolean {
    return this.sessionId !== null;
  }

  /** The capabilities Firefox reported when the session was created. */
  get sessionCapabilities(): SessionCapabilities {
    return this.capabilities;
  }

  /**
   * Opens a Firefox session.
   *
   * The profile is passed via `-profile` rather than the `profile` capability
   * because geckodriver 0.37.1 fails the capability path with "Invalid padding".
   * We verified the argument path works and that cookies carrying a real expiry
   * survive a browser restart in the profile.
   */
  async start(): Promise<SessionCapabilities> {
    if (this.sessionId) return this.capabilities;

    const mozOptions: Record<string, unknown> = {
      binary: this.options.binary ?? "/usr/lib/firefox/firefox",
    };

    const args = [...(this.options.args ?? [])];
    if (this.options.headless !== false) args.push("-headless");
    if (this.options.profile) args.push("-profile", this.options.profile);
    mozOptions.args = args;

    // Preferences must live inside `moz:firefoxOptions` as `prefs`. Setting
    // `moz:firefoxOptions.prefs` as a sibling key is not a valid capability
    // and geckodriver rejects the whole session.
    const prefs: FirefoxPreferences = { ...(this.options.prefs ?? {}) };
    if (this.options.windowSize) {
      const { width, height } = this.options.windowSize;
      prefs["browser.width"] = width;
      prefs["browser.height"] = height;
    }
    if (Object.keys(prefs).length > 0) {
      mozOptions.prefs = prefs;
    }

    const body: Record<string, unknown> = {
      capabilities: {
        alwaysMatch: {
          browserName: "firefox",
          acceptInsecureCerts: true,
          "moz:firefoxOptions": mozOptions,
        },
      },
    };

    const result = await this.request<{
      sessionId: string;
      capabilities: SessionCapabilities;
    }>("POST", "/session", body, { absolute: true });

    this.sessionId = result.sessionId;
    this.capabilities = result.capabilities ?? {};
    return this.capabilities;
  }

  /** Closes the browser session, if one is open. */
  async stop(): Promise<void> {
    if (!this.sessionId) return;
    const id = this.sessionId;
    this.sessionId = null;
    try {
      await this.request("DELETE", `/session/${id}`, undefined, { absolute: true });
    } catch {
      // The browser may already be gone (crashed, killed). Nothing to clean up.
    }
  }

  /** Navigates the active tab to `url`. */
  async navigate(url: string): Promise<void> {
    await this.request("POST", "/url", { url });
  }

  /** The URL currently loaded in the active tab. */
  async currentUrl(): Promise<string> {
    return this.request<string>("GET", "/url");
  }

  /** The title of the active tab. */
  async title(): Promise<string> {
    return this.request<string>("GET", "/title");
  }

  /** The full HTML of the active tab. */
  async source(): Promise<string> {
    return this.request<string>("GET", "/source");
  }

  /**
   * Runs a script in the page and returns its result.
   *
   * The script is serialised by WebDriver, so it must be self-contained: no
   * closures over module scope and no references to Node values. Pass data in
   * through `args`.
   */
  async execute<T>(script: string, args: unknown[] = []): Promise<T> {
    return this.request<T>("POST", "/execute/sync", { script, args });
  }

  /** Finds the first element matching a CSS selector. Returns null when absent. */
  async findElement(selector: string): Promise<WebDriverElement | null> {
    try {
      return await this.request<WebDriverElement>("POST", "/element", {
        using: "css selector",
        value: selector,
      });
    } catch (error) {
      // A missing element is a normal outcome, not a failure worth propagating.
      if (error instanceof WebDriverError && error.code === "no such element") {
        return null;
      }
      throw error;
    }
  }

  /** Finds every element matching a CSS selector. */
  async findElements(selector: string): Promise<WebDriverElement[]> {
    try {
      return await this.request<WebDriverElement[]>("POST", "/elements", {
        using: "css selector",
        value: selector,
      });
    } catch (error) {
      if (error instanceof WebDriverError && error.code === "no such element") {
        return [];
      }
      throw error;
    }
  }

  /** Clicks an element reference. */
  async click(element: WebDriverElement): Promise<void> {
    await this.request("POST", `/element/${this.elementId(element)}/click`, {});
  }

  /** Types text into an element reference. */
  async sendKeys(element: WebDriverElement, text: string): Promise<void> {
    await this.request("POST", `/element/${this.elementId(element)}/value`, {
      text,
    });
  }

  /** Clears an element reference's current contents. */
  async clear(element: WebDriverElement): Promise<void> {
    await this.request("POST", `/element/${this.elementId(element)}/clear`, {});
  }

  /** Reads the visible text of an element reference. */
  async elementText(element: WebDriverElement): Promise<string> {
    return this.request<string>("GET", `/element/${this.elementId(element)}/text`);
  }

  /** Sends a raw key sequence to the browser. */
  async sendKeysToActive(text: string): Promise<void> {
    await this.request("POST", "/actions", {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            {
              type: "keyDown",
              value: text,
            },
            {
              type: "keyUp",
              value: text,
            },
          ],
        },
      ],
    });
  }

  /** Returns a PNG screenshot of the active tab, as raw bytes. */
  async screenshot(): Promise<Buffer> {
    const base64 = await this.request<string>("GET", "/screenshot");
    return Buffer.from(base64, "base64");
  }

  /** All cookies visible to the current browsing context. */
  async getCookies(): Promise<WebDriverCookie[]> {
    return this.request<WebDriverCookie[]>("GET", "/cookie");
  }

  /** Adds a cookie to the current browsing context. */
  async addCookie(cookie: WebDriverCookie): Promise<void> {
    await this.request("POST", "/cookie", { cookie });
  }

  /** Removes a single cookie by name. */
  async deleteCookie(name: string): Promise<void> {
    await this.request("DELETE", `/cookie/${encodeURIComponent(name)}`);
  }

  /** Switches the active tab to a window handle. */
  async switchToWindow(handle: string): Promise<void> {
    await this.request("POST", "/window", { handle });
  }

  /** Lists the open window handles. */
  async windowHandles(): Promise<string[]> {
    return this.request<string[]>("GET", "/window/handles");
  }

  /** The handle of the currently active tab. */
  async currentWindowHandle(): Promise<string> {
    return this.request<string>("GET", "/window");
  }

  /** Sets the size of the active window. */
  async setWindowSize(width: number, height: number): Promise<void> {
    await this.request("POST", "/window/rect", { width, height });
  }

  /** Extracts the WebDriver element id from an element reference. */
  private elementId(element: WebDriverElement): string {
    const id = element["element-6066-11e4-a52e-4f735466cecf"];
    if (!id) throw new WebDriverError("Not a valid element reference", "invalid argument");
    return id;
  }

  /**
   * Issues a WebDriver command and unwraps the standard response envelope.
   *
   * Paths are session-scoped by default: `/url` becomes `/session/{id}/url`. The
   * session prefix lives here rather than at each call site so that a path
   * cannot be quietly built without it.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { absolute?: boolean } = {},
  ): Promise<T> {
    const target = options.absolute
      ? path
      : `/session/${this.requireSessionId()}${path}`;

    const response = await fetch(`${this.baseUrl}${target}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: WebDriverEnvelope<T>;
    try {
      parsed = JSON.parse(text) as WebDriverEnvelope<T>;
    } catch {
      throw new WebDriverError(
        `Malformed WebDriver response: ${text.slice(0, 200)}`,
        "unknown error",
      );
    }

    if (!response.ok || parsed.error) {
      throw new WebDriverError(
        parsed.message ??
          parsed.error ??
          `WebDriver request failed with status ${response.status}`,
        parsed.error ?? "unknown error",
        parsed.stacktrace,
      );
    }

    return parsed.value;
  }

  /** Returns the active session id, throwing when there is no session. */
  private requireSessionId(): string {
    if (!this.sessionId) {
      throw new WebDriverError(
        "No active browser session. Call start() first.",
        "invalid session id",
      );
    }
    return this.sessionId;
  }
}
