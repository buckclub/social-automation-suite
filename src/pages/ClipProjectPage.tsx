import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, Youtube, Upload, Loader2, Scissors, Sparkles, CheckCircle2,
  XCircle, Plus, Trash2, Play, Clock, Rocket, FileText, ExternalLink, Wand2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type ClipProject, type ClipProposal } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

function fmtTime(s: number): string {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function parseTime(v: string): number | null {
  if (!v) return null;
  const parts = v.split(":").map((p) => p.trim());
  if (parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + Number(p);
  return total;
}

export default function ClipProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [proj, setProj] = useState<ClipProject | null>(null);
  const [loading, setLoading] = useState(true);

  // Proposal-generation knobs
  const [targetCount, setTargetCount] = useState(5);
  const [minLen, setMinLen] = useState(15);
  const [maxLen, setMaxLen] = useState(60);
  const [mode, setMode] = useState<"ai_only" | "manual">("ai_only");

  // Action-in-flight flags
  const [transcribing, setTranscribing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Player ref for click-to-seek from transcript
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const refresh = async () => {
    if (!id) return;
    try {
      const p = await api.getClipProject(id);
      setProj(p);
    } catch (e: any) {
      toast({ title: "Couldn't load project", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, [id]);
  useEffect(() => {
    // Poll while a background task is running (ingesting/transcribing/proposing/rendering).
    if (!proj) return;
    if (!["ingesting", "transcribing", "proposing", "rendering"].includes(proj.status)) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [proj?.status]);

  if (loading || !proj) {
    return (
      <div className="py-12 text-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" /></div>
    );
  }

  const canTranscribe = proj.source_file && (!proj.transcript || proj.status === "failed");
  const canPropose   = !!(proj.transcript?.segments?.length);
  const hasProposals = (proj.proposals?.length ?? 0) > 0;
  const approvedCount = proj.proposals.filter((p) => p.approved).length;

  const doTranscribe = async () => {
    setTranscribing(true);
    try {
      await api.transcribeClipProject(proj.id);
      toast({ title: "Transcription started", description: "Whisper on the source — this may take a minute or two." });
      refresh();
    } catch (e: any) {
      toast({ title: "Transcribe failed", description: e.message, variant: "destructive" });
    } finally {
      setTranscribing(false);
    }
  };

  const doPropose = async () => {
    setProposing(true);
    try {
      const r = await api.proposeClips(proj.id, {
        target_count: targetCount, min_len_s: minLen, max_len_s: maxLen, mode,
      });
      toast({ title: `Generated ${r.proposals.length} proposals` });
      refresh();
    } catch (e: any) {
      toast({ title: "Propose failed", description: e.message, variant: "destructive" });
    } finally {
      setProposing(false);
    }
  };

  const doRender = async () => {
    setRendering(true);
    try {
      const r = await api.renderClipProject(proj.id);
      toast({ title: `Queued ${r.queued} clips`, description: "Track them on the Dashboard run queue." });
      refresh();
    } catch (e: any) {
      toast({ title: "Render failed", description: e.message, variant: "destructive" });
    } finally {
      setRendering(false);
    }
  };

  const addManualClip = async () => {
    // Default to a 30s window starting at the player's current time.
    const cur = videoRef.current?.currentTime ?? 0;
    const end = Math.min(proj.duration_s, cur + 30);
    try {
      await api.addClipProposal(proj.id, { start: cur, end });
      toast({ title: "Manual clip added" });
      refresh();
    } catch (e: any) {
      toast({ title: "Add failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/clips">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> All clip projects
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{proj.name}</h2>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono flex-wrap">
            {proj.source_type === "youtube" ? (
              <>
                <Youtube className="h-3 w-3 text-[#ff0000]" />
                {proj.source_url && (
                  <a href={proj.source_url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-primary">
                    {proj.source_url} <ExternalLink className="h-2.5 w-2.5 inline" />
                  </a>
                )}
              </>
            ) : (
              <><Upload className="h-3 w-3" /> <span>uploaded file</span></>
            )}
            <span>· {fmtTime(proj.duration_s)}</span>
            <span>· <Badge variant="outline" className="text-[9px]">{proj.status}</Badge></span>
          </div>
          {proj.status_detail && <p className="text-[10px] text-muted-foreground mt-1">{proj.status_detail}</p>}
          {proj.error && <p className="text-[10px] text-destructive mt-1">Error: {proj.error}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
        {/* Left: source player + actions */}
        <div className="space-y-3">
          {proj.source_file ? (
            <video
              ref={videoRef}
              src={api.clipSourceVideoUrl(proj.id)}
              controls
              className="w-full rounded-md bg-black aspect-video"
              preload="metadata"
            />
          ) : (
            <Card className="border-border bg-card">
              <CardContent className="py-10 text-center text-xs text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Waiting for source to finish downloading…
              </CardContent>
            </Card>
          )}

          {/* Step 1: transcribe */}
          {canTranscribe && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5 text-warning" /> Transcribe source
                </p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  No captions came with the source — run faster-whisper on the whole file to
                  produce a transcript (required before AI clip detection).
                </p>
                <Button size="sm" className="w-full gap-1" onClick={doTranscribe}
                  disabled={transcribing || proj.status === "transcribing"}>
                  {transcribing || proj.status === "transcribing"
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…</>
                    : <><FileText className="h-3.5 w-3.5" /> Run whisper</>}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step 2: propose */}
          {canPropose && (
            <Card className="border-border bg-card">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> AI clip detection
                </p>
                {proj.transcript && (
                  <p className="text-[10px] text-muted-foreground">
                    Source: <code>{proj.transcript.source}</code> · <strong>{proj.transcript.segments.length}</strong> cues
                  </p>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Count</Label>
                    <Input type="number" min={1} max={20} value={targetCount}
                      onChange={(e) => setTargetCount(+e.target.value || 5)}
                      className="h-7 text-[11px] bg-secondary border-border font-mono" />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Min s</Label>
                    <Input type="number" min={5} max={300} value={minLen}
                      onChange={(e) => setMinLen(+e.target.value || 15)}
                      className="h-7 text-[11px] bg-secondary border-border font-mono" />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">Max s</Label>
                    <Input type="number" min={5} max={300} value={maxLen}
                      onChange={(e) => setMaxLen(+e.target.value || 60)}
                      className="h-7 text-[11px] bg-secondary border-border font-mono" />
                  </div>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">Mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                    <SelectTrigger className="h-7 text-[11px] bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ai_only">AI only (LLM over transcript)</SelectItem>
                      <SelectItem value="manual">Manual (skip AI)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button size="sm" className="w-full gap-1" onClick={doPropose} disabled={proposing}>
                  {proposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {hasProposals ? "Regenerate proposals" : "Generate proposals"}
                </Button>
                <Button size="sm" variant="outline" className="w-full gap-1" onClick={addManualClip}>
                  <Plus className="h-3.5 w-3.5" /> Add manual clip @ player time
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step 3: render */}
          {approvedCount > 0 && (
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Rocket className="h-3.5 w-3.5 text-primary" /> Render {approvedCount} approved clip{approvedCount === 1 ? "" : "s"}
                </p>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Each approved clip becomes its own queue item — track them on the Dashboard.
                  Uses <code>clip_captions</code> from config (falls back to regular captions).
                </p>
                <Button size="sm" className="w-full gap-1" onClick={doRender} disabled={rendering}>
                  {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                  Queue all approved
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: proposals + transcript */}
        <div className="space-y-3">
          {hasProposals && (
            <Card className="border-border bg-card">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <Scissors className="h-3.5 w-3.5 text-primary" />
                  Proposed clips ({proj.proposals.length})
                </p>
                <div className="space-y-2">
                  {proj.proposals.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      projectId={proj.id}
                      maxTime={proj.duration_s}
                      onSeek={(t) => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = t;
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      onChanged={refresh}
                      rendered={proj.rendered_clips.find((r) => r.proposal_id === p.id)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transcript — click a cue to seek */}
          {proj.transcript && proj.transcript.segments.length > 0 && (
            <Card className="border-border bg-card">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Transcript
                </p>
                <div className="max-h-80 overflow-y-auto space-y-0.5 pr-1">
                  {proj.transcript.segments.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = s.start;
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      className="w-full text-left text-[11px] hover:bg-secondary/40 rounded px-1 py-0.5 transition-colors"
                    >
                      <span className="font-mono text-muted-foreground text-[10px]">{fmtTime(s.start)}</span>
                      <span className="ml-2">{s.text}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </motion.div>
  );
}


// ── Single proposal row ────────────────────────────────────────────
function ProposalRow({
  proposal, projectId, maxTime, onSeek, onChanged, rendered,
}: {
  proposal: ClipProposal;
  projectId: string;
  maxTime: number;
  onSeek: (t: number) => void;
  onChanged: () => void;
  rendered?: { video_path: string; thumbnail_path: string | null } | undefined;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(fmtTime(proposal.start));
  const [end, setEnd] = useState(fmtTime(proposal.end));
  const [title, setTitle] = useState(proposal.custom_title ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (patch: Partial<ClipProposal>) => {
    setSaving(true);
    try {
      await api.updateClipProposal(projectId, proposal.id, patch);
      onChanged();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const commitEdit = async () => {
    const s = parseTime(start);
    const e = parseTime(end);
    if (s == null || e == null || e <= s) {
      toast({ title: "Invalid times", description: "Format mm:ss or hh:mm:ss, end must be after start.", variant: "destructive" });
      return;
    }
    if (s > maxTime || e > maxTime) {
      toast({ title: "Times exceed source duration", variant: "destructive" });
      return;
    }
    await save({ start: s, end: e, custom_title: title || null });
    setEditing(false);
  };

  const doDelete = async () => {
    try {
      await api.deleteClipProposal(projectId, proposal.id);
      onChanged();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const dur = proposal.end - proposal.start;

  return (
    <div className={`rounded-md border p-2 transition-colors ${proposal.approved ? "border-success/40 bg-success/5" : "border-border bg-secondary/20"}`}>
      <div className="flex items-start gap-2">
        {/* Score badge */}
        {proposal.score > 0 && (
          <Badge variant="outline" className={`text-[10px] font-mono shrink-0 mt-0.5 ${
            proposal.score >= 70 ? "border-success/40 text-success" :
            proposal.score >= 40 ? "border-warning/40 text-warning" :
            "border-muted-foreground/40 text-muted-foreground"
          }`}>
            AI {proposal.score}
          </Badge>
        )}
        <div className="flex-1 min-w-0 space-y-1">
          {editing ? (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-1.5">
                <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="00:00" className="h-7 text-[11px] font-mono" />
                <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="00:30" className="h-7 text-[11px] font-mono" />
              </div>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={proposal.hook_line || "title"} className="h-7 text-[11px]" />
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="h-6 text-[10px] flex-1">Cancel</Button>
                <Button size="sm" onClick={commitEdit} disabled={saving} className="h-6 text-[10px] flex-1">Save</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-semibold leading-snug">
                {proposal.custom_title || proposal.hook_line || "(no title)"}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono flex-wrap">
                <button onClick={() => onSeek(proposal.start)} className="hover:text-primary"><Play className="h-2.5 w-2.5 inline" /> {fmtTime(proposal.start)} → {fmtTime(proposal.end)}</button>
                <span>· <Clock className="h-2.5 w-2.5 inline" /> {dur.toFixed(1)}s</span>
                {proposal.user_adjusted && <Badge variant="outline" className="text-[8px] px-1 py-0 border-accent/40 text-accent">edited</Badge>}
              </div>
              {proposal.reason && proposal.reason !== "manual" && (
                <p className="text-[10px] text-muted-foreground italic leading-snug">"{proposal.reason}"</p>
              )}
            </>
          )}
        </div>
      </div>

      {!editing && (
        <div className="flex gap-1 mt-1.5">
          <Button size="sm" variant={proposal.approved ? "default" : "outline"} className="h-6 text-[10px] flex-1 gap-1"
            onClick={() => save({ approved: !proposal.approved })}>
            {proposal.approved ? <><CheckCircle2 className="h-2.5 w-2.5" /> Approved</> : "Approve"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={doDelete}>
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}

      {rendered && (
        <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-2">
          <CheckCircle2 className="h-3 w-3 text-success" />
          <span className="text-[10px] text-success">Rendered</span>
          <a href={api.clipRenderedVideoUrl(projectId, proposal.id)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline ml-auto">
            Open video <ExternalLink className="h-2.5 w-2.5 inline" />
          </a>
        </div>
      )}
    </div>
  );
}
