import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Sparkles, ArrowRight, ArrowLeft, Loader2, AlertTriangle,
  Film, Scissors, Mic, MicOff, BookOpen, MessageSquare,
  Gamepad2, Flame, HandMetal, HelpCircle, Star, Brain, Images, User, Shuffle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useConfig, useTtsProviders } from "@/hooks/use-api";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const CONTENT_STYLES = [
  { id: "story", label: "Story", icon: BookOpen, desc: "First-person Reddit confessional", color: "text-blue-400" },
  { id: "qa", label: "Q&A", icon: MessageSquare, desc: "Viral AskReddit thread with answers", color: "text-green-400" },
  { id: "interactive", label: "Interactive", icon: Gamepad2, desc: '"Put a finger down" / quizzes with pauses', color: "text-purple-400" },
  { id: "hot_take", label: "Hot Take", icon: Flame, desc: "Controversial opinion that drives comments", color: "text-orange-400" },
];

const NICHES = [
  { id: "relationship_drama", name: "Relationship Drama", emoji: "💔" },
  { id: "childhood_nostalgia", name: "Childhood Nostalgia", emoji: "🧸" },
  { id: "workplace_horror", name: "Workplace Horror", emoji: "💼" },
  { id: "dating_disasters", name: "Dating Disasters", emoji: "🫠" },
  { id: "family_secrets", name: "Family Secrets", emoji: "🤫" },
  { id: "school_memories", name: "School Memories", emoji: "🎒" },
  { id: "paranormal_encounters", name: "Paranormal", emoji: "👻" },
  { id: "neighbor_stories", name: "Neighbor Stories", emoji: "🏠" },
  { id: "travel_nightmares", name: "Travel Nightmares", emoji: "✈️" },
  { id: "food_culture", name: "Food & Culture", emoji: "🍕" },
];

const INTERACTIVE_FORMATS = [
  { id: "put_a_finger_down", label: "Put a Finger Down", icon: HandMetal },
  { id: "would_you_rather", label: "Would You Rather", icon: HelpCircle },
  { id: "rate_yourself", label: "Rate Yourself", icon: Star },
  { id: "guess_the_answer", label: "Guess the Answer", icon: Brain },
];

const VIDEO_MODES = [
  { id: "short_reel", label: "Short Reel", icon: Scissors, desc: "< 60s vertical video" },
  { id: "full_video", label: "Full Video", icon: Film, desc: "Full-length horizontal" },
  { id: "reel", label: "Reel", icon: Film, desc: "60-90s vertical format" },
];

