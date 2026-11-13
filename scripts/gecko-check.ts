/**
 * Verifies the Gecko backend end to end against a local page.
 *
 * This exercises the parts of the stack that do not depend on a Muse account:
 * launching geckodriver, opening Firefox, typing, submitting with the
 * WebDriver Enter keycode, reading the result back out of the DOM, and taking
 * a screenshot.
 *
 * Run with: pnpm gecko:check
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findGeckodriver, startGeckoSession } from "@/lib/gecko/geckodriver";
import { MuseAdapter } from "@/lib/muse/muse-adapter";

/** The WebDriver keycode for Enter, matching the adapter. */
const ENTER_KEY = "\uE007";

/** A page with a composer and a reply, standing in for a chat app. */
const FIXTURE = `<!doctype html>
<html>
  <body>
    <div id="composer" contenteditable="true" role="textbox"></div>
    <div id="reply" data-message-author-role="assistant"></div>
    <script>
      const composer = document.getElementById('composer');
      const reply = document.getElementById('reply');
      composer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const text = composer.innerText.trim();
          reply.setAttribute('data-message-author-role', 'assistant');
          reply.innerText = 'ECHO:' + text;
        }
      });
    </script>
  </body>
</html>`;

async function main(): Promise<void> {
  const binary = findGeckodriver();
  if (!binary) {
    throw new Error("geckodriver not found. Install it: pacman -S geckodriver");
  }
  console.log(`geckodriver: ${binary}`);

  const profile = await mkdtemp(join(tmpdir(), "muse-gecko-check-"));
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE)}`;

  const session = await startGeckoSession({
    binary,
    session: {
      binary: "/usr/lib/firefox/firefox",
      profile,
      headless: true,
      windowSize: { width: 1280, height: 800 },
    },
  });

  try {
    const caps = session.driver.sessionCapabilities;
    console.log("browser:", caps.browserName, caps.browserVersion);
    console.log("geckodriver:", caps["moz:geckodriverVersion"]);
    console.log("headless:", caps["moz:headless"]);

    await session.driver.navigate(dataUrl);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const composer = await session.driver.findElement("#composer");
    if (!composer) throw new Error("fixture composer not found");

    await session.driver.click(composer);
    await session.driver.sendKeys(composer, "hello muse");
    const typed = await session.driver.execute<string>(
      "return document.getElementById('composer').innerText;",
    );
    console.log("typed:", JSON.stringify(typed));

    await session.driver.sendKeys(composer, ENTER_KEY);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const reply = await session.driver.execute<string>(
      "return document.getElementById('reply').innerText;",
    );
    console.log("reply:", JSON.stringify(reply));

    if (reply !== "ECHO:hello muse") {
      throw new Error(`Enter did not submit the composer (got ${JSON.stringify(reply)})`);
    }

    const shot = await session.driver.screenshot();
    console.log("screenshot bytes:", shot.length);
    if (shot.length < 1000) throw new Error("screenshot looks empty");

    // The adapter's own inspect() path, against the same fixture.
    const adapter = new MuseAdapter(session.driver);
    const state = await adapter.inspect();
    console.log(
      "inspect:",
      JSON.stringify({ hasComposer: state.hasComposer, messageCount: state.messageCount }),
    );

    console.log("\nGECKO BACKEND OK");
  } finally {
    await session.dispose();
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("GECKO BACKEND FAILED:", error);
  process.exit(1);
});
