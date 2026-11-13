import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

import { FirefoxDriver, type FirefoxSessionOptions } from "./firefox-driver";

/** How long to wait for geckodriver to report itself ready, in milliseconds. */
const READY_TIMEOUT_MS = 20_000;

/** How long to wait between readiness polls, in milliseconds. */
const READY_POLL_MS = 200;

/** Options for starting a managed geckodriver process. */
export interface GeckodriverOptions {
  /** Path to the geckodriver binary. */
  binary: string;
  /** Port for geckodriver to listen on. Use 0 to pick a free port. */
  port?: number;
  /** Host geckodriver binds to. Loopback only by default. */
  host?: string;
}

/** A geckodriver process under management, plus the Firefox session it hosts. */
export interface GeckoSession {
  /** The WebDriver client for the Firefox instance. */
  driver: FirefoxDriver;
  /** The base URL geckodriver is listening on. */
  baseUrl: string;
  /** Terminates geckodriver and the browser it hosts. */
  dispose(): Promise<void>;
}

/** Locates geckodriver, preferring an explicit path then the usual install locations. */
export function findGeckodriver(explicit?: string): string | null {
  const candidates = [
    explicit,
    "/usr/bin/geckodriver",
    "/usr/local/bin/geckodriver",
    "/opt/homebrew/bin/geckodriver",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/** Picks a free TCP port by binding to port 0 and reading back the assignment. */
export async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");

  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

/**
 * Starts geckodriver and opens a Firefox session through it.
 *
 * geckodriver is spawned rather than assumed to be running so that each browser
 * session owns its own port, its own lifetime, and its own failure domain. A
 * crashed browser takes down only its own geckodriver.
 */
export async function startGeckoSession(
  options: GeckodriverOptions & { session?: FirefoxSessionOptions },
): Promise<GeckoSession> {
  const port = options.port ?? (await findFreePort());
  const host = options.host ?? "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  const child: ChildProcess = spawn(
    options.binary,
    ["--port", String(port), "--host", host, "--log", "warn"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    // geckodriver is noisy about benign conditions (favicon MIME errors), so we
    // keep a bounded tail for diagnostics instead of logging every line.
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  const exited = new Promise<never>((_, reject) => {
    child.on("exit", (code) => {
      reject(
        new Error(
          `geckodriver exited unexpectedly with code ${code}.${stderr ? `\n${stderr}` : ""}`,
        ),
      );
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to spawn geckodriver: ${error.message}`));
    });
  });

  await Promise.race([waitForReady(baseUrl), exited]);

  const driver = new FirefoxDriver(baseUrl, options.session);
  await driver.start();

  return {
    driver,
    baseUrl,
    async dispose() {
      await driver.stop();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
      }
    },
  };
}

/** Polls geckodriver's status endpoint until it reports ready. */
async function waitForReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/status`);
      if (response.ok) {
        const body = (await response.json()) as { value?: { ready?: boolean } };
        if (body.value?.ready) return;
      }
    } catch {
      // geckodriver is not listening yet. Keep waiting.
    }

    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`geckodriver did not become ready within ${READY_TIMEOUT_MS}ms`);
}
