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
  const [mode, setMode] = useState<"ai_only" | "ai_plus" | "ai_visual" | "event_driven" | "manual">("ai_only");

  // event_driven tuning — exposed right on the page so users can tweak
  // the lead-in/out without touching config.json. Empty region string =
  // no HUD box, falls back to whole-frame detectors.
  const [eventPreRoll,  setEventPreRoll]  = useState(15);
  const [eventPostRoll, setEventPostRoll] = useState(3);
  const [eventHudRegion, setEventHudRegion] = useState<string>("");  // "x1,y1,x2,y2" fractions
  const [pickingHud, setPickingHud] = useState(false);                 // drag overlay active?

  // YAMNet (Layer 2) controls
  const [yamnetEnabled, setYamnetEnabled] = useState(false);
  const [yamnetPreset,  setYamnetPreset]  = useState<"fps" | "sports" | "racing" | "general_action" | "custom">("general_action");
  const [yamnetClasses, setYamnetClasses] = useState<string>("");       // only used when preset=custom
  const [yamnetMinConf, setYamnetMinConf] = useState<number>(0.25);

  // Reference sounds (Layer 3b) — list from backend, uploader input
  type RefSound = { name: string; label: string; min_ncc: number; exists: boolean };
  const [refSounds, setRefSounds] = useState<RefSound[]>([]);
  const refFileInput = useRef<HTMLInputElement | null>(null);

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
  // event_driven mode is transcript-free (gameplay / sports footage), so
  // allow Propose as soon as we have a source file — whether or not
  // whisper has run. The UI makes the choice via the Mode dropdown.
  const canPropose   = !!(proj.transcript?.segments?.length) || !!proj.source_file;
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
      // Build the event_detect override for event_driven mode. Parse the
      // comma-separated HUD region into a 4-tuple of fractions; invalid
      // input silently falls back to no-region.
      let event_detect: Record<string, any> | undefined = undefined;
      if (mode === "event_driven") {
        const region = eventHudRegion
          .split(",").map((s) => parseFloat(s.trim()))
          .filter((n) => !Number.isNaN(n));
        const customClasses = yamnetClasses
          .split(",").map((s) => s.trim()).filter(Boolean);
        event_detect = {
          pre_roll_s:  eventPreRoll,
          post_roll_s: eventPostRoll,
          hud_region:  region.length === 4 ? region : null,
          yamnet: yamnetEnabled ? {
            enabled:        true,
            preset:         yamnetPreset === "custom" ? "" : yamnetPreset,
            target_classes: yamnetPreset === "custom" ? customClasses : [],
            min_confidence: yamnetMinConf,
          } : { enabled: false },
          // Ref sounds live on the project itself (uploaded separately)
          // so we don't send them here — backend merges them in.
        };
      }
      const r = await api.proposeClips(proj.id, {
        target_count: targetCount, min_len_s: minLen, max_len_s: maxLen, mode,
        event_detect,
      });
      toast({ title: `Generated ${r.proposals.length} proposals` });
      refresh();
    } catch (e: any) {
      toast({ title: "Propose failed", description: e.message, variant: "destructive" });
    } finally {
      setProposing(false);
    }
  };

  // ── Reference-sound management ───────────────────────────────────
  const refreshRefs = async () => {
    if (!proj?.id) return;
    try {
      const r = await api.listClipReferences(proj.id);
      setRefSounds(r.references);
    } catch { /* silent — shown as empty list */ }
  };
  useEffect(() => { if (mode === "event_driven") refreshRefs(); }, [mode, proj?.id]);

  const uploadRef = async (file: File) => {
    try {
      const label = file.name.replace(/\.[^.]+$/, "");
      await api.uploadClipReference(proj.id, file, label);
      toast({ title: "Reference sound added", description: label });
      refreshRefs();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };
  const removeRef = async (name: string) => {
    try {
      await api.deleteClipReference(proj.id, name);
      refreshRefs();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  // ── HUD picker — drag a rectangle on the source video ────────────
  // The overlay lives inside the <video> container (see render below).
  // On mouseup we convert pixel coords to 0-1 fractions relative to the
  // video element's client rect and commit to eventHudRegion.
  const hudDrag = useRef<{ startX: number; startY: number; w: number; h: number; left: number; top: number } | null>(null);
  const [hudPreview, setHudPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const onHudDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pickingHud) return;
    const rect = e.currentTarget.getBoundingClientRect();
    hudDrag.current = {
      startX: e.clientX, startY: e.clientY,
      w: rect.width, h: rect.height, left: rect.left, top: rect.top,
    };
    setHudPreview({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
    videoRef.current?.pause();
  };
  const onHudMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pickingHud || !hudDrag.current) return;
    const d = hudDrag.current;
    const x1 = Math.min(e.clientX, d.startX) - d.left;
    const y1 = Math.min(e.clientY, d.startY) - d.top;
    const x2 = Math.max(e.clientX, d.startX) - d.left;
    const y2 = Math.max(e.clientY, d.startY) - d.top;
    setHudPreview({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  };
  const onHudUp = () => {
    if (!pickingHud || !hudDrag.current || !hudPreview) { setPickingHud(false); return; }
    const d = hudDrag.current;
    if (hudPreview.w < 10 || hudPreview.h < 10) {
      setPickingHud(false); hudDrag.current = null; setHudPreview(null);
      return;
    }
    const x1 = Math.max(0, Math.min(1, hudPreview.x / d.w));
    const y1 = Math.max(0, Math.min(1, hudPreview.y / d.h));
    const x2 = Math.max(0, Math.min(1, (hudPreview.x + hudPreview.w) / d.w));
    const y2 = Math.max(0, Math.min(1, (hudPreview.y + hudPreview.h) / d.h));
    const str = [x1, y1, x2, y2].map((n) => n.toFixed(3)).join(",");
    setEventHudRegion(str);
    toast({ title: "HUD region set", description: str });
    setPickingHud(false);
    hudDrag.current = null;
    setHudPreview(null);
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
            <div className="relative">
              <video
                ref={videoRef}
                src={api.clipSourceVideoUrl(proj.id)}
                controls={!pickingHud}
                className="w-full rounded-md bg-black aspect-video"
                preload="metadata"
              />
              {/* HUD-picker overlay — swallows pointer events while active */}
              {pickingHud && (
                <div
                  onPointerDown={onHudDown}
                  onPointerMove={onHudMove}
                  onPointerUp={onHudUp}
                  onPointerCancel={onHudUp}
                  className="absolute inset-0 rounded-md cursor-crosshair bg-black/30 ring-2 ring-accent"
                  style={{ touchAction: "none" }}
                >
                  <div className="absolute top-2 left-2 right-2 text-[11px] text-white bg-black/60 px-2 py-1 rounded pointer-events-none">
                    Drag a rectangle around the HUD region (kill feed, scoreboard, etc). Click-drag to cancel.
                  </div>
                  {hudPreview && (
                    <div
                      className="absolute border-2 border-accent bg-accent/20 pointer-events-none"
                      style={{
                        left: hudPreview.x, top: hudPreview.y,
                        width: hudPreview.w, height: hudPreview.h,
                      }}
                    />
                  )}
                </div>
              )}
            </div>
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
                      <SelectItem value="ai_plus">AI + audio-energy peaks</SelectItem>
                      <SelectItem value="ai_visual">AI + audio peaks + scene cuts</SelectItem>
                      <SelectItem value="event_driven">Event-driven (no transcript — gameplay / sports)</SelectItem>
                      <SelectItem value="manual">Manual (skip AI)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {mode === "event_driven" && (
                  <div className="space-y-3 rounded-md border border-border/60 bg-secondary/30 p-2">
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Detects action moments with audio transients (gunshots, horns, hits) + visual
                      flashes (muzzle flashes, damage overlays, explosions) + optionally YAMNet
                      audio classification + reference-sound template matching. Each detected event
                      becomes a clip with <b>pre-roll</b> seconds of lead-up and <b>post-roll</b>
                      seconds after. No transcript required.
                    </p>

                    {/* Pre/Post roll */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">Pre-roll (s)</Label>
                        <Input type="number" min={0} max={120} value={eventPreRoll}
                          onChange={(e) => setEventPreRoll(+e.target.value || 0)}
                          className="h-7 text-[11px] bg-secondary border-border font-mono" />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-muted-foreground">Post-roll (s)</Label>
                        <Input type="number" min={0} max={60} value={eventPostRoll}
                          onChange={(e) => setEventPostRoll(+e.target.value || 0)}
                          className="h-7 text-[11px] bg-secondary border-border font-mono" />
                      </div>
                    </div>

                    {/* HUD region */}
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-[10px] text-muted-foreground">HUD region</Label>
                        <Button
                          size="sm"
                          variant={pickingHud ? "default" : "outline"}
                          className="h-6 text-[10px] px-2"
                          onClick={() => setPickingHud(!pickingHud)}
                        >
                          {pickingHud ? "Cancel" : "Draw on video"}
                        </Button>
                      </div>
                      <Input
                        placeholder="x1,y1,x2,y2  (e.g. 0.70,0.00,1.00,0.25)"
                        value={eventHudRegion}
                        onChange={(e) => setEventHudRegion(e.target.value)}
                        className="h-7 text-[11px] bg-secondary border-border font-mono"
                      />
                      <p className="text-[9px] text-muted-foreground leading-snug">
                        Restricts visual-change detection to the kill-feed / scoreboard region.
                        Click <b>Draw on video</b> to pick it visually, or leave empty.
                      </p>
                      {eventHudRegion && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-5 text-[10px] text-muted-foreground"
                          onClick={() => setEventHudRegion("")}
                        >Clear</Button>
                      )}
                    </div>

                    {/* YAMNet (Layer 2) */}
                    <div className="space-y-1 rounded border border-border/60 bg-background/30 p-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-semibold">YAMNet audio classes</Label>
                        <Button
                          size="sm"
                          variant={yamnetEnabled ? "default" : "outline"}
                          className="h-6 text-[10px] px-2"
                          onClick={() => setYamnetEnabled(!yamnetEnabled)}
                        >{yamnetEnabled ? "On" : "Off"}</Button>
                      </div>
                      <p className="text-[9px] text-muted-foreground leading-snug">
                        521-class audio tagger (gunshots, cheering, whistles, explosions, sirens…).
                        Needs <code>tflite-runtime</code> or <code>tensorflow</code> installed;
                        model auto-downloads on first use (~15 MB).
                      </p>
                      {yamnetEnabled && (
                        <div className="space-y-1">
                          <Select value={yamnetPreset} onValueChange={(v) => setYamnetPreset(v as any)}>
                            <SelectTrigger className="h-7 text-[11px] bg-secondary border-border">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fps">FPS (gunshots, explosions)</SelectItem>
                              <SelectItem value="sports">Sports (cheering, whistles, bells)</SelectItem>
                              <SelectItem value="racing">Racing (engines, skidding)</SelectItem>
                              <SelectItem value="general_action">General action</SelectItem>
                              <SelectItem value="custom">Custom classes…</SelectItem>
                            </SelectContent>
                          </Select>
                          {yamnetPreset === "custom" && (
                            <Input
                              placeholder="Gunshot, gunfire, Explosion, Cheering"
                              value={yamnetClasses}
                              onChange={(e) => setYamnetClasses(e.target.value)}
                              className="h-7 text-[11px] bg-secondary border-border font-mono"
                            />
                          )}
                          <div className="flex items-center gap-2">
                            <Label className="text-[10px] text-muted-foreground shrink-0">Min conf</Label>
                            <Slider
                              min={0.05} max={0.8} step={0.05}
                              value={[yamnetMinConf]}
                              onValueChange={(v) => setYamnetMinConf(v[0])}
                              className="flex-1"
                            />
                            <span className="text-[10px] font-mono w-8 text-right">{yamnetMinConf.toFixed(2)}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Reference sounds (Layer 3b) */}
                    <div className="space-y-1 rounded border border-border/60 bg-background/30 p-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-semibold">Reference sounds</Label>
                        <Button
                          size="sm" variant="outline"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => refFileInput.current?.click()}
                        >
                          <Upload className="h-3 w-3" /> Upload
                        </Button>
                        <input
                          ref={refFileInput}
                          type="file"
                          accept="audio/*,.wav,.mp3,.m4a,.ogg"
                          hidden
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadRef(f);
                            if (refFileInput.current) refFileInput.current.value = "";
                          }}
                        />
                      </div>
                      <p className="text-[9px] text-muted-foreground leading-snug">
                        Upload a short clip of the exact sound to catch (goal horn, killstreak
                        sting, victory chime). Every match in the source fires an event — near-perfect
                        recall for specific cues.
                      </p>
                      {refSounds.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground italic">No reference sounds yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {refSounds.map((r) => (
                            <div key={r.name} className="flex items-center gap-2 text-[10px]">
                              <span className="truncate flex-1 font-mono">
                                {r.label || r.name}
                                <span className="text-muted-foreground ml-1">({r.min_ncc.toFixed(2)})</span>
                              </span>
                              <Button size="sm" variant="ghost" className="h-5 w-5 p-0"
                                onClick={() => removeRef(r.name)}>
                                <Trash2 className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

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
        <RenderedPreview
          projectId={projectId}
          proposalId={proposal.id}
          renderedAt={(rendered as any).created_at as string | undefined}
        />
      )}
    </div>
  );
}

// ── Inline player for a rendered clip ─────────────────────────────
function RenderedPreview({
  projectId, proposalId, renderedAt,
}: { projectId: string; proposalId: string; renderedAt?: string }) {
  const [open, setOpen] = useState(false);
  // Cache-bust via created_at so a re-render shows the new file right away
  // instead of the browser serving the stale mp4.
  const url = `${api.clipRenderedVideoUrl(projectId, proposalId)}&v=${encodeURIComponent(renderedAt || "")}`;
  return (
    <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-3 w-3 text-success" />
        <span className="text-[10px] text-success font-medium">Rendered</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[10px] text-primary hover:underline"
        >
          {open ? "Hide preview" : "Preview"}
        </button>
        <a
          href={url}
          download
          className="text-[10px] text-muted-foreground hover:text-primary"
          title="Download mp4"
        >
          Download
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-muted-foreground hover:text-primary"
          title="Open in new tab"
        >
          <ExternalLink className="h-2.5 w-2.5 inline" />
        </a>
      </div>
      {open && (
        <video
          src={url}
          controls
          autoPlay
          className="w-full rounded-md bg-black max-h-[360px]"
          playsInline
        />
      )}
    </div>
  );
}
