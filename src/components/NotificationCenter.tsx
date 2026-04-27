/**
 * NotificationCenter — bell icon in the header that captures async
 * events the user might miss while their tab isn't focused.
 *
 * Shape:
 *   - Persistent: notifications survive a refresh (localStorage).
 *   - Bounded: keep last 30; older entries fall off the back. We're not
 *     building an audit log — just a "what happened recently" panel.
 *   - Subscribed: listens to render.complete via the SSE event bus,
 *     plus any other useful event types we add later.
 *   - Cross-tab: storage event listener keeps badge counts in sync if
 *     the user has multiple tabs open.
 *
 * Why localStorage and not a backend feed: notifications are inherently
 * per-tab user-state ("I haven't read X yet"). The events themselves
 * already live on the backend SSE stream. Persisting unread/read here
 * keeps the API surface flat.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bell, Check, Trash2, CheckCheck, AlertTriangle, CheckCircle2,
  Info, X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppEvent } from "@/lib/eventBus";
import { useNavigate } from "react-router-dom";

export type NotificationKind = "success" | "error" | "info";

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  ts: number;          // epoch ms
  read: boolean;
  /** Optional href (hash-route) — clicking the row navigates here. */
  href?: string;
}

const KEY = "rtr_notifications_v1";
const MAX = 30;

// ── Persistence ────────────────────────────────────────────────────
function load(): Notification[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX);
  } catch { return []; }
}
function save(list: Notification[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); }
  catch { /* full / disabled */ }
}

// Module-level publisher so any code path can drop a notification.
// Components using this center subscribe via `useNotifications`.
type Listener = (list: Notification[]) => void;
const listeners = new Set<Listener>();
let cache: Notification[] = load();

function broadcast() {
  for (const l of listeners) l(cache);
}

/** Public API — call from anywhere in the app.
 *
 * Cross-tab dedupe: every open tab subscribes to the same SSE stream, so
 * a single render-finished event would otherwise create N notifications
 * (one per tab). We refuse a push whose (kind, title, body) signature
 * matches an existing entry from the last 3 seconds — long enough to
 * cover the storage-event propagation delay between tabs, short enough
 * that two genuinely-similar events in a row (e.g. two batched renders
 * finishing) still both surface. */
const DEDUPE_WINDOW_MS = 3000;
export function pushNotification(n: Omit<Notification, "id" | "ts" | "read">) {
  // Re-read from localStorage so we see notifications other tabs just
  // wrote — module-level `cache` lags by one storage event.
  cache = load();
  const sig = `${n.kind}|${n.title}|${n.body || ""}`;
  const now = Date.now();
  if (cache.some((c) => `${c.kind}|${c.title}|${c.body || ""}` === sig && now - c.ts < DEDUPE_WINDOW_MS)) {
    return;
  }
  const note: Notification = {
    ...n,
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    read: false,
  };
  cache = [note, ...cache].slice(0, MAX);
  save(cache);
  broadcast();
}

function markAllRead() {
  cache = cache.map((n) => ({ ...n, read: true }));
  save(cache);
  broadcast();
}
function markRead(id: string) {
  cache = cache.map((n) => (n.id === id ? { ...n, read: true } : n));
  save(cache);
  broadcast();
}
function remove(id: string) {
  cache = cache.filter((n) => n.id !== id);
  save(cache);
  broadcast();
}
function clearAll() {
  cache = [];
  save(cache);
  broadcast();
}

// React hook — components re-render when the cache mutates.
function useNotifications(): Notification[] {
  const [list, setList] = useState<Notification[]>(cache);
  useEffect(() => {
    listeners.add(setList);
    // Cross-tab: storage event fires in OTHER tabs when this one writes.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        cache = load();
        setList(cache);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(setList);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return list;
}

// ── Time formatting ────────────────────────────────────────────────
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Component ──────────────────────────────────────────────────────
export function NotificationCenter() {
  const list = useNotifications();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useMemo(() => list.filter((n) => !n.read).length, [list]);

  // Subscribe to backend events that should pop a notification. The
  // backend SSE bus is already established for the app — we just hook
  // onto event types the user cares about.
  useAppEvent("render.complete", (evt) => {
    const d = (evt.data || {}) as Record<string, unknown>;
    const success = Boolean(d.success);
    const postId = String(d.post_id || "");
    const diag = d.diagnostic as { title?: string; hint?: string } | null | undefined;
    if (success) {
      pushNotification({
        kind: "success",
        title: "Render finished",
        body: postId ? `Video ready for post ${postId.slice(0, 12)}…` : "Your video is ready.",
        href: "#/videos",
      });
    } else {
      pushNotification({
        kind: "error",
        title: diag?.title || "Render failed",
        body: diag?.hint || (typeof d.error === "string" ? d.error : "Check the run log for details."),
        href: "#/videos",
      });
    }
  });

  const open_ = () => setOpen(true);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={open_}
          title={unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary/60 hover:bg-secondary transition-colors",
            unread > 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bell className="h-3.5 w-3.5" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-primary text-[9px] leading-none text-primary-foreground flex items-center justify-center font-bold">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 bg-popover border-border max-h-[28rem] flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold">Notifications</span>
          <div className="flex items-center gap-1">
            {list.length > 0 && unread > 0 && (
              <button
                onClick={markAllRead}
                title="Mark all read"
                className="h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center gap-1"
              >
                <CheckCheck className="h-3 w-3" /> Mark read
              </button>
            )}
            {list.length > 0 && (
              <button
                onClick={clearAll}
                title="Clear all"
                className="h-6 px-1.5 rounded text-[10px] text-muted-foreground hover:text-destructive hover:bg-secondary flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-xs">No notifications yet</p>
              <p className="text-[10px] mt-1">Render results land here</p>
            </div>
          ) : (
            list.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  markRead(n.id);
                  if (n.href) {
                    setOpen(false);
                    // Hash routes — strip the leading '#' so navigate
                    // sees a regular path.
                    nav(n.href.replace(/^#/, ""));
                  }
                }}
                className={cn(
                  "w-full flex gap-2 px-3 py-2 text-left border-b border-border/40 hover:bg-secondary/40 transition-colors group",
                  !n.read && "bg-primary/5",
                )}
              >
                <div className="pt-0.5 shrink-0">
                  {n.kind === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                  {n.kind === "error" && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                  {n.kind === "info" && <Info className="h-3.5 w-3.5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-xs leading-tight truncate", !n.read && "font-semibold")}>
                      {n.title}
                    </p>
                    <span className="text-[9px] text-muted-foreground/80 shrink-0">
                      {relTime(n.ts)}
                    </span>
                  </div>
                  {n.body && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                      {n.body}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(n.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity self-start text-muted-foreground hover:text-destructive"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Re-export markRead/clearAll for tests + admin actions, but the
// happy-path is the popover UI above.
export { markAllRead, clearAll };
