import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HardDrive, Youtube, CheckCircle2, Loader2, AlertCircle, Command,
  Calendar as CalendarIcon, MessageCircle, Sparkles, Film,
} from "lucide-react";
import { usePipelineStatus, useHealth, useSystemStatus } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { useCommandPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

/**
 * Fixed bottom strip with live system state — always visible, so you
 * never have to tab-switch to check "is it still running?".
 *
 * Auto-hides in print / narrow-viewport (< 640px) to avoid crowding.
 */
export function StatusBar() {
  const nav = useNavigate();
  const { data: pipeline } = usePipelineStatus();
  const { data: health } = useHealth();
  const { data: sys } = useSystemStatus();
  const { toggle } = useCommandPalette();

  const [quota, setQuota] = useState<{ used: number; limit: number; uploads_left: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.youtubeQuota()
        .then((q) => { if (!cancelled) setQuota({ used: q.used_today, limit: q.daily_limit, uploads_left: Math.floor(q.remaining / 1600) }); })
        .catch(() => { if (!cancelled) setQuota(null); });
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Cross-worker activity snapshot — render queue + social copy + calendar
  // + comment drafts in one poll. Only chips with non-zero counts render
  // so the bar stays clean when the suite is idle.
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof api.getActivity>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.getActivity()
        .then((a) => { if (!cancelled) setActivity(a); })
        .catch(() => {});
    load();
    const t = setInterval(load, 8_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Format "next at" relative to now, e.g. "in 14m" / "in 2h"
  const fmtRel = (iso?: string | null): string => {
    if (!iso) return "";
    try {
      const ms = new Date(iso).getTime() - Date.now();
      if (ms < 0) return "due";
      const mins = Math.round(ms / 60_000);
      if (mins < 60) return `in ${mins}m`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `in ${hrs}h`;
      return `in ${Math.round(hrs / 24)}d`;
    } catch { return ""; }
  };

  const running = pipeline?.is_running ?? false;
  const steps = pipeline?.steps ?? [];
  const runningStep = steps.find((s) => s.status === "running");
  const pipelineSummary = running
    ? `${runningStep?.title ?? "Running"} — ${runningStep?.detail?.slice(0, 60) ?? ""}`
    : pipeline?.error
    ? `Error: ${pipeline.error.slice(0, 60)}`
    : "Idle";

  const pipelineColor = running ? "text-primary" : pipeline?.error ? "text-destructive" : "text-muted-foreground";
  const PipelineIcon = running ? Loader2 : pipeline?.error ? AlertCircle : CheckCircle2;

  const backendOk = health?.status === "online";
  const ollamaOk = !!sys?.ollama_reachable;
  const pct = quota ? (quota.used / quota.limit) * 100 : 0;
  const quotaColor = pct >= 90 ? "text-destructive" : pct >= 70 ? "text-warning" : "text-muted-foreground";

  return (
    <div className="hidden sm:block fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex h-8 max-w-[1400px] items-center gap-3 px-4 text-[11px]">
        {/* Pipeline status — clickable to open Dashboard */}
        <button
          onClick={() => nav("/")}
          className={cn("flex items-center gap-1.5 hover:text-foreground transition-colors", pipelineColor)}
          title="Open pipeline view"
        >
          <PipelineIcon className={cn("h-3 w-3", running && "animate-spin")} />
          <span className="font-medium">Pipeline:</span>
          <span className="truncate max-w-[280px]">{pipelineSummary}</span>
        </button>

        <Divider />

        {/* Health dots */}
        <StatusDot ok={backendOk} label="Backend" />
        <StatusDot
          ok={ollamaOk}
          label="Ollama"
          detail={sys?.ollama_detail ?? undefined}
        />

        <Divider />

        {/* Cross-worker activity — only shows chips with non-zero state. */}
        {activity?.render_queue.queued ? (
          <button
            onClick={() => nav("/")}
            className="flex items-center gap-1 text-amber-400/90 hover:text-foreground transition-colors"
            title={`${activity.render_queue.queued} item${activity.render_queue.queued === 1 ? "" : "s"} queued for render`}
          >
            <Film className="h-3 w-3" />
            <span>{activity.render_queue.queued} queued</span>
          </button>
        ) : null}
        {activity?.social_copy.running || activity?.social_copy.queued ? (
          <button
            onClick={() => nav("/videos")}
            className={cn(
              "flex items-center gap-1 transition-colors hover:text-foreground",
              activity.social_copy.running ? "text-primary" : "text-muted-foreground",
            )}
            title="Social copy queue"
          >
            <Sparkles className={cn("h-3 w-3", activity.social_copy.running && "animate-pulse")} />
            <span>
              {activity.social_copy.running ? "social copy running" : `${activity.social_copy.queued} social copy`}
            </span>
          </button>
        ) : null}
        {activity?.calendar.planned || activity?.calendar.in_flight ? (
          <button
            onClick={() => nav("/calendar")}
            className={cn(
              "flex items-center gap-1 transition-colors hover:text-foreground",
              activity.calendar.in_flight ? "text-primary" : "text-muted-foreground",
            )}
            title={
              activity.calendar.in_flight
                ? `${activity.calendar.in_flight} slot in flight`
                : `${activity.calendar.planned} scheduled${activity.calendar.next_at ? `, next ${fmtRel(activity.calendar.next_at)}` : ""}`
            }
          >
            <CalendarIcon className={cn("h-3 w-3", activity.calendar.in_flight && "animate-pulse")} />
            <span>
              {activity.calendar.in_flight
                ? `${activity.calendar.in_flight} firing`
                : <>{activity.calendar.planned} scheduled
                  {activity.calendar.next_at && (
                    <span className="text-muted-foreground/70 ml-1">· {fmtRel(activity.calendar.next_at)}</span>
                  )}
                </>}
            </span>
          </button>
        ) : null}
        {activity?.comment_drafts.open ? (
          <button
            onClick={() => nav("/comments")}
            className={cn(
              "flex items-center gap-1 transition-colors hover:text-foreground",
              activity.comment_drafts.failed ? "text-destructive" : "text-muted-foreground",
            )}
            title={
              activity.comment_drafts.failed
                ? `${activity.comment_drafts.failed} reply failed`
                : `${activity.comment_drafts.open} draft replies awaiting review`
            }
          >
            <MessageCircle className="h-3 w-3" />
            <span>{activity.comment_drafts.open} replies</span>
            {activity.comment_drafts.failed > 0 && (
              <span className="text-destructive">· {activity.comment_drafts.failed} failed</span>
            )}
          </button>
        ) : null}
        {(activity?.render_queue.queued || activity?.social_copy.running || activity?.social_copy.queued
            || activity?.calendar.planned || activity?.calendar.in_flight || activity?.comment_drafts.open) ? (
          <Divider />
        ) : null}

        {/* YouTube quota chip */}
        {quota && (
          <button
            onClick={() => nav("/config?tab=publishing")}
            className={cn("flex items-center gap-1.5 hover:text-foreground transition-colors", quotaColor)}
            title={`YouTube: ${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()} units (~${quota.uploads_left} uploads)`}
          >
            <Youtube className="h-3 w-3" />
            <span>{quota.used.toLocaleString()}/{quota.limit.toLocaleString()}</span>
            <span className="text-muted-foreground">· ~{quota.uploads_left} left</span>
          </button>
        )}

        <Divider />

        {/* Disk */}
        {sys?.disk_free_gb != null && (
          <div
            className={cn(
              "flex items-center gap-1.5",
              sys.disk_free_gb < 5 ? "text-destructive" : sys.disk_free_gb < 20 ? "text-warning" : "text-muted-foreground"
            )}
            title={`Disk free · videos/ currently ${sys.videos_dir_gb ?? "?"} GB`}
          >
            <HardDrive className="h-3 w-3" />
            <span>{sys.disk_free_gb} GB free</span>
            {sys.videos_dir_gb != null && (
              <span className="text-muted-foreground">(videos: {sys.videos_dir_gb} GB)</span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side: command palette + shortcut hint */}
        <button
          onClick={toggle}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Command palette"
        >
          <Command className="h-3 w-3" />
          <span>K</span>
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-3 w-px bg-border shrink-0" />;
}

function StatusDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        ok ? "text-muted-foreground" : "text-destructive"
      )}
      title={detail ? `${label}: ${detail}` : label}
    >
      <div className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      <span>{label}</span>
    </div>
  );
}
