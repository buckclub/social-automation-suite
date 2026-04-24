import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Scissors, Youtube, Upload, Loader2, Film, Clock, Trash2, AlertTriangle,
  CheckCircle2, XCircle, Sparkles, Play,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, type ClipProjectSummary } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function fmtDuration(s: number): string {
  if (!s) return "?";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${sec}s`;
}

const STATUS_TONE: Record<string, { cls: string; label: string }> = {
  ingesting:           { cls: "border-primary/40 text-primary",      label: "Downloading" },
  ready_to_transcribe: { cls: "border-warning/40 text-warning",      label: "Needs transcript" },
  transcribing:        { cls: "border-primary/40 text-primary",      label: "Transcribing" },
  ready_to_propose:    { cls: "border-accent/40 text-accent",        label: "Ready to propose" },
  proposing:           { cls: "border-accent/40 text-accent",        label: "AI scoring" },
  ready_to_review:     { cls: "border-success/40 text-success",      label: "Review & approve" },
  rendering:           { cls: "border-primary/40 text-primary",      label: "Rendering" },
  done:                { cls: "border-success/40 text-success",      label: "Done" },
  failed:              { cls: "border-destructive/40 text-destructive", label: "Failed" },
};

export default function ClipsPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ClipProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [probe, setProbe] = useState<Awaited<ReturnType<typeof api.probeClipSource>> | null>(null);
  const [probing, setProbing] = useState(false);
  const [creating, setCreating] = useState(false);

  // Upload state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<ClipProjectSummary | null>(null);

  const refresh = async () => {
    try {
      const r = await api.listClipProjects();
      setProjects(r.projects);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
    // Light poll so 'ingesting' / 'transcribing' states update without the
    // user having to click anything.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const doProbe = async () => {
    if (!newUrl.trim()) return;
    setProbing(true);
    setProbe(null);
    try {
      const info = await api.probeClipSource(newUrl.trim());
      setProbe(info);
      if (!newName) setNewName(info.title.slice(0, 80));
    } catch (e: any) {
      toast({ title: "Couldn't probe URL", description: e.message, variant: "destructive" });
    } finally {
      setProbing(false);
    }
  };

  const createFromYoutube = async () => {
    if (!newUrl.trim()) return;
    setCreating(true);
    try {
      const p = await api.createClipFromYoutube(newUrl.trim(), newName.trim());
      toast({ title: "Project created", description: `Downloading — will show up below when ready.` });
      setNewUrl(""); setNewName(""); setProbe(null);
      refresh();
    } catch (e: any) {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 5 * 1024 * 1024 * 1024) {
      toast({ title: "File too large", description: "Keep sources under 5 GB.", variant: "destructive" });
      return;
    }
    setUploadPct(0);
    try {
      const p = await api.uploadClipSource(f, newName.trim() || f.name, (pct) => setUploadPct(pct * 100));
      toast({ title: "Uploaded", description: p.name });
      setNewName("");
      refresh();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadPct(null);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteClipProject(deleteTarget.id);
      toast({ title: "Deleted" });
      setDeleteTarget(null);
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" /> Clip Maker
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Give the tool a long video (YouTube link or upload), let AI propose the most Shorts-worthy
          moments, adjust the ranges, and render 9:16 clips with captions into the run queue.
        </p>
      </div>

      {/* Create */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Youtube className="h-3 w-3 text-[#ff0000]" /> YouTube URL
            </Label>
            <div className="flex gap-2">
              <Input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doProbe()}
                placeholder="https://youtube.com/watch?v=..."
                className="h-9 text-xs bg-secondary border-border font-mono"
              />
              <Button size="sm" variant="outline" onClick={doProbe} disabled={probing || !newUrl.trim()} className="gap-1">
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Probe
              </Button>
            </div>
          </div>

          {probe && (
            <div className="rounded-md border border-border bg-secondary/30 p-3 flex gap-3">
              {probe.thumbnail && (
                <img src={probe.thumbnail} alt="" className="h-20 w-32 object-cover rounded flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0 text-xs space-y-1">
                <p className="font-semibold truncate">{probe.title || "(untitled)"}</p>
                <p className="text-muted-foreground">{probe.uploader} · {fmtDuration(probe.duration_s)}</p>
                <div className="flex gap-2 flex-wrap mt-1">
                  {probe.has_en_captions ? (
                    <Badge variant="outline" className="text-[9px] border-success/40 text-success">
                      <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                      {probe.manual_en ? "Manual captions available (faster)" : "Auto-captions available (skips whisper)"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">
                      <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                      No English captions — we'll run whisper
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Project name (optional)</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="auto-filled from title"
              className="h-9 text-xs bg-secondary border-border"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={createFromYoutube}
              disabled={creating || !newUrl.trim()}
              className="gap-1"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />}
              Create from YouTube
            </Button>

            <span className="text-[10px] text-muted-foreground">or</span>

            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo"
              className="hidden"
              onChange={handleUpload}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploadPct != null} className="gap-1">
              {uploadPct != null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload file
            </Button>
          </div>

          {uploadPct != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span>Uploading source…</span>
                <span className="font-mono">{Math.round(uploadPct)}%</span>
              </div>
              <div className="h-1 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Projects list */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Film className="h-4 w-4" /> Projects
          <Badge variant="outline" className="text-[10px]">{projects.length}</Badge>
        </h3>

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" /></div>
        ) : projects.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="py-10 text-center text-muted-foreground text-xs">
              No projects yet. Paste a YouTube link above or upload a file.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => {
              const tone = STATUS_TONE[p.status] || { cls: "border-muted-foreground/40 text-muted-foreground", label: p.status };
              return (
                <motion.div key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="border-border bg-card hover:border-primary/30 transition-all">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <Link to={`/clips/${p.id}`} className="hover:text-primary transition-colors">
                            <p className="text-xs font-semibold line-clamp-2 leading-snug">{p.name}</p>
                          </Link>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono mt-0.5">
                            {p.source_type === "youtube" ? <Youtube className="h-2.5 w-2.5 text-[#ff0000]" /> : <Upload className="h-2.5 w-2.5" />}
                            <span>{fmtDuration(p.duration_s)}</span>
                            <Clock className="h-2.5 w-2.5" />
                            <span>{p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : ""}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setDeleteTarget(p)}
                          className="opacity-60 hover:opacity-100 h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      <Badge variant="outline" className={`text-[10px] gap-1 ${tone.cls}`}>
                        {p.status === "done" ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                         p.status === "failed" ? <XCircle className="h-2.5 w-2.5" /> :
                         p.status.includes("ing") ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
                         <Play className="h-2.5 w-2.5" />}
                        {tone.label}
                      </Badge>

                      {p.status_detail && (
                        <p className="text-[10px] text-muted-foreground leading-snug">{p.status_detail}</p>
                      )}

                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        {p.proposal_count > 0 && <span><strong>{p.proposal_count}</strong> proposals</span>}
                        {p.approved_count > 0 && <span className="text-success"><strong>{p.approved_count}</strong> approved</span>}
                        {p.rendered_count > 0 && <span className="text-primary"><strong>{p.rendered_count}</strong> rendered</span>}
                      </div>

                      <Link to={`/clips/${p.id}`}>
                        <Button size="sm" variant="outline" className="w-full h-7 text-[11px] gap-1">
                          Open project
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        description={<>Removes the project folder under <code>clips/{deleteTarget?.id}</code> including the source file and any rendered clips. Cannot be undone.</>}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={doDelete}
      />
    </motion.div>
  );
}
