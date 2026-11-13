import { describe, expect, it } from "vitest";

import {
  COMPOSER_SELECTORS,
  composerSelectors,
  messageSelectors,
} from "@/lib/muse/selectors";

describe("Muse selectors", () => {
  it("provides composer candidates that cover a rich-text composer", () => {
    // Muse's composer is a rich-text editor, not a plain textarea, so a
    // contenteditable candidate has to be present or the adapter cannot type.
    expect(COMPOSER_SELECTORS.some((s) => s.includes("contenteditable"))).toBe(
      true,
    );
  });

  it("orders composer candidates so the richest match is tried first", () => {
    expect(composerSelectors()[0]).toContain("contenteditable");
  });

  it("falls back to the built-in list when the environment does not override it", () => {
    delete process.env.MUSE_COMPOSER_SELECTORS;
    expect(composerSelectors()).toEqual([...COMPOSER_SELECTORS]);
  });

  it("honours a comma-separated environment override", () => {
    process.env.MUSE_COMPOSER_SELECTORS = "textarea, [role=textbox] ,";
    expect(composerSelectors()).toEqual(["textarea", "[role=textbox]"]);

    delete process.env.MUSE_COMPOSER_SELECTORS;
  });

  it("ignores an empty environment override rather than matching nothing", () => {
    process.env.MUSE_MESSAGE_SELECTORS = " , , ";
    expect(messageSelectors().length).toBeGreaterThan(0);

    delete process.env.MUSE_MESSAGE_SELECTORS;
  });
});
