import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCcw, AlertTriangle, Mic } from "lucide-react";
import { api } from "@/lib/api";
import { useRunPipeline, useElevenLabsVoices, useTtsProviders, useConfig } from "@/hooks/use-api";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";

interface Props {
  postId: string;
  title: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function FullRedoDialog({ postId, title, open, onOpenChange }: Props) {
  const runPipeline = useRunPipeline();
  const { toast } = useToast();
  const { data: config } = useConfig();
  const { data: providersData } = useTtsProviders();

  const provider = (config as any)?.tts?.provider ?? "streamlabs_polly";
  const currentVoice = (config as any)?.tts?.main_voice ?? "";
  const elevenVoicesQuery = useElevenLabsVoices(open && provider === "elevenlabs");

  const [narratorMode, setNarratorMode] = useState<"auto" | "male" | "female">("auto");
  const [voiceOverride, setVoiceOverride] = useState<string>("");  // empty = use config default
  const [detectedGender, setDetectedGender] = useState<"male" | "female" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNarratorMode("auto");
    setVoiceOverride("");
    setConfirmOpen(false);
    api.getNarratorGender(postId).then((r) => setDetectedGender(r.detected)).catch(() => {});
  }, [open, postId]);

  const handleRun = () => {
    const params: Parameters<typeof runPipeline.mutate>[0] = {
      post_id: postId,
      narrator_gender: narratorMode,
      fresh: true,
    };
    if (voiceOverride.trim()) {
      params.voice_override = voiceOverride.trim();
    }
    runPipeline.mutate(params, {
      onSuccess: (r) => {
        if (r.queued) {
          toast({
            title: "Queued — pipeline busy",
            description: `"${title.slice(0, 60)}" will redo after the current render.`,
          });
        } else {
          toast({
            title: "Full pipeline started",
            description: `Redoing "${title}" from scratch. New TTS credits will be used.`,
          });
        }
        onOpenChange(false);
      },
      onError: (e) => toast({ title: "Redo failed", description: e.message, variant: "destructive" }),
    });
  };

  // Voice options for the override dropdown.
  const voiceOptions: { id: string; label: string }[] = (() => {
    if (provider === "elevenlabs") {
      const v = elevenVoicesQuery.data?.voices ?? [];
      const out = v.map((vv) => ({ id: vv.voice_id, label: `${vv.name}${vv.category ? ` — ${vv.category}` : ""}` }));
      for (const lib of ELEVENLABS_LIBRARY) {
        if (!out.some((x) => x.id === lib.id)) {
          out.push({ id: lib.id, label: `${lib.name} (library) — ${lib.category}` });
        }
      }
      return out;
    }
    const providers = providersData?.providers ?? [];
    const pp = providers.find((p) => p.id === provider);
    const detailed = pp?.voices_detailed ?? [];
    const raw = pp?.voices ?? [];
    return raw.map((vid) => {
      const d = detailed.find((x: any) => x.id === vid);
      return { id: vid, label: d ? `${d.name} (${d.lang}, ${d.gender})` : vid };
    });
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <RefreshCcw className="h-4 w-4 text-accent" /> Full Redo
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Re-runs the <strong>entire pipeline</strong> for "{title}" — fetches Reddit post again,
            regenerates TTS audio, re-renders video. Old audio + video will be deleted and
            this post will be re-eligible for discovery.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
          <p className="text-[10px] leading-snug text-warning">
            <strong>Costs TTS credits</strong> (ElevenLabs, etc.). If you just want to change
            caption appearance or video settings, use <strong>Re-render</strong> instead — it
            keeps the existing audio.
          </p>
        </div>

        {/* Narrator voice */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="h-3.5 w-3.5 text-primary" />
            <Label className="text-xs">Narrator Voice</Label>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            {detectedGender === null
              ? "No gender hint detected in the post."
              : `Detected narrator: ${detectedGender}`}
            {narratorMode === "auto" && detectedGender
              ? ` → will pick the ${detectedGender} preset from your config`
              : narratorMode !== "auto"
              ? ` → forcing ${narratorMode}`
              : " → will use your Main Narrator Voice"}
          </p>
          <Select value={narratorMode} onValueChange={(v) => setNarratorMode(v as "auto" | "male" | "female")}>
            <SelectTrigger className="h-8 text-xs bg-secondary border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect from post</SelectItem>
              <SelectItem value="male">Force male preset</SelectItem>
              <SelectItem value="female">Force female preset</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Optional voice override */}
        <div className="space-y-1">
          <Label className="text-xs">Override Voice (optional)</Label>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Pick a specific voice for this run instead of the preset.
            Current config uses <code>{currentVoice || "—"}</code>.
          </p>
          <Select value={voiceOverride || "__none__"} onValueChange={(v) => setVoiceOverride(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-8 text-xs bg-secondary border-border">
              <SelectValue placeholder="Use preset / current voice" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="__none__">Use preset / current voice</SelectItem>
              {voiceOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {provider === "elevenlabs" && (voiceOptions.length === 0) && (
            <p className="text-[10px] text-muted-foreground italic">
              (ElevenLabs voices load when you open the dialog — if empty, check your API key in the TTS tab.)
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={runPipeline.isPending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => setConfirmOpen(true)}
            disabled={runPipeline.isPending}
            className="gap-1"
          >
            {runPipeline.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Redo full pipeline
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm full pipeline redo"
        icon={<AlertTriangle className="h-4 w-4 text-warning" />}
        description={
          <div className="space-y-1.5">
            <p>
              This will <strong>permanently delete</strong> the existing audio, video, and
              workspace for "<strong>{title}</strong>" and run the pipeline from scratch.
            </p>
            <p>
              New TTS credits (ElevenLabs etc.) <strong>will be used</strong>. The post will
              be re-fetched from Reddit and regenerated with your current config
              {narratorMode !== "auto" ? ` (forcing ${narratorMode} voice preset)` : ""}
              {voiceOverride ? ` (override voice ${voiceOverride.slice(0, 12)}…)` : ""}
              .
            </p>
          </div>
        }
        confirmLabel="Yes, redo everything"
        variant="warning"
        onConfirm={() => {
          setConfirmOpen(false);
          handleRun();
        }}
        isLoading={runPipeline.isPending}
      />
    </Dialog>
  );
}
