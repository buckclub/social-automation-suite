import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Trash2, Youtube, Share2, X, CheckSquare, Loader2, Clock, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { api, type VideoRecord } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useDeleteVideo } from "@/hooks/use-api";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Props {
  videos: VideoRecord[];
  selectedIds: Set<string>;
  onClear: () => void;
  onAllSelected: () => void;
}

function defaultFutureLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Floating action bar that appears whenever any videos are selected on
 * the Videos page. Supports batch delete / batch social-copy generation /
 * batch YouTube upload (with optional staggered scheduling so you can
 * queue a week of Shorts in one click).
 */
export function VideoBatchActionBar({ videos, selectedIds, onClear, onAllSelected }: Props) {
  const { toast } = useToast();
  const deleteMutation = useDeleteVideo();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [busy, setBusy] = useState<null | "delete" | "social" | "youtube">(null);

  const selectedVideos = videos.filter((v) => selectedIds.has(v.id));
  const uploadableVideos = selectedVideos.filter((v) => v.has_video);
  const count = selectedIds.size;
  const visible = count > 0;

  // ── Actions ────────────────────────────────────────────────────────
  const runDelete = async () => {
    setDeleteOpen(false);
    setBusy("delete");
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        await new Promise<void>((resolve, reject) => {
          deleteMutation.mutate({ id, keep_files: false }, {
            onSuccess: () => { ok++; resolve(); },
            onError: (e) => { fail++; reject(e); },
          });
        });
      } catch {}
    }
    setBusy(null);
    onClear();
    toast({
      title: `${ok} deleted${fail ? `, ${fail} failed` : ""}`,
      variant: fail ? "destructive" : "default",
    });
  };

  const runSocialCopy = async () => {
    setBusy("social");
    let ok = 0, fail = 0;
    for (const v of selectedVideos) {
      try {
        await api.generateSocialCopy(v.id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBusy(null);
    toast({
      title: `Generated copy for ${ok} video${ok === 1 ? "" : "s"}`,
      description: fail ? `${fail} failed — check AI provider config.` : undefined,
      variant: fail ? "destructive" : "default",
    });
  };

  if (!visible) return null;

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            // Sit just above the bottom status bar (32px).
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40"
          >
            <div className="flex items-center gap-2 rounded-xl border border-primary/50 bg-background/95 backdrop-blur-xl shadow-2xl px-3 py-2">
              <div className="flex items-center gap-1.5 pr-2 border-r border-border">
                <CheckSquare className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">{count} selected</span>
              </div>

              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 px-2" onClick={onAllSelected} title="Select every published video on this page">
                Select all published
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 px-2 border-primary/40 text-primary hover:bg-primary/10"
                onClick={runSocialCopy}
                disabled={busy !== null || selectedVideos.length === 0}
              >
                {busy === "social" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
                Social copy
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 px-2 border-[#ff0000]/40 text-[#ff0000] hover:bg-[#ff0000]/10"
                onClick={() => setYtOpen(true)}
                disabled={busy !== null || uploadableVideos.length === 0}
                title={uploadableVideos.length < count ? "Only videos with a rendered mp4 can be uploaded" : undefined}
              >
                <Youtube className="h-3 w-3" />
                YouTube ({uploadableVideos.length})
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1 px-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteOpen(true)}
                disabled={busy !== null}
              >
                {busy === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete
              </Button>

              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClear} title="Clear selection">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${count} video${count === 1 ? "" : "s"}?`}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        description={
          <>
            Permanently removes the <strong>.mp4 files + preserved workspaces</strong> for
            {" "}<strong>{count}</strong> selected video{count === 1 ? "" : "s"}. Cannot be undone.
          </>
        }
        confirmLabel={`Delete ${count}`}
        variant="destructive"
        onConfirm={runDelete}
        isLoading={busy === "delete"}
      />

      <BatchYouTubeDialog
        open={ytOpen}
        onOpenChange={setYtOpen}
        videos={uploadableVideos}
        onAllDone={() => {
          setBusy(null);
          onClear();
        }}
        setBusy={(b) => setBusy(b ? "youtube" : null)}
      />
    </>
  );
}

// ── Batch YouTube dialog — optional staggered scheduling ────────────
interface BatchYtProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videos: VideoRecord[];
  onAllDone: () => void;
  setBusy: (busy: boolean) => void;
}

function BatchYouTubeDialog({ open, onOpenChange, videos, onAllDone, setBusy }: BatchYtProps) {
  const { toast } = useToast();
  const [privacy, setPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [schedule, setSchedule] = useState(true);
  const [startLocal, setStartLocal] = useState<string>(defaultFutureLocal());
  const [intervalMins, setIntervalMins] = useState(60);
  const [progress, setProgress] = useState<{ idx: number; total: number; title: string } | null>(null);
  const [results, setResults] = useState<{ title: string; ok: boolean; url?: string; err?: string }[]>([]);

  const total = videos.length;

  const runUploads = async () => {
    setProgress({ idx: 0, total, title: "" });
    setBusy(true);
    setResults([]);

    const startMs = schedule ? new Date(startLocal).getTime() : 0;
    const nowMs = Date.now();
    const out: { title: string; ok: boolean; url?: string; err?: string }[] = [];

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      setProgress({ idx: i + 1, total, title: v.title });

      let publish_at: string | undefined = undefined;
      if (schedule) {
        const ts = new Date(startMs + i * intervalMins * 60 * 1000);
        // Must be ≥ 1 min in the future — if the user picked a start that's
        // already past plus index*interval didn't push it far enough forward,
        // nudge into the future.
        if (ts.getTime() < nowMs + 90 * 1000) {
          ts.setTime(nowMs + 90 * 1000);
        }
        publish_at = ts.toISOString().replace(/\.\d{3}Z$/, "Z");
      }

      try {
        const r = await api.youtubeUpload({
          video_id: v.id,
          privacy: schedule ? "private" : privacy,
          publish_at,
        });
        out.push({ title: v.title, ok: true, url: r.url });
      } catch (e: any) {
        out.push({ title: v.title, ok: false, err: e?.message || "upload failed" });
      }
      setResults([...out]);
    }

    setBusy(false);
    setProgress(null);
    const okCount = out.filter((r) => r.ok).length;
    toast({
      title: `${okCount}/${total} uploaded`,
      description: schedule ? "Scheduled releases will fire on YouTube's side." : undefined,
      variant: okCount === total ? "default" : "destructive",
    });
    onAllDone();
  };

  const anyResults = results.length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!progress) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Youtube className="h-4 w-4 text-[#ff0000]" />
            Upload {total} video{total === 1 ? "" : "s"} to YouTube Shorts
          </DialogTitle>
          <DialogDescription className="text-xs">
            Each upload uses the title/description/tags from that video's <code>social.json</code>
            {total > 1 && " — generate those first for best results."}
          </DialogDescription>
        </DialogHeader>

        {!progress && !anyResults && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Privacy (non-scheduled)</Label>
                <Select value={privacy} onValueChange={(v) => setPrivacy(v as any)} disabled={schedule}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Stagger</Label>
                <div className="flex items-center h-8 gap-2 px-2 rounded-md border border-border bg-secondary">
                  <input id="batch-sched" type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-3 w-3 accent-primary" />
                  <label htmlFor="batch-sched" className="text-xs cursor-pointer">Schedule releases</label>
                </div>
              </div>
            </div>

            {schedule && (
              <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" /> First release (local)
                    </Label>
                    <Input
                      type="datetime-local"
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                      className="h-8 text-xs bg-secondary border-border"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Gap between uploads (min)</Label>
                    <Input
                      type="number"
                      min={1}
                      step={15}
                      value={intervalMins}
                      onChange={(e) => setIntervalMins(Math.max(1, parseInt(e.target.value || "1", 10)))}
                      className="h-8 text-xs bg-secondary border-border"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Will schedule <strong>{total}</strong> videos, first at{" "}
                  <strong>{new Date(startLocal).toLocaleString()}</strong>, then every
                  {" "}<strong>{intervalMins} min</strong> after that — last one{" "}
                  <strong>{new Date(new Date(startLocal).getTime() + (total - 1) * intervalMins * 60000).toLocaleString()}</strong>.
                  All uploaded as <em>Private</em>; YouTube auto-publishes each at its scheduled time.
                </p>
              </div>
            )}

            <div className="space-y-1 max-h-48 overflow-y-auto">
              <Label className="text-xs text-muted-foreground">Selected videos</Label>
              <div className="space-y-0.5 rounded border border-border bg-secondary/30 p-2">
                {videos.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-[10px] leading-tight">
                    <Youtube className="h-2.5 w-2.5 text-[#ff0000] shrink-0" />
                    <span className="truncate">{v.title}</span>
                    <span className="text-muted-foreground ml-auto shrink-0">r/{v.subreddit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {progress && (
          <div className="space-y-2 py-6">
            <div className="flex items-center justify-between text-xs">
              <span>Uploading {progress.idx} of {progress.total}…</span>
              <span className="font-mono text-muted-foreground">{Math.round(progress.idx / progress.total * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.idx / progress.total * 100}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
              {progress.title}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Each upload costs ~1,600 quota units. Don't close this tab.
            </p>
          </div>
        )}

        {anyResults && !progress && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-2 text-[10px] rounded p-1.5 ${r.ok ? "bg-success/10" : "bg-destructive/10"}`}>
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${r.ok ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}>
                  {r.ok ? "OK" : "FAIL"}
                </Badge>
                <span className="truncate flex-1">{r.title}</span>
                {r.ok && r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary underline shrink-0">view</a>
                )}
                {!r.ok && <span className="text-destructive shrink-0">{r.err?.slice(0, 40)}</span>}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {!progress && !anyResults && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={runUploads} className="gap-1">
                <Youtube className="h-3.5 w-3.5" />
                {schedule ? `Schedule ${total} uploads` : `Upload ${total} now`}
              </Button>
            </>
          )}
          {anyResults && !progress && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
