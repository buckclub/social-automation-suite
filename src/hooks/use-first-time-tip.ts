/**
 * useFirstTimeTip — fire a toast exactly once per browser, ever.
 *
 * Used to surface contextual hints the first time a user lands on a
 * page or feature. Each tip has a unique `id` that gets written to
 * localStorage on dismiss so it never fires again.
 *
 *   useFirstTimeTip({
 *     id: "posts-page-score-with-ai",
 *     title: "Tip: try Score with AI",
 *     description:
 *       "Click 'Score with AI' before sorting by AI to populate scores. " +
 *       "Otherwise the AI sort returns posts in arbitrary order.",
 *   });
 *
 * The reset utility is exposed so a "show all tips again" button (e.g.
 * on the guide page) can wipe the seen-set without clearing the rest
 * of localStorage.
 */
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

const KEY = "rtr_first_time_tips_seen";

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(seen)));
  } catch {
    /* localStorage full or disabled — silently degrade. */
  }
}

interface TipOptions {
  id: string;
  title: string;
  description: string;
  /** When false, suppress the tip entirely (useful for conditional tips
   *  that depend on app state that hasn't loaded yet). Defaults true. */
  enabled?: boolean;
  /** Milliseconds to delay so the page paints before the toast pops. */
  delayMs?: number;
}

export function useFirstTimeTip(opts: TipOptions) {
  const { toast } = useToast();

  useEffect(() => {
    if (opts.enabled === false) return;
    const seen = loadSeen();
    if (seen.has(opts.id)) return;

    const handle = window.setTimeout(() => {
      // Re-check inside the timeout — another mount could have fired
      // first if the same tip is requested by two pages simultaneously.
      const fresh = loadSeen();
      if (fresh.has(opts.id)) return;
      fresh.add(opts.id);
      saveSeen(fresh);

      toast({
        title: opts.title,
        description: opts.description,
        // 8s — long enough to read a 2-sentence tip without rushing,
        // short enough that it doesn't linger if the user ignored it.
        duration: 8000,
      });
    }, opts.delayMs ?? 600);

    return () => window.clearTimeout(handle);
    // We deliberately depend only on the id — changing the title
    // shouldn't re-fire the tip if it's already been seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id, opts.enabled]);
}

/** Wipe the seen-set so every first-time tip fires again. Used by the
 *  "Reset tips" button in /guide. Safe to call multiple times. */
export function resetFirstTimeTips() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Read-only — for showing "X of Y tips seen" on the guide page. */
export function countSeenTips(): number {
  return loadSeen().size;
}
