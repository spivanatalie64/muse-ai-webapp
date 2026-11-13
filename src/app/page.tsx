"use client";

import { useEffect, useRef, useState } from "react";

/** One turn in the conversation. */
interface Turn {
  /** Who produced the text. */
  role: "user" | "muse";
  /** The text itself. */
  text: string;
}

/** The status payload returned by the session endpoint. */
interface SessionStatus {
  running: boolean;
  signedIn: boolean | null;
  browserVersion: string | null;
  geckodriverVersion: string | null;
  headed: boolean;
  lastError: string | null;
}

/** How often the live browser view refreshes, in milliseconds. */
const SCREENSHOT_INTERVAL_MS = 1500;

/**
 * The application shell: a chat pane on the left, the live Gecko session on
 * the right.
 *
 * The browser view is not decoration. Muse does real work in the browser, and
 * the ability to watch it and take over is the difference between trusting an
 * agent and watching one work.
 */
export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const screenshotRef = useRef<HTMLImageElement>(null);

  /** Refreshes the session status. */
  const refreshStatus = async (): Promise<void> => {
    try {
      const response = await fetch("/api/session");
      if (response.ok) setStatus((await response.json()) as SessionStatus);
    } catch {
      // The server may be restarting; the next poll will recover.
    }
  };

  /**
   * Keeps the live browser view current.
   *
   * The screenshot is fetched as a blob and swapped into the image element
   * with a cache-busting key, because the endpoint must never be cached.
   */
  useEffect(() => {
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;

      try {
        const response = await fetch(`/api/screenshot?t=${Date.now()}`);
        if (response.ok) {
          const blob = await response.blob();
          if (!cancelled && screenshotRef.current) {
            const previous = screenshotRef.current.src;
            screenshotRef.current.src = URL.createObjectURL(blob);
            if (previous.startsWith("blob:")) URL.revokeObjectURL(previous);
          }
        }
      } catch {
        // A missing session is the normal case before the browser is started.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), SCREENSHOT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status?.running]);

  /** Polls session status while the page is open. */
  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 3000);
    return () => clearInterval(timer);
  }, []);

  /** Keeps the transcript scrolled to the newest message. */
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  /** Starts the browser session and opens Muse. */
  const startSession = async (): Promise<void> => {
    setError(null);
    setStatus({ ...(status ?? emptyStatus()), running: true });

    const response = await fetch("/api/session", { method: "POST" });
    const body = (await response.json()) as Partial<SessionStatus> & {
      error?: string;
    };

    if (body.error) setError(body.error);
    else setStatus(body as SessionStatus);
  };

  /** Sends the drafted prompt and streams Muse's reply. */
  const send = async (): Promise<void> => {
    const message = draft.trim();
    if (!message || streaming) return;

    setDraft("");
    setError(null);
    setStreaming(true);
    setTurns((current) => [...current, { role: "user", text: message }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The chat request failed");
      }

      // Parse the SSE stream by hand. The browser's EventSource cannot POST,
      // and the request body carries the prompt.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const event = parseSseChunk(chunk);
          if (!event) continue;

          if (event.event === "delta") {
            const { text } = event.data as { text: string };
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last && last.role === "muse") {
                next[next.length - 1] = { ...last, text };
              } else {
                next.push({ role: "muse", text });
              }
              return next;
            });
          } else if (event.event === "done") {
            const { text } = event.data as { text: string };
            setTurns((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last && last.role === "muse") {
                next[next.length - 1] = { ...last, text };
              } else {
                next.push({ role: "muse", text });
              }
              return next;
            });
          } else if (event.event === "error") {
            const { message } = event.data as { message: string };
            setError(message);
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStreaming(false);
      void refreshStatus();
    }
  };

  const ready = status?.running && status.signedIn;

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">
          <span className="text-muse-pink">Muse</span>{" "}
          <span className="text-muse-blue">AI Webapp</span>
        </h1>

        <div className="flex items-center gap-2 text-xs text-slate-400 ml-auto flex-wrap">
          <span
            className={`px-2 py-1 rounded-full border ${
              status?.running
                ? "border-green-700 text-green-400"
                : "border-slate-700 text-slate-500"
            }`}
          >
            {status?.running
              ? `Gecko ${status.browserVersion ?? "?"}`
              : "browser stopped"}
          </span>

          {status?.running && (
            <span className="px-2 py-1 rounded-full border border-slate-700 text-slate-400">
              geckodriver {status.geckodriverVersion ?? "?"}
            </span>
          )}

          {status?.running && (
            <span
              className={`px-2 py-1 rounded-full border ${
                status.signedIn
                  ? "border-blue-800 text-blue-400"
                  : "border-amber-800 text-amber-400"
              }`}
            >
              {status.signedIn ? "signed in" : "not signed in"}
            </span>
          )}

          <button
            onClick={() => void startSession()}
            disabled={status?.running}
            className="px-3 py-1 rounded-full border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start browser
          </button>
        </div>
      </header>

      {error && (
        <div className="px-4 sm:px-6 py-2 bg-red-950/60 border-b border-red-900 text-sm text-red-300">
          {error}
        </div>
      )}

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
        <section className="flex flex-col min-h-0 border-r border-slate-800">
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4"
          >
            {turns.length === 0 && (
              <p className="text-sm text-slate-500">
                Start the browser, sign in to Muse if needed, then send a prompt.
              </p>
            )}

            {turns.map((turn, index) => (
              <div
                key={index}
                className={turn.role === "user" ? "flex justify-end" : ""}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    turn.role === "user"
                      ? "bg-muse-blue text-slate-900"
                      : "bg-slate-900 text-slate-100 border border-slate-800"
                  }`}
                >
                  {turn.text}
                </div>
              </div>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="border-t border-slate-800 p-4 sm:p-6 flex gap-3 items-end"
          >
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={ready ? "Ask Muse something…" : "Start the browser first"}
              disabled={!ready || streaming}
              className="flex-1 resize-none rounded-xl bg-slate-900 border border-slate-800 px-4 py-3 text-sm outline-none focus:border-slate-600 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!ready || streaming || !draft.trim()}
              className="rounded-xl bg-muse-pink text-slate-900 px-5 py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {streaming ? "Thinking…" : "Send"}
            </button>
          </form>
        </section>

        <section className="hidden lg:flex flex-col min-h-0 bg-slate-950">
          <div className="px-4 py-2 border-b border-slate-800 text-xs text-slate-500">
            Live Gecko session
          </div>
          <div className="flex-1 overflow-hidden p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={screenshotRef}
              alt="Live view of the Firefox session driving Muse"
              className="w-full h-full object-contain"
            />
          </div>
        </section>
      </main>
    </div>
  );
}

/** A blank status, used before the first fetch resolves. */
function emptyStatus(): SessionStatus {
  return {
    running: false,
    signedIn: null,
    browserVersion: null,
    geckodriverVersion: null,
    headed: false,
    lastError: null,
  };
}

/** A parsed Server-Sent Event. */
interface SseEvent {
  event: string;
  data: unknown;
}

/** Parses one `event:`/`data:` block of an SSE stream. */
function parseSseChunk(chunk: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
