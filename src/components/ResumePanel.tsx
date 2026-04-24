import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Layers, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVideos } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

/**
 * Shows all videos that have TTS audio preserved but no rendered video
 * (`audio_only` status). Common after a crash or cancel — TTS is the
 * expensive step, so resuming the render is essentially free.
 *
 * "Resume all" runs them sequentially (the pipeline can only process one
 * at a time today — run queue comes next) and reports per-item status.
 */
export function ResumePanel() {
  const { data } = useVideos();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ idx: number; total: number; id: string } | null>(null);

  const audioOnly = (data?.videos ?? []).filter((v) => v.status === "audio_only" && v.has_audio);
  const count = audioOnly.length;

  if (count === 0) return null;

  // Poll pipeline status until it becomes idle again — used to sequence
  // the resume requests since the backend only renders one at a time.
  const waitUntilIdle = async (timeoutMs = 30 * 60 * 1000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const s = await api.getPipelineStatus();
        if (!s.is_running) return;
      } catch {
        // Transient error — keep polling.
      }
    }
    throw new Error("Timed out waiting for pipeline to become idle");
  };

  const resumeAll = async () => {
    setBusy(true);
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < audioOnly.length; i++) {
        const v = audioOnly[i];
        setProgress({ idx: i + 1, total: audioOnly.length, id: v.id });
        try {
          await api.resumeVideo(v.id);
          await waitUntilIdle();
          ok++;
        } catch {
          fail++;
        }
      }
    } finally {
      setBusy(false);
      setProgress(null);
      toast({
        title: `Resumed ${ok}/${audioOnly.length}`,
        description: fail ? `${fail} failed` : undefined,
        variant: fail ? "destructive" : "default",
      });
    }
  };

  const resumeOne = async (id: string) => {
    try {
      await api.resumeVideo(id);
      toast({ title: "Resume started", description: "Track progress in the Pipeline panel." });
    } catch (e: any) {
      toast({ title: "Resume failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Card className="border-warning/30 bg-warning/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4 text-warning" />
            Audio ready, video missing
            <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
              {count}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[11px] text-muted-foreground leading-snug">
            These posts have preserved TTS audio but no rendered video — a
            previous render either failed or was cancelled. Resuming is free;
            it only re-runs the video step.
          </p>

          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {audioOnly.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded border border-border/60 bg-background/40 px-2 py-1.5"
              >
                <RefreshCw className="h-3 w-3 text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium leading-tight truncate">{v.title}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">
                    r/{v.subreddit}
                    {v.created_at && <> · {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}</>}
                    {v.parts && v.parts > 1 && <> · <Layers className="h-2.5 w-2.5 inline" /> {v.parts} parts</>}
                  </p>
                </div>
                <Button
                  size="sm" variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => resumeOne(v.id)}
                  disabled={busy}
                >
                  Resume
                </Button>
              </div>
            ))}
          </div>

          {busy && progress && (
            <div className="space-y-1 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">
                  Resuming {progress.idx}/{progress.total}…
                </span>
                <span className="font-mono text-primary">
                  {Math.round((progress.idx / progress.total) * 100)}%
                </span>
              </div>
              <div className="h-1 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(progress.idx / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="w-full gap-1"
            onClick={resumeAll}
            disabled={busy || count === 0}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {busy ? "Resuming…" : `Resume all ${count}`}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
