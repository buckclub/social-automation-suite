import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListOrdered, Play, Pause, Loader2, CheckCircle2, XCircle,
  ChevronUp, ChevronDown, Trash2, RotateCw, History,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type QueueItem } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAppEvent, isLiveConnected } from "@/lib/eventBus";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { formatDistanceToNow } from "@/lib/format-time";

/**
 * Dashboard panel that shows the current run queue.
 *
 *   - Queued items can be reordered and cancelled.
 *   - Running item shown with live spinner (it's whatever the pipeline
 *     picked up — the queue worker on the backend starts the next one
 *     as soon as the pipeline goes idle).
 *   - Done / failed / cancelled items stay in a collapsible 'History'
 *     section for context.
 *   - Pause/resume flips the server-side `paused` flag so adding more
 *     items doesn't auto-run.
 */
export function QueuePanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getQueue>> | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = useCallback(async () => {
    try { setData(await api.getQueue()); } catch {}
  }, []);
  useEffect(() => {
    refresh();
    // SSE pushes drive most updates. The interval only fires when
    // SSE is disconnected — healthy stream = zero polling chatter.
    const t = setInterval(() => {
      if (!isLiveConnected()) refresh();
    }, 30_000);
    return () => clearInterval(t);
  }, [refresh]);
  useAppEvent(["run_queue.update", "render.complete"], refresh);

  if (!data) return null;

  const items = data.items || [];
  const queued    = items.filter((i) => i.status === "queued");
  const running   = items.filter((i) => i.status === "running");
  const history   = items.filter((i) => ["done", "failed", "cancelled"].includes(i.status));

  // If nothing's in the queue at all, keep the panel out of the way.
  const anythingActive = queued.length + running.length > 0;
  const anythingAtAll  = anythingActive || history.length > 0;
  if (!anythingAtAll) return null;

  const togglePause = async () => {
    try {
      if (data.paused) await api.queueResume();
      else             await api.queuePause();
      refresh();
    } catch (e: any) {
      toast({ title: "Couldn't toggle queue", description: e.message, variant: "destructive" });
    }
  };

  const move = async (q: QueueItem, dir: -1 | 1) => {
    try { await api.queueMove(q.queue_id, dir); refresh(); }
    catch (e: any) { toast({ title: "Move failed", description: e.message, variant: "destructive" }); }
  };

  const remove = async (q: QueueItem) => {
    try { await api.queueRemove(q.queue_id); refresh(); }
    catch (e: any) { toast({ title: "Remove failed", description: e.message, variant: "destructive" }); }
  };

  const retry = async (q: QueueItem) => {
    try {
      await api.queueRetry(q.queue_id);
      toast({ title: "Re-queued" });
      refresh();
    } catch (e: any) {
      toast({ title: "Retry failed", description: e.message, variant: "destructive" });
    }
  };

  const undoDelete = useUndoableDelete();
  const clearHistory = () => {
    if (!history.length) return;
    // Snapshot the to-be-cleared rows so we can show them again on
    // undo (the data prop snapshot itself is immutable; this keeps
    // the displayed queue in lock-step with the optimistic hide).
    const snapshot = data;
    undoDelete({
      label: `Cleared ${history.length} history row${history.length === 1 ? "" : "s"}`,
      description: "Click Undo to restore.",
      hide: () =>
        setData((d) =>
          d ? { ...d, items: d.items.filter((it) => !["done", "failed", "cancelled"].includes(it.status)) } : d,
        ),
      restore: () => setData(snapshot),
      commit: async () => {
        await api.queueClearHistory();
        refresh();
      },
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Card className="border-primary/30 bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListOrdered className="h-4 w-4 text-primary" />
              Run queue
              <Badge variant="outline" className="text-[10px]">
                {queued.length} queued
                {running.length > 0 && ` · 1 running`}
              </Badge>
            </CardTitle>

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={togglePause}
                className="h-7 gap-1 text-[11px]"
                title={data.paused ? "Resume — the worker will pick up the next queued item" : "Pause — queued items won't auto-start"}
              >
                {data.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {data.paused ? "Resume" : "Pause"}
              </Button>
              {history.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setShowHistory((v) => !v)}>
                  <History className="h-3 w-3" /> History ({history.length})
                </Button>
              )}
            </div>
          </div>
          {data.paused && (
            <p className="text-[10px] text-warning mt-1 flex items-center gap-1">
              <Pause className="h-2.5 w-2.5" /> Queue paused — currently running item finishes, but nothing else will start.
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-2">
          {/* Running */}
          <AnimatePresence>
            {running.map((q) => (
              <QueueRow
                key={q.queue_id}
                item={q}
                variant="running"
                onMove={move} onRemove={remove} onRetry={retry}
                canMoveUp={false} canMoveDown={false}
              />
            ))}
          </AnimatePresence>

          {/* Queued */}
          <AnimatePresence>
            {queued.map((q, i) => (
              <QueueRow
                key={q.queue_id}
                item={q}
                variant="queued"
                index={i + 1}
                onMove={move} onRemove={remove} onRetry={retry}
                canMoveUp={i > 0}
                canMoveDown={i < queued.length - 1}
              />
            ))}
          </AnimatePresence>

          {queued.length === 0 && running.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-2 text-center italic">
              Queue is empty — add posts from the Posts page.
            </p>
          )}

          {/* History */}
          {showHistory && history.length > 0 && (
            <div className="pt-2 border-t border-border/40 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>Recent history (newest first)</span>
                <button
                  onClick={clearHistory}
                  className="hover:text-destructive transition-colors"
                >Clear</button>
              </div>
              {history
                .slice()
                .sort((a, b) => (b.finished_at || b.added_at).localeCompare(a.finished_at || a.added_at))
                .slice(0, 20)
                .map((q) => (
                  <QueueRow
                    key={q.queue_id}
                    item={q}
                    variant="history"
                    onMove={move} onRemove={remove} onRetry={retry}
                    canMoveUp={false} canMoveDown={false}
                  />
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── One row in the queue ──────────────────────────────────────────────
function QueueRow({
  item, variant, index,
  onMove, onRemove, onRetry,
  canMoveUp, canMoveDown,
}: {
  item: QueueItem;
  variant: "running" | "queued" | "history";
  index?: number;
  onMove: (q: QueueItem, dir: -1 | 1) => void;
  onRemove: (q: QueueItem) => void;
  onRetry: (q: QueueItem) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const iconAndColor = (() => {
    switch (item.status) {
      case "running":   return { icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: "text-primary border-primary/40 bg-primary/5" };
      case "queued":    return { icon: <span className="font-mono text-[9px]">{index}</span>, cls: "text-muted-foreground border-border bg-secondary/20" };
      case "done":      return { icon: <CheckCircle2 className="h-3 w-3" />, cls: "text-success/90 border-success/30 bg-success/5" };
      case "failed":    return { icon: <XCircle className="h-3 w-3" />, cls: "text-destructive border-destructive/30 bg-destructive/5" };
      case "cancelled": return { icon: <XCircle className="h-3 w-3" />, cls: "text-muted-foreground border-border bg-background/40" };
      // Fallback for any future server-side status the UI doesn't
      // know about yet — render a neutral chip instead of crashing
      // when iconAndColor.cls is destructured below.
      default:          return { icon: <span className="font-mono text-[9px]">?</span>, cls: "text-muted-foreground border-border bg-secondary/20" };
    }
  })();

  const timingStr = (() => {
    if (item.status === "running" && item.started_at) {
      return `running for ${formatDistanceToNow(new Date(item.started_at))}`;
    }
    if (item.status === "done" || item.status === "failed") {
      if (item.started_at && item.finished_at) {
        const elapsed = (new Date(item.finished_at).getTime() - new Date(item.started_at).getTime()) / 1000;
        return `${Math.round(elapsed)}s`;
      }
    }
    if (item.added_at) {
      return `added ${formatDistanceToNow(new Date(item.added_at), { addSuffix: true })}`;
    }
    return "";
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.15 }}
      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${iconAndColor.cls}`}
    >
      <div className="flex items-center justify-center h-5 w-5 shrink-0">
        {iconAndColor.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium leading-tight truncate">{item.title}</p>
        <p className="text-[9px] text-muted-foreground font-mono">
          r/{item.subreddit || "—"} · {timingStr}
          {item.error && <span className="text-destructive ml-1">· {item.error.slice(0, 80)}</span>}
        </p>
      </div>

      {variant === "queued" && (
        <>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary/60 disabled:opacity-30"
            disabled={!canMoveUp}
            onClick={() => onMove(item, -1)}
            title="Move up"
          ><ChevronUp className="h-3 w-3" /></button>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary/60 disabled:opacity-30"
            disabled={!canMoveDown}
            onClick={() => onMove(item, 1)}
            title="Move down"
          ><ChevronDown className="h-3 w-3" /></button>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive"
            onClick={() => onRemove(item)}
            title="Remove from queue"
          ><Trash2 className="h-3 w-3" /></button>
        </>
      )}

      {variant === "history" && (item.status === "failed" || item.status === "cancelled") && (
        <button
          className="h-5 px-1.5 flex items-center gap-1 rounded hover:bg-secondary/60 text-[10px]"
          onClick={() => onRetry(item)}
          title="Re-queue this item"
        ><RotateCw className="h-3 w-3" /> Retry</button>
      )}
    </motion.div>
  );
}
