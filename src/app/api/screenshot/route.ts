import { getSessionManager } from "@/lib/session";

/**
 * A live screenshot of the Gecko session.
 *
 * Returning the PNG directly means the browser can poll it as an image
 * source, which is how the UI shows the user what Muse is doing and lets them
 * take over.
 */
export async function GET(): Promise<Response> {
  const manager = getSessionManager();
  const adapter = manager.muse;

  if (!adapter) {
    return Response.json(
      { error: "No browser session running" },
      { status: 409 },
    );
  }

  try {
    const png = await adapter.webDriver.screenshot();

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    manager.recordError(error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
