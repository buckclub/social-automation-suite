/**
 * Frontend half of the SSE event bus.
 *
 * Replaces the polling intervals on Videos / Calendar / Social Queue /
 * Comment Replier with a single push connection. One EventSource lives
 * for the lifetime of the tab; components subscribe to event types
 * they care about and (typically) call `queryClient.invalidateQueries`
 * in response.
 *
 * Why we wrote this from scratch instead of using a library:
 *
 * - We have ONE long-lived stream per tab. A library's pub/sub layer
 *   would be net negative — the whole thing is ~80 lines.
 * - Auto-reconnect: the browser does this for us at the EventSource
 *   level. We just re-attach the handlers when readyState flips.
 * - Hot-reload safety: in dev, vite-HMR reloads modules but tab state
 *   persists. The singleton check (`globalThis.__appEventBus`) keeps a
 *   single connection across HMR boundaries — otherwise dev sessions
 *   leak EventSources every time you save a file.
 *
 * Usage:
 *
 *   useAppEvent("run_queue.update", () => {
 *     queryClient.invalidateQueries({ queryKey: ["run-queue"] });
 *   });
 *
 *   useAppEvent(
 *     ["social_queue.update", "render.complete"],
 *     evt => { ... }
 *   );
 */
import { useEffect } from "react";

type EventHandler = (evt: AppEvent) => void;

export interface AppEvent {
  type: string;
  ts:   string;
  data: Record<string, unknown>;
}

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

interface BusState {
  source:    EventSource | null;
  handlers:  Map<string, Set<EventHandler>>;   // type → handlers
  open:      boolean;
}

// Module-level singleton shared across HMR reloads. Without the global
// check, every code change in a watched file would spawn a new
// EventSource and the dev backend would tip over after 50 saves.
const G = globalThis as typeof globalThis & { __appEventBus?: BusState };
if (!G.__appEventBus) {
  G.__appEventBus = { source: null, handlers: new Map(), open: false };
}
const state = G.__appEventBus;

function ensureConnected() {
  if (state.source && state.source.readyState !== EventSource.CLOSED) return;

  // Explicitly close the prior source if it's in CLOSED state. The
  // browser usually GCs it for us, but during transient errors it can
  // sit around still holding listeners — and if we're going to drop
  // the reference anyway, an explicit close() is cheap insurance.
  if (state.source) {
    try { state.source.close(); } catch { /* already closed */ }
  }

  const es = new EventSource(`${API_BASE}/api/events`);
  state.source = es;
  state.open = false;

  es.addEventListener("open", () => { state.open = true; });
  es.addEventListener("error", () => {
    // Browser will auto-reconnect. Mark closed so subscribers can show
    // a 'reconnecting' indicator if they want to.
    state.open = false;
  });

  // The backend emits `event: <type>` lines, so we attach a single
  // generic 'message' handler PLUS the named ones (only triggered if a
  // listener was added by name). The simplest path: have one
  // 'fallback' handler per known type, registered lazily as the first
  // subscriber of a given type comes in.
  //
  // EventSource collapses different `event:` lines into separate
  // listeners — there's no broadcast. So we maintain our own type
  // listener registration mirror.
  for (const t of state.handlers.keys()) {
    attachNamedListener(es, t);
  }
}

function attachNamedListener(es: EventSource, type: string) {
  // Mark the listener attached so we don't double-register on reconnect.
  const flag = `__attached_${type}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((es as any)[flag]) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (es as any)[flag] = true;

  es.addEventListener(type, (raw: MessageEvent) => {
    let parsed: AppEvent;
    try {
      parsed = JSON.parse(raw.data) as AppEvent;
    } catch {
      return;
    }
    const set = state.handlers.get(type);
    if (!set) return;
    // Snapshot copy so a handler unsubscribing during dispatch doesn't
    // mutate the iterator.
    for (const h of Array.from(set)) {
      try { h(parsed); } catch (e) { console.error("[event-bus]", type, e); }
    }
  });
}

export function subscribe(type: string, handler: EventHandler): () => void {
  let set = state.handlers.get(type);
  if (!set) {
    set = new Set();
    state.handlers.set(type, set);
  }
  set.add(handler);

  ensureConnected();
  if (state.source) attachNamedListener(state.source, type);

  return () => {
    set!.delete(handler);
    if (set!.size === 0) state.handlers.delete(type);
  };
}

/**
 * React hook — subscribe for the lifetime of the component.
 *
 * `types` accepts a single string or an array. Use a stable `handler`
 * (useCallback) if it captures values you care about; the hook
 * re-subscribes when the handler reference changes.
 */
export function useAppEvent(types: string | string[], handler: EventHandler) {
  useEffect(() => {
    const list = Array.isArray(types) ? types : [types];
    const unsubs = list.map(t => subscribe(t, handler));
    return () => { unsubs.forEach(u => u()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(types) ? types.join("|") : types, handler]);
}

/** Returns whether the SSE connection is currently open. Lightweight,
 * read-only — for showing a 'live' / 'reconnecting' badge. */
export function isLiveConnected(): boolean {
  return Boolean(state.open);
}
