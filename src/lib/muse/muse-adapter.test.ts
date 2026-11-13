import { describe, expect, it } from "vitest";

import type { FirefoxDriver } from "@/lib/gecko/firefox-driver";
import { MuseAdapter } from "@/lib/muse/muse-adapter";

/**
 * A stand-in for the browser that replays a scripted transcript.
 *
 * The adapter only needs `execute` to describe the page, so the fake
 * implements just that and returns whatever the script says the page holds.
 */
class FakeDriver {
  constructor(private readonly script: (() => string[]) | null = null) {}

  async execute<T>(_script: string, _args: unknown[] = []): Promise<T> {
    const texts = this.script ? this.script() : [];
    return {
      hasComposer: true,
      hasLoginField: false,
      title: "Muse",
      url: "https://muse.ai/",
      messageTexts: texts,
      messageCount: texts.length,
    } as T;
  }
}

/** Builds an adapter over a scripted transcript. */
function adapterOver(script: () => string[]): MuseAdapter {
  return new MuseAdapter(new FakeDriver(script) as unknown as FirefoxDriver);
}

describe("MuseAdapter.waitForReply", () => {
  it("returns the reply once the transcript stops growing", async () => {
    const frames = [["REPLY: hi"]];
    const adapter = adapterOver(() => frames[frames.length - 1]);

    const promise = adapter.waitForReply(null, "hi");
    // Let the adapter observe the first frame before the reply settles.
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["REPLY: hi there"]);

    const reply = await promise;
    expect(reply).toBe("REPLY: hi there");
  });

  it("does not mistake the echoed prompt for the reply", async () => {
    // The transcript echoes what the user sent, then Muse answers. Returning
    // the echo would mean the app hands the question straight back.
    const frames = [["what is the weather?"]];
    const adapter = adapterOver(() => frames[frames.length - 1]);

    const promise = adapter.waitForReply(null, "what is the weather?");
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["what is the weather?", "It is 22 degrees."]);

    const reply = await promise;
    expect(reply).toBe("It is 22 degrees.");
  });

  it("does not return the previous turn's reply while a new one is pending", async () => {
    const frames = [["older reply"]];
    const adapter = adapterOver(() => frames[frames.length - 1]);

    const promise = adapter.waitForReply("older reply", "next question");
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["older reply", "next question"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["older reply", "next question", "fresh reply"]);

    const reply = await promise;
    expect(reply).toBe("fresh reply");
  });

  it("reports each increment of the reply as it streams", async () => {
    const frames = [["partial"]];
    const adapter = adapterOver(() => frames[frames.length - 1]);

    const deltas: string[] = [];
    const promise = adapter.waitForReply(null, "hi", (text) => deltas.push(text));
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["partial and growing"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    frames.push(["partial and growing more"]);

    await promise;

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.at(-1)).toBe("partial and growing more");
  });

  it("times out rather than hanging when Muse never answers", async () => {
    const adapter = adapterOver(() => ["only the echo"]);
    const prompt = "only the echo";

    await expect(
      adapter.waitForReply(null, prompt, undefined, 1_500),
    ).rejects.toThrow(/did not produce a reply/);
  });
});
