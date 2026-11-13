import { NextResponse } from "next/server";

import { getSessionManager } from "@/lib/session";

/** The status of the browser session, as shown in the UI header. */
export async function GET(): Promise<NextResponse> {
  const manager = getSessionManager();
  const status = await manager.status();

  return NextResponse.json(status);
}

/**
 * Starts the browser session and opens Muse.
 *
 * The browser is headed when the app is configured for headed operation, which
 * is what lets the user complete an interactive sign-in.
 */
export async function POST(): Promise<NextResponse> {
  const manager = getSessionManager();

  try {
    await manager.start();

    const adapter = manager.muse;
    if (adapter) {
      await adapter.open();
    }

    return NextResponse.json(await manager.status());
  } catch (error) {
    manager.recordError(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** Stops the browser session. */
export async function DELETE(): Promise<NextResponse> {
  const manager = getSessionManager();
  await manager.stop();
  return NextResponse.json(await manager.status());
}
