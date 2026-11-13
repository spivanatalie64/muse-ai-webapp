import { getSessionManager } from "@/lib/session";

/**
 * Reports what the Muse page currently looks like to the adapter.
 *
 * Muse ships its own markup and changes it without notice, and the adapter
 * depends on that markup. This endpoint is how a breakage is diagnosed: it
 * shows which selectors matched, what the page title and URL are, and what
 * candidate messages were found, so the fix can be made without guessing or
 * reading server logs.
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
    const state = await adapter.inspect();

    return Response.json({
      ...state,
      // Message bodies are truncated here; the full text is available in the
      // chat transcript and this endpoint is for structure, not content.
      messageTexts: state.messageTexts.map((text) => text.slice(0, 120)),
    });
  } catch (error) {
    manager.recordError(error);
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
