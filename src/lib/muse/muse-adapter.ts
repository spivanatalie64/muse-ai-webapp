import type { FirefoxDriver, WebDriverElement } from "@/lib/gecko/firefox-driver";

import {
  composerSelectors,
  LOGIN_FIELD_SELECTOR,
  messageSelectors,
} from "./selectors";

/** The Muse origin the app drives. */
export const MUSE_ORIGIN = "https://muse.ai";

/**
 * The WebDriver key code for Enter.
 *
 * WebDriver sends key codes from the Unicode private use area, not literal
 * characters, so a newline in a string will not submit the composer.
 */
const ENTER_KEY = "\uE007";

/** A snapshot of what the page currently offers, used for diagnostics. */
export interface MusePageState {
  /** Whether a composer was found. */
  hasComposer: boolean;
  /** Whether the logged-out login field was found. */
  hasLoginField: boolean;
  /** The page title. */
  title: string;
  /** The current URL. */
  url: string;
  /** Text of every candidate message, oldest first. */
  messageTexts: string[];
  /** How many candidate message elements were found. */
  messageCount: number;
}

/**
 * A page-side script that describes the chat UI.
 *
 * Written as a self-contained function body because WebDriver serialises the
 * script and evaluates it in the page: it cannot close over module scope, so
 * every input arrives through `arguments`.
 */
const INSPECT_PAGE = `
const composerSels = arguments[0];
const messageSels = arguments[1];
const loginSel = arguments[2];

const visible = (el) => {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const composer = composerSels
  .map((s) => { try { return document.querySelector(s); } catch (e) { return null; } })
  .find((el) => visible(el)) || null;

const loginField = document.querySelector(loginSel);

// Candidate messages: prefer explicit selectors, then fall back to any element
// that looks like a content block. The fallback exists so a class-name change
// in Muse's bundle degrades the adapter instead of breaking it.
let candidates = [];
for (const sel of messageSels) {
  try {
    const found = Array.from(document.querySelectorAll(sel));
    if (found.length) { candidates = found; break; }
  } catch (e) {}
}
if (!candidates.length) {
  // Structural fallback: elements with text but no element children of their own
  // are leaf content blocks, which is what a rendered message usually is.
  candidates = Array.from(document.querySelectorAll('div, p, li, span')).filter((el) => {
    if (!visible(el)) return false;
    if (composer && (composer === el || composer.contains(el))) return false;
    const hasElementChild = Array.from(el.children).some((c) => (c.innerText || '').trim().length > 0);
    if (hasElementChild) return false;
    return (el.innerText || '').trim().length > 0;
  });
}

const texts = candidates
  .map((el) => (el.innerText || '').trim())
  .filter((t) => t.length > 0);

return {
  hasComposer: !!composer,
  hasLoginField: !!loginField,
  title: document.title,
  url: location.href,
  messageTexts: texts,
  messageCount: candidates.length,
};
`;

/**
 * Drives the Muse web app in a Firefox session.
 *
 * Muse exposes no public API — every consumer endpoint answers `401` without an
 * authenticated session — so the page is the only interface available. The
 * adapter therefore reads what the page has already rendered rather than
 * speaking a private protocol.
 */
export class MuseAdapter {
  constructor(private readonly driver: FirefoxDriver) {}

  /** The WebDriver client backing this adapter, for screenshots and raw access. */
  get webDriver(): FirefoxDriver {
    return this.driver;
  }

  /** Opens the Muse web app and waits for it to settle. */
  async open(): Promise<void> {
    await this.driver.navigate(MUSE_ORIGIN);
    await this.waitForLoad();
  }

  /** Waits for the document to finish loading. */
  async waitForLoad(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = await this.driver.execute<string>("return document.readyState;");
      if (state === "complete") return;
      await this.sleep(200);
    }

