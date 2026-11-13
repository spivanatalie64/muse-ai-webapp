/**
 * Selector strategies for locating Muse's chat UI.
 *
 * Muse has no public API, so the only way to talk to it is through the page it
 * renders. That means the adapter depends on Muse's DOM, which Meta ships and
 * changes without notice, and which we cannot fully verify without an account.
 *
 * Two consequences shape this file:
 *
 * 1. Every lookup has several candidates, tried in order, so that a single class
 *    name change does not break the app.
 * 2. The candidates live here, in one place, overridable from the environment.
 *    When Muse's markup moves, the fix is a config change rather than a code
 *    change, and the diagnostics endpoint can show what the page actually looks
 *    like at the time.
 */

/** CSS selectors tried in order when looking for the message composer. */
export const COMPOSER_SELECTORS = [
  // The rich-text editor Muse renders for chat input.
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea[data-slot="textarea"]',
  'textarea[placeholder]',
  'textarea',
  '[role="textbox"]:not(input)',
] as const;

/** CSS selectors tried in order when locating a single chat message block. */
export const MESSAGE_SELECTORS = [
  '[data-message-author-role]',
  '[data-role="message"]',
  '[data-testid*="message"]',
  'article[data-message-id]',
  '[class*="Message"]',
  '[class*="message"]',
] as const;

/** CSS selectors that identify the composer, used to exclude it from messages. */
export const COMPOSER_GUARD_SELECTORS = [
  '[contenteditable="true"]',
  'textarea',
] as const;

/** The selector used for the login form's identifier field, when present. */
export const LOGIN_FIELD_SELECTOR = 'input[aria-label="Mobile number or email"]';

/**
 * Reads a comma-separated selector list from the environment.
 *
 * This exists so a Muse markup change can be worked around without a deploy.
 */
function selectorsFromEnv(variable: string, fallback: readonly string[]): string[] {
  const raw = process.env[variable];
  if (!raw) return [...fallback];

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : [...fallback];
}

/** The composer selectors in effect for this process. */
export function composerSelectors(): string[] {
  return selectorsFromEnv("MUSE_COMPOSER_SELECTORS", COMPOSER_SELECTORS);
}

/** The message selectors in effect for this process. */
export function messageSelectors(): string[] {
  return selectorsFromEnv("MUSE_MESSAGE_SELECTORS", MESSAGE_SELECTORS);
}