export function GenerateWithAIDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [contentStyle, setContentStyle] = useState("story");
  const [niche, setNiche] = useState("relationship_drama");
  const [customTopic, setCustomTopic] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [interactiveFormat, setInteractiveFormat] = useState("put_a_finger_down");
  const [videoMode, setVideoMode] = useState("short_reel");
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // NEW per-run overrides
  const [narratorGender, setNarratorGender] = useState<"auto" | "male" | "female">("auto");
  const [voiceOverride, setVoiceOverride] = useState<string>("__config__");    // __config__ = use config default
  const [bgSelector, setBgSelector] = useState<string>("__config__");          // __config__ = use config default

  const [submitting, setSubmitting] = useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();

  // Live config + providers for the voice/background dropdowns
  const { data: config } = useConfig();
  const { data: providersData } = useTtsProviders();
  const [bgFolders, setBgFolders] = useState<{ path: string; name: string; video_count: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    api.listBackgroundFolders()
      .then((r) => setBgFolders(Array.isArray(r?.folders) ? r.folders : []))
      .catch((e) => {
        console.warn("[GenerateWithAIDialog] listBackgroundFolders failed:", e);
        setBgFolders([]);
      });
  }, [open]);

  const ttsConfig = (config as any)?.tts ?? {};
  const ttsProvider: string = ttsConfig.provider || "streamlabs_polly";
  const mainVoice: string = ttsConfig.main_voice || "";

  // Build the voice options for the current provider. Falls back to the
  // 21-voice ElevenLabs library when provider=elevenlabs so the dropdown
  // is useful even without a successful /v2/voices fetch.
  //
  // IMPORTANT: filter out any empty-id / empty-label entries. Radix Select
  // throws "A <Select.Item /> must have a value prop that is not an empty
  // string" at render time if ANY item has an empty value — which would
  // crash the whole React tree and blank the page.
  const voiceOptions: { id: string; label: string }[] = useMemo(() => {
    const raw: { id: string; label: string }[] = (() => {
      if (ttsProvider === "elevenlabs") {
        return ELEVENLABS_LIBRARY.map((v) => ({
          id: v.id, label: `${v.name} — ${v.category}`,
        }));
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

  const totalSteps = 5;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.runPipelineAI({
        content_style: contentStyle,
        niche,
        custom_topic: customTopic || undefined,
        custom_title: customTitle || undefined,
        interactive_format: contentStyle === "interactive" ? interactiveFormat : undefined,
        video_mode: videoMode,
        tts_enabled: ttsEnabled,
        narrator_gender: narratorGender,
        voice_override: voiceOverride === "__config__" ? undefined : voiceOverride,
        background_selector:
          bgSelector === "__config__" ? undefined :
          bgSelector === "__all_random__" ? "" : bgSelector,
      });
      toast({
        title: "AI pipeline started",
        description: (
          narratorGender !== "auto" ? `Narrator: ${narratorGender}` :
          voiceOverride !== "__config__" ? "Using custom voice" : "Generating…"
        ),
      });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      setOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(0);
    setContentStyle("story");
    setNiche("relationship_drama");
    setCustomTopic(""); setCustomTitle("");
    setInteractiveFormat("put_a_finger_down");
    setVideoMode("short_reel");
    setTtsEnabled(true);
    setNarratorGender("auto");
    setVoiceOverride("__config__");
    setBgSelector("__config__");
  };

  const renderStep = () => {
    // ── Step 0: Content style ────────────────────────────────────
    if (step === 0) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Content Style</Label>
          <div className="grid grid-cols-1 gap-2">
            {CONTENT_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setContentStyle(s.id)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                  contentStyle === s.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <s.icon className={cn("h-5 w-5 shrink-0", contentStyle === s.id ? s.color : "")} />
                <div>
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-[10px] opacity-70">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <Button onClick={() => setStep(1)} className="w-full gap-2">
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }

    // ── Step 1: Niche + Custom topic ─────────────────────────────
    if (step === 1) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Choose Niche</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {NICHES.map((n) => (
              <button
                key={n.id}
                onClick={() => setNiche(n.id)}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                  niche === n.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <span className="text-sm">{n.emoji}</span>
                <span className="text-[10px] font-medium leading-tight">{n.name}</span>
              </button>
            ))}
          </div>

          {contentStyle === "interactive" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Format</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {INTERACTIVE_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setInteractiveFormat(f.id)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                      interactiveFormat === f.id
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground hover:border-accent/30"
                    )}
                  >
                    <f.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[10px] font-medium">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom Topic (optional)</Label>
            <Input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. 'caught my roommate doing something weird at 3am'"
              className="h-8 text-xs bg-secondary border-border"
            />
            <p className="text-[10px] text-muted-foreground">Leave empty for AI to choose a fresh angle.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom Title (optional)</Label>
            <Input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Override the AI-chosen headline"
              className="h-8 text-xs bg-secondary border-border"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(2)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 2: Voice & TTS ─────────────────────────────────────
    if (step === 2) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Mic className="h-3 w-3" /> Voice
          </Label>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/50">
            <div className="flex items-center gap-2">
              {ttsEnabled ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="text-xs font-medium">Text-to-Speech</p>
                <p className="text-[10px] text-muted-foreground">Off renders a silent video</p>
              </div>
            </div>
            <Button size="sm" variant={ttsEnabled ? "default" : "outline"} onClick={() => setTtsEnabled(!ttsEnabled)} className="h-7 text-xs">
              {ttsEnabled ? "On" : "Off"}
            </Button>
          </div>

          {ttsEnabled && (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Narrator gender
                </Label>
                <div className="grid grid-cols-3 gap-1">
                  {(["auto", "male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setNarratorGender(g)}
                      className={cn(
                        "h-7 text-[10px] rounded border transition-colors capitalize",
                        narratorGender === g
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {g === "auto" ? "Auto (use preset)" : g}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Auto follows your gender-preset in config. Force male/female to override for this run only.
                </p>
              </div>

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
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Provider: <code>{ttsProvider}</code>. Change provider in Config → TTS.
                </p>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(3)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 3: Video + background ─────────────────────────────
    if (step === 3) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Video Format</Label>
          <div className="grid grid-cols-1 gap-2">
            {VIDEO_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setVideoMode(m.id)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                  videoMode === m.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <m.icon className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-xs font-medium">{m.label}</p>
                  <p className="text-[10px] opacity-70">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Images className="h-3 w-3" /> Background footage
            </Label>
            <Select value={bgSelector} onValueChange={setBgSelector}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[280px]">
                <SelectItem value="__config__">
                  Use config default
                </SelectItem>
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
            <p className="text-[10px] text-muted-foreground leading-snug">
              Override the default background for this run. Manage clips on the Backgrounds page.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(4)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 4: Review & generate ──────────────────────────────
    if (step === 4) {
      const styleInfo  = CONTENT_STYLES.find((s) => s.id === contentStyle);
      const nicheInfo  = NICHES.find((n) => n.id === niche);
      const formatInfo = INTERACTIVE_FORMATS.find((f) => f.id === interactiveFormat);
      const voiceLabel =
        voiceOverride === "__config__"
          ? `default (${mainVoice || "—"})`
          : (voiceOptions.find((v) => v.id === voiceOverride)?.label || voiceOverride);
      const bgLabel =
        bgSelector === "__config__"
          ? "config default"
          : bgSelector === "__all_random__"
          ? "all backgrounds (random)"
          : bgSelector;

      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Review</Label>
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3 text-[10px]">
            <Row label="Style" value={styleInfo?.label} />
            <Row label="Niche" value={`${nicheInfo?.emoji} ${nicheInfo?.name}`} />
            {contentStyle === "interactive" && <Row label="Format" value={formatInfo?.label} />}
            {customTopic && <Row label="Topic" value={customTopic} truncate />}
            {customTitle && <Row label="Title" value={customTitle} truncate />}
            <Row label="Video" value={VIDEO_MODES.find((m) => m.id === videoMode)?.label} />
            <Row label="TTS" value={ttsEnabled ? "Enabled" : "Disabled"} />
            {ttsEnabled && <Row label="Narrator" value={narratorGender === "auto" ? "auto (by detection)" : narratorGender} />}
            {ttsEnabled && <Row label="Voice" value={voiceLabel} truncate />}
            <Row label="Background" value={bgLabel} truncate />
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            AI will generate original content using your configured provider, then run the full pipeline with these overrides.
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 gap-2 glow-accent">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-accent/30 hover:border-accent/60 hover:bg-accent/5">
          <Sparkles className="h-4 w-4 text-accent" />
          Generate with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            AI Content Generator
            <span className="text-[10px] text-muted-foreground font-normal ml-auto">
              Step {step + 1} of {totalSteps}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "bg-accent" : "bg-muted"
              )}
            />
          ))}
        </div>
        <DialogErrorBoundary>{renderStep()}</DialogErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, truncate }: { label: string; value?: React.ReactNode; truncate?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("font-medium text-right", truncate && "truncate max-w-[220px]")}>{value}</span>
    </div>
  );
}

// Dialog-local error boundary so a crash inside the wizard (a bad
// SelectItem, a throwing Select value, a malformed config payload…) can't
// take down the entire React tree into a black page. Shows the actual
// error so the user can report it.
class DialogErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: unknown) {
    console.error("[GenerateWithAIDialog] render crash:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-semibold">Dialog crashed — please report this.</p>
          </div>
          <pre className="text-[10px] whitespace-pre-wrap break-words text-muted-foreground bg-background/40 rounded p-2 max-h-40 overflow-auto">
            {this.state.err.name}: {this.state.err.message}
            {this.state.err.stack ? "\n\n" + this.state.err.stack : ""}
          </pre>
          <Button
            size="sm" variant="outline"
            className="h-7 text-[10px]"
            onClick={() => this.setState({ err: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
