import { getSessionManager } from "@/lib/session";

/** The request body accepted by the chat endpoint. */
interface ChatRequest {
  /** The prompt to send to Muse. */
  message?: string;
}

/**
 * Sends a prompt to Muse and streams the reply back.
 *
 * The reply is delivered as Server-Sent Events rather than one JSON body,
 * because Muse's answer arrives incrementally and the user should see it as it
 * is written rather than after the whole turn completes.
 */
export async function POST(request: Request): Promise<Response> {
  const manager = getSessionManager();

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "A message is required" }, { status: 400 });
  }

  const adapter = manager.muse;
  if (!adapter) {
    return Response.json(
      { error: "No browser session. Start one before sending a message." },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /** Writes one SSE event. */
      const send = (event: string, data: unknown): void => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        send("start", { message });

        const reply = await adapter.ask(message, {
          onDelta: (text) => send("delta", { text }),
        });

        send("done", { text: reply });
      } catch (error) {
        manager.recordError(error);
        send("error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