    throw new Error("Muse did not finish loading in time");
  }

  /**
   * Describes what the page currently offers.
   *
   * Used both to decide whether the session is authenticated and to power the
   * diagnostics endpoint, which is how a Muse markup change gets diagnosed
   * without reading server logs.
   */
  async inspect(): Promise<MusePageState> {
    return this.driver.execute<MusePageState>(INSPECT_PAGE, [
      composerSelectors(),
      messageSelectors(),
      LOGIN_FIELD_SELECTOR,
    ]);
  }

  /**
   * Whether the browser holds a signed-in Muse session.
   *
   * The logged-out landing page shows an identifier field; the signed-in app
   * shows a composer instead.
   */
  async isSignedIn(): Promise<boolean> {
    const state = await this.inspect();
    return state.hasComposer && !state.hasLoginField;
  }

  /** Locates the message composer, if it is present. */
  async findComposer(): Promise<WebDriverElement | null> {
    for (const selector of composerSelectors()) {
      const element = await this.driver.findElement(selector);
      if (element) return element;
    }
    return null;
  }

  /**
   * Sends a prompt to Muse and returns the reply.
   *
   * The reply is produced by polling the rendered transcript, so it is returned
   * once the text stops growing rather than the instant it is complete.
   */
  async ask(
    prompt: string,
    options: { onDelta?: (text: string) => void; timeoutMs?: number } = {},
  ): Promise<string> {
    const { onDelta, timeoutMs = 180_000 } = options;

    const composer = await this.findComposer();
    if (!composer) {
      throw new Error(
        "No composer found. The browser is probably not signed in to Muse.",
      );
    }

    const before = await this.inspect();
    const previousReply = before.messageTexts.length
      ? before.messageTexts[before.messageTexts.length - 1]
      : null;

    await this.driver.click(composer);
    await this.driver.sendKeys(composer, prompt);
    await this.pressEnter(composer);

    return this.waitForReply(previousReply, prompt, onDelta, timeoutMs);
  }

  /**
   * Presses Enter in the composer.
   *
   * Sent to the element rather than the page so the keystroke lands in the
   * field the user typed into, which matters because Muse's composer can move
   * focus when it re-renders.
   */
  private async pressEnter(composer: WebDriverElement): Promise<void> {
    await this.driver.sendKeys(composer, ENTER_KEY);
  }

  /**
   * Polls the transcript until the reply stops changing.
   *
   * Muse streams its answer into the DOM. We cannot see the private WebSocket
   * protocol, so we watch the rendered text grow and report each increment,
   * which gives the caller the same experience as a streaming API.
   *
   * The prompt we just sent is excluded from consideration, otherwise the
   * transcript's echo of the user's own message would be mistaken for the
   * reply and the app would return the question back to the user.
   */
  async waitForReply(
    previousReply: string | null,
    prompt: string,
    onDelta?: (text: string) => void,
    timeoutMs = 180_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    const promptText = prompt.trim();

    let current = "";
    let stableFor = 0;
    let lastEmitted = "";

    while (Date.now() < deadline) {
      const state = await this.inspect();

      const candidates = state.messageTexts.filter((text) => text !== promptText);
      const latest = candidates.length ? candidates[candidates.length - 1] : "";

      if (latest.length > current.length) {
        stableFor = 0;
        current = latest;

        if (onDelta && current.length > lastEmitted.length) {
          onDelta(current);
          lastEmitted = current;
        }
      } else if (latest !== current) {
        // The transcript was rewritten rather than appended to, which happens
        // when Muse re-renders a message it had already streamed.
        stableFor = 0;
        current = latest;

        if (onDelta) {
          onDelta(current);
          lastEmitted = current;
        }
      } else {
        stableFor += 1;
      }

      // Two consecutive stable polls mean the reply has finished arriving.
      // `previousReply` guards against returning the last reply of a previous
      // turn when the new reply has not started arriving yet.
      if (
        stableFor >= 2 &&
        current.length > 0 &&
        current !== previousReply
      ) {
        return current;
      }

      await this.sleep(400);
    }

    if (current.length > 0 && current !== previousReply) return current;

    throw new Error("Muse did not produce a reply in time");
  }

  /** Sleeps for a number of milliseconds. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
