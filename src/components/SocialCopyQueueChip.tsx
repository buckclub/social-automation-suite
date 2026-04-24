import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Loader2, CheckCircle2, XCircle, Trash2, ChevronUp, ChevronDown,
} from "lucide-react";
import { api, type SocialQueueItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

/**
 * Floating status chip for the Social Copy batch queue. Auto-hides when
 * there's nothing queued, running, or recently finished. Clicking the
 * chip expands a small popover listing the items with cancel buttons
 * for queued rows and error text for failed rows.
 *
 * Polls /api/social/queue every 2 s while visible. Rendering is global
 * (mounted once from the app shell) so the indicator persists as the
 * user navigates between pages while the worker grinds.
 */
export function SocialCopyQueueChip() {
  const { toast } = useToast();
  const [items, setItems] = useState<SocialQueueItem[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    try {
      const r = await api.getSocialQueue();
      setItems(r.items || []);
    } catch { /* server down — silently hide */ }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2_000);
    return () => clearInterval(t);
  }, []);

  const queued  = items.filter((it) => it.status === "queued").length;
  const running = items.filter((it) => it.status === "running").length;
  const done    = items.filter((it) => it.status === "done").length;
  const failed  = items.filter((it) => it.status === "failed").length;
  const visible = queued + running + done + failed > 0;

  const cancel = async (id: string) => {
    try {
      await api.cancelSocialQueueItem(id);
      refresh();
    } catch (e: any) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    }
  };

  const clearHistory = async () => {
    try {
      const r = await api.clearSocialQueueHistory();
      if (r.removed) toast({ title: `Cleared ${r.removed} finished item(s)` });
      refresh();
    } catch (e: any) {
      toast({ title: "Clear failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="social-queue-chip"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          // Stack above the 32-px bottom status bar, on the right so it
          // doesn't collide with the batch action bar (centered).
          className="fixed bottom-11 right-3 z-40"
        >
          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="flex items-center gap-2 rounded-full border border-primary/50 bg-background/95 backdrop-blur-xl shadow-xl px-3 py-1.5 hover:bg-primary/10 transition-colors"
              title="Social copy background queue"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-medium">Social copy</span>
              {running > 0 && (
                <span className="flex items-center gap-1 text-[10px] text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" /> {running}
                </span>
              )}
              {queued > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                  {queued}
                </Badge>
              )}
              {done > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-success">
                  <CheckCircle2 className="h-3 w-3" /> {done}
                </span>
              )}
              {failed > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-destructive">
                  <XCircle className="h-3 w-3" /> {failed}
                </span>
              )}
              <ChevronUp className="h-3 w-3 text-muted-foreground" />
            </button>
          ) : (
            <div className="rounded-xl border border-primary/50 bg-background/97 backdrop-blur-xl shadow-2xl w-[360px] max-h-[60vh] flex flex-col">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold flex-1">Social Copy Queue</span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                  onClick={clearHistory} title="Clear finished items">
                  <Trash2 className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                  onClick={() => setOpen(false)} title="Collapse">
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              <div className="overflow-y-auto flex-1">
                {items.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">
                    Queue empty.
                  </p>
                )}
                {items.map((it) => (
                  <div key={it.queue_id}
                    className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 last:border-0 text-[11px]">
                    {/* Status icon */}
                    {it.status === "running"   && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
                    {it.status === "queued"    && <span className="h-2 w-2 rounded-full bg-muted-foreground shrink-0" />}
                    {it.status === "done"      && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
                    {it.status === "failed"    && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                    {it.status === "cancelled" && <XCircle className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{it.title || it.post_id}</div>
                      {it.error && (
                        <div className="text-[9px] text-destructive truncate" title={it.error}>
                          {it.error}
                        </div>
                      )}
                    </div>
                    {it.status === "queued" && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                        onClick={() => cancel(it.queue_id)} title="Cancel">
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
