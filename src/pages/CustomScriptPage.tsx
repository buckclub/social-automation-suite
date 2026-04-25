import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PenLine, Loader2, Sparkles, Mic, MicOff, Images, Shuffle,
  PlusCircle, ListPlus,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useConfig, useTtsProviders } from "@/hooks/use-api";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";
import { useToast } from "@/hooks/use-toast";

/**
 * Custom Script — paste your own narration text and run it through the
 * existing TTS + caption + render pipeline. No AI generation, no Reddit
 * fetch. Useful when you wrote the script yourself (or in another tool)
 * and just want the rendering side of the suite.
 *
 * Same per-run override controls as the AI dialog (voice, background,
 * narrator gender, video mode, tts on/off). "Run now" fires the
 * pipeline immediately when idle; "Add to queue" enqueues it so you
 * can paste a stack of scripts and walk away.
 */
export default function CustomScriptPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  const { data: providersData } = useTtsProviders();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [videoMode, setVideoMode] = useState<"short_reel" | "reel" | "full_video">("short_reel");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [narratorGender, setNarratorGender] = useState<"auto" | "male" | "female">("auto");
  const [voiceOverride, setVoiceOverride] = useState<string>("__config__");
  const [bgSelector, setBgSelector] = useState<string>("__config__");
  const [bgFolders, setBgFolders] = useState<{ path: string; name: string; video_count: number }[]>([]);
  const [submitting, setSubmitting] = useState<null | "now" | "queue">(null);

  useEffect(() => {
    api.listBackgroundFolders()
      .then((r) => setBgFolders(Array.isArray(r?.folders) ? r.folders : []))
      .catch(() => setBgFolders([]));
  }, []);

  const ttsConfig = (config as any)?.tts ?? {};
  const ttsProvider: string = ttsConfig.provider || "streamlabs_polly";
  const mainVoice: string = ttsConfig.main_voice || "";

  const voiceOptions: { id: string; label: string }[] = useMemo(() => {
    const raw: { id: string; label: string }[] = (() => {
      if (ttsProvider === "elevenlabs") {
        return ELEVENLABS_LIBRARY.map((v) => ({ id: v.id, label: `${v.name} — ${v.category}` }));
      }
      const providers = providersData?.providers ?? [];
      const pp = providers.find((p) => p.id === ttsProvider);
      const detailed = pp?.voices_detailed ?? [];
      const vs = pp?.voices ?? [];
      return vs.map((vid) => {
        const d = detailed.find((x: any) => x.id === vid);
        return { id: vid, label: d ? `${d.name} (${d.lang}, ${d.gender})` : vid };
      });
    })();
    return raw.filter((v) => v && typeof v.id === "string" && v.id.trim() !== "");
  }, [ttsProvider, providersData]);

  // Cheap stats so the user knows roughly how long the rendered video
  // will be. The rest of the suite uses ~155 wpm — same heuristic here.
  const wordCount = useMemo(() => body.trim().split(/\s+/).filter(Boolean).length, [body]);
  const estDurationS = Math.round((wordCount / 155) * 60);

  const submit = async (mode: "now" | "queue") => {
    if (!title.trim() || !body.trim()) {
      toast({ title: "Title + body required", variant: "destructive" });
      return;
    }
    setSubmitting(mode);
    try {
      const r = await api.runCustomScript({
        title: title.trim(),
        body: body.trim(),
        content_style: "story",
        video_mode: videoMode,
        tts_enabled: ttsEnabled,
        narrator_gender: narratorGender,
        voice_override: voiceOverride === "__config__" ? undefined : voiceOverride,
        background_selector:
          bgSelector === "__config__" ? undefined :
          bgSelector === "__all_random__" ? "" : bgSelector,
        enqueue: mode === "queue",
      });
      toast({
        title: r.queued ? "Queued" : "Pipeline started",
        description: r.queued
          ? "Watch the Run Queue panel on the Dashboard."
          : `Rendering "${title.trim().slice(0, 60)}"…`,
      });
      // Clear and go to dashboard so the user can watch progress.
      setTitle("");
      setBody("");
      navigate("/");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        icon={PenLine}
        title="Custom Script"
        subtitle="Paste your own narration — runs through TTS + captions + render with no AI generation step."
      />

      {/* Script inputs */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The hook line — appears on the title card and in metadata"
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Script</Label>
              <span className="text-[10px] text-muted-foreground font-mono">
                {wordCount} words · ~{estDurationS}s spoken
              </span>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                "Paste the narration verbatim. The TTS engine will read every word.\n\n" +
                "Pro tip: use blank lines between paragraphs to give the renderer\n" +
                "natural pause boundaries for caption chunking."
              }
              className="bg-secondary border-border font-mono text-xs min-h-[280px]"
            />
            <p className="text-[10px] text-muted-foreground leading-snug">
              No prefilter is applied beyond ASCII normalization (smart-quotes etc).
              Punctuation, line breaks, and capitalization land as you typed them.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Per-run overrides */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Render settings</Label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Video format</Label>
              <Select value={videoMode} onValueChange={(v) => setVideoMode(v as any)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_reel">Short Reel (&lt;60s)</SelectItem>
                  <SelectItem value="reel">Reel (60-90s)</SelectItem>
                  <SelectItem value="full_video">Full Video</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Narrator gender</Label>
              <div className="grid grid-cols-3 gap-1">
                {(["auto", "male", "female"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setNarratorGender(g)}
                    className={cn(
                      "h-8 text-[10px] rounded border transition-colors capitalize",
                      narratorGender === g
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30",
                    )}
                  >
                    {g === "auto" ? "Auto" : g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                {ttsEnabled ? <Mic className="h-3 w-3 text-primary" /> : <MicOff className="h-3 w-3 text-muted-foreground" />}
                Text-to-Speech
              </Label>
              <div className="flex items-center gap-2 h-8">
                <Switch checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
                <span className="text-[10px] text-muted-foreground">
                  {ttsEnabled ? "Will narrate the script" : "Silent video — captions only"}
                </span>
              </div>
            </div>
          </div>

          {ttsEnabled && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Voice (optional override)</Label>
              <Select value={voiceOverride} onValueChange={setVoiceOverride}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  <SelectItem value="__config__">
                    Use config default {mainVoice && <span className="text-muted-foreground">({mainVoice})</span>}
                  </SelectItem>
                  {voiceOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Provider: <code>{ttsProvider}</code>. Change provider in Config → TTS.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Images className="h-3 w-3" /> Background footage
            </Label>
            <Select value={bgSelector} onValueChange={setBgSelector}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[280px]">
                <SelectItem value="__config__">Use config default</SelectItem>
                <SelectItem value="__all_random__">
                  <span className="flex items-center gap-1"><Shuffle className="h-3 w-3" /> All backgrounds — random</span>
                </SelectItem>
                {(bgFolders || []).filter((f) => f && typeof f.path === "string" && f.path.trim() !== "").map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    📁 {f.name} <span className="text-muted-foreground">({f.video_count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Action bar */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => submit("queue")}
          disabled={submitting !== null || !title.trim() || !body.trim()}
          className="flex-1 gap-2"
        >
          {submitting === "queue" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          Add to run queue
        </Button>
        <Button
          onClick={() => submit("now")}
          disabled={submitting !== null || !title.trim() || !body.trim()}
          className="flex-1 gap-2 glow-accent"
        >
          {submitting === "now" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Render now
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Tip: paste several scripts in a row by repeatedly clicking <b>Add to run queue</b> —
        the worker drains them serially. Watch progress on the Dashboard.
      </p>
    </div>
  );
}
