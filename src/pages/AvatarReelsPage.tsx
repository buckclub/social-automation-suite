import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  User, Loader2, Upload, Trash2, Check, Save,
  AlertTriangle, Tag,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfig, useUpdateConfig } from "@/hooks/use-api";
import { useBrand } from "@/contexts/BrandContext";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const EMOTIONS = ["neutral", "happy", "sad", "angry", "surprised", "confused", "excited"] as const;
type Emotion = typeof EMOTIONS[number];

type Avatar = { filename: string; emotion: Emotion; talking: boolean; size_bytes: number };

const EMOTION_EMOJI: Record<Emotion, string> = {
  neutral: "😐", happy: "😄", sad: "😢", angry: "😠",
  surprised: "😮", confused: "😕", excited: "🤩",
};

/**
 * Avatar Reels — manage the active brand's PNG-tuber.
 *
 *   - One avatar character per brand (per-brand simplicity).
 *   - Upload PNGs, tag each with emotion + talking-state.
 *   - Animation knobs live on the active brand's `avatar` config block:
 *     position, scale, jiggle, threshold, fps, etc. Saved via PUT /api/config
 *     so they get auto-snapshotted into the brand on the next switch.
 *
 * The render pipeline picks up avatar.enabled and the PNG library
 * automatically — no separate render flow. Just enable + upload + run
 * any normal Generate-with-AI / Custom Script / Reddit pipeline.
 */
export default function AvatarReelsPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { active: activeBrand } = useBrand();
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Avatar settings (live config.avatar block, mirrored into the active brand on switch).
  const cfgAvatar = (config?.avatar as any) || {};
  const [enabled, setEnabled] = useState<boolean>(false);
  const [position, setPosition] = useState<"left" | "right" | "center">("right");
  const [scale, setScale] = useState<number>(0.55);
  const [xOffsetPct, setXOffsetPct] = useState<number>(0);
  const [yOffsetPct, setYOffsetPct] = useState<number>(0);
  const [talkThresholdDb, setTalkThresholdDb] = useState<number>(-32);
  const [jiggleAmpPx, setJiggleAmpPx] = useState<number>(8);
  const [jiggleFreqHz, setJiggleFreqHz] = useState<number>(6);
  const [breathAmpPx, setBreathAmpPx] = useState<number>(3);
  const [fps, setFps] = useState<number>(30);
  const [useEmotions, setUseEmotions] = useState<boolean>(true);

  // Hydrate from config when it loads / changes.
  useEffect(() => {
    if (!config) return;
    setEnabled(Boolean(cfgAvatar.enabled));
    setPosition((cfgAvatar.position as any) || "right");
    setScale(typeof cfgAvatar.scale === "number" ? cfgAvatar.scale : 0.55);
    setXOffsetPct(typeof cfgAvatar.x_offset_pct === "number" ? cfgAvatar.x_offset_pct : 0);
    setYOffsetPct(typeof cfgAvatar.y_offset_pct === "number" ? cfgAvatar.y_offset_pct : 0);
    setTalkThresholdDb(typeof cfgAvatar.talk_threshold_db === "number" ? cfgAvatar.talk_threshold_db : -32);
    setJiggleAmpPx(typeof cfgAvatar.jiggle_amp_px === "number" ? cfgAvatar.jiggle_amp_px : 8);
    setJiggleFreqHz(typeof cfgAvatar.jiggle_freq_hz === "number" ? cfgAvatar.jiggle_freq_hz : 6);
    setBreathAmpPx(typeof cfgAvatar.idle_breath_amp_px === "number" ? cfgAvatar.idle_breath_amp_px : 3);
    setFps(typeof cfgAvatar.fps === "number" ? cfgAvatar.fps : 30);
    setUseEmotions(cfgAvatar.use_emotions !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // PNG library (per-brand).
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadEmotion, setUploadEmotion] = useState<Emotion>("neutral");
  const [uploadTalking, setUploadTalking] = useState(false);

  const refresh = async () => {
    if (!activeBrand) { setAvatars([]); return; }
    setLoadingList(true);
    try {
      const r = await api.listAvatars(activeBrand.id);
      setAvatars(r.avatars as Avatar[]);
    } catch (e: any) {
      toast({ title: "Couldn't load avatars", description: e.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { refresh(); }, [activeBrand?.id]);

  const onUpload = async (file: File) => {
    if (!activeBrand) return;
    setUploading(true);
    try {
      await api.uploadAvatar(activeBrand.id, file, uploadEmotion, uploadTalking);
      toast({ title: "PNG uploaded", description: `Tagged as ${uploadEmotion}${uploadTalking ? " (talking)" : ""}` });
      refresh();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onUpdateMeta = async (a: Avatar, patch: Partial<Pick<Avatar, "emotion" | "talking">>) => {
    if (!activeBrand) return;
    try {
      await api.updateAvatarMeta(activeBrand.id, a.filename, patch);
      refresh();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  const onDelete = async (a: Avatar) => {
    if (!activeBrand) return;
    if (!confirm(`Delete "${a.filename}"?`)) return;
    try {
      await api.deleteAvatar(activeBrand.id, a.filename);
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const saveSettings = async () => {
    try {
      await updateConfig.mutateAsync({
        avatar: {
          enabled, position, scale,
          x_offset_pct: xOffsetPct, y_offset_pct: yOffsetPct,
          talk_threshold_db: talkThresholdDb,
          jiggle_amp_px: jiggleAmpPx,
          jiggle_freq_hz: jiggleFreqHz,
          idle_breath_amp_px: breathAmpPx,
          fps,
          use_emotions: useEmotions,
        },
      });
      toast({
        title: "Avatar settings saved",
        description: activeBrand
          ? `Snapshot to "${activeBrand.name}" on the next brand switch — or hit "Save current" on the brand card to lock in now.`
          : "Saved to global config.",
      });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  // Emotion-coverage hint — surface which emotions don't yet have a PNG.
  const emotionStats = useMemo(() => {
    const have: Record<Emotion, { idle: number; talking: number }> = {} as any;
    for (const e of EMOTIONS) have[e] = { idle: 0, talking: 0 };
    for (const a of avatars) {
      const slot = a.talking ? "talking" : "idle";
      if (a.emotion in have) have[a.emotion as Emotion][slot]++;
    }
    return have;
  }, [avatars]);

  const noActiveBrand = !activeBrand;

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <PageHeader
        icon={User}
        title="PNG-tuber"
        subtitle="Animated PNG character that swaps expressions while your script is narrated. One avatar per brand profile."
      />

      {noActiveBrand && (
        <Card className="border-amber-400/40 bg-amber-400/5">
          <CardContent className="p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium">No brand active.</p>
              <p className="text-muted-foreground">
                Avatar Reels is per-brand — pick or create a brand from the header
                pill, then come back here. <Link to="/brands" className="text-primary hover:underline">Manage brands →</Link>
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!noActiveBrand && (
        <>
          {/* Active-brand banner */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3 flex items-center gap-2">
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0"
                style={{ backgroundColor: activeBrand.color }}
              >
                {activeBrand.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-xs">
                  Editing avatar for <b>{activeBrand.name}</b> · {avatars.length} PNG{avatars.length === 1 ? "" : "s"} uploaded
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Settings save to <code>config.avatar</code> and snapshot into this brand on the next switch.
                </p>
              </div>
              <Switch
                checked={enabled} onCheckedChange={setEnabled}
                aria-label="Enable avatar overlay"
              />
              <span className="text-[11px] font-medium">{enabled ? "On" : "Off"}</span>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
            {/* Left: PNG library + upload */}
            <div className="space-y-3">
              <Card className="border-border bg-card">
                <CardContent className="p-3 space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Upload PNG</Label>
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                    <Select value={uploadEmotion} onValueChange={(v) => setUploadEmotion(v as Emotion)}>
                      <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EMOTIONS.map((e) => (
                          <SelectItem key={e} value={e}>{EMOTION_EMOJI[e]} {e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => setUploadTalking((v) => !v)}
                      className={cn(
                        "h-8 text-[11px] rounded border transition-colors flex items-center justify-center gap-1",
                        uploadTalking
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary/60 text-muted-foreground",
                      )}
                    >
                      {uploadTalking && <Check className="h-3 w-3" />} Talking
                    </button>
                    <Button
                      size="sm" onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="gap-1 h-8"
                    >
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      Upload
                    </Button>
                  </div>
                  <input
                    ref={fileRef} type="file" accept="image/png" hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(f);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Best results: transparent PNG, character framed waist-up, ~600px tall, looking
                    forward. Upload one <b>idle</b> + one <b>talking</b> variant per emotion you want
                    to use. The renderer falls back gracefully — even one PNG works.
                  </p>
                </CardContent>
              </Card>

              {/* Library grid */}
              <Card className="border-border bg-card">
                <CardContent className="p-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    Library ({avatars.length})
                  </Label>
                  {loadingList ? (
                    <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
                  ) : avatars.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic text-center py-6">
                      No PNGs yet. Upload your first character image above.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {avatars.map((a) => (
                        <div key={a.filename} className={cn(
                          "rounded-md border bg-secondary/30 p-2 space-y-1.5",
                          a.talking ? "border-primary/40" : "border-border",
                        )}>
                          <div className="aspect-[3/4] bg-black/30 rounded overflow-hidden flex items-center justify-center">
                            <img
                              src={api.avatarPngUrl(activeBrand.id, a.filename, a.filename)}
                              alt={a.filename}
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <Select
                              value={a.emotion}
                              onValueChange={(v) => onUpdateMeta(a, { emotion: v as Emotion })}
                            >
                              <SelectTrigger className="h-6 text-[10px] bg-secondary border-border flex-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EMOTIONS.map((e) => (
                                  <SelectItem key={e} value={e}>{EMOTION_EMOJI[e]} {e}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <button
                              onClick={() => onUpdateMeta(a, { talking: !a.talking })}
                              className={cn(
                                "h-6 px-1.5 text-[9px] rounded border transition-colors",
                                a.talking
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/30",
                              )}
                              title="Toggle talking variant"
                            >
                              {a.talking ? "🗣 talk" : "😶 idle"}
                            </button>
                            <Button
                              size="sm" variant="ghost" className="h-6 w-6 p-0"
                              onClick={() => onDelete(a)}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                          <p className="text-[8px] text-muted-foreground font-mono truncate">{a.filename}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Coverage hint */}
              {avatars.length > 0 && (
                <Card className="border-border bg-card">
                  <CardContent className="p-3">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">
                      Emotion coverage
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {EMOTIONS.map((e) => {
                        const c = emotionStats[e];
                        const total = c.idle + c.talking;
                        return (
                          <Badge
                            key={e}
                            variant="outline"
                            className={cn(
                              "text-[10px] px-2 py-0.5 capitalize",
                              total === 0 && "opacity-40",
                              total > 0 && c.talking > 0 && c.idle > 0 && "border-success/40 text-success",
                              total > 0 && (c.talking === 0 || c.idle === 0) && "border-amber-400/40 text-amber-400",
                            )}
                          >
                            {EMOTION_EMOJI[e]} {e} · {c.idle}🟢 / {c.talking}🗣
                          </Badge>
                        );
                      })}
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-snug mt-2">
                      Green = both idle + talking variants present. Amber = only one variant.
                      Faded = no PNG yet (renderer falls back to neutral).
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: animation settings */}
            <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
              <Card className="border-border bg-card">
                <CardContent className="p-3 space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Position & size</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(["left", "center", "right"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setPosition(p)}
                        className={cn(
                          "h-7 text-[10px] rounded border transition-colors capitalize",
                          position === p
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary/60 text-muted-foreground",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      Size ({Math.round(scale * 100)}% of frame height)
                    </Label>
                    <Slider value={[Math.round(scale * 100)]} min={20} max={90} step={1}
                      onValueChange={([v]) => setScale(v / 100)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">X offset ({(xOffsetPct * 100).toFixed(0)}%)</Label>
                      <Slider value={[Math.round(xOffsetPct * 100)]} min={-30} max={30} step={1}
                        onValueChange={([v]) => setXOffsetPct(v / 100)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Y offset ({(yOffsetPct * 100).toFixed(0)}%)</Label>
                      <Slider value={[Math.round(yOffsetPct * 100)]} min={-30} max={30} step={1}
                        onValueChange={([v]) => setYOffsetPct(v / 100)} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardContent className="p-3 space-y-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Animation</Label>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Talk threshold ({talkThresholdDb} dB)</Label>
                    <Slider value={[talkThresholdDb]} min={-50} max={-15} step={1}
                      onValueChange={([v]) => setTalkThresholdDb(v)} />
                    <p className="text-[9px] text-muted-foreground leading-snug">
                      Audio above this level switches to the "talking" variant. Lower = more sensitive.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Talk jiggle ({jiggleAmpPx}px)</Label>
                      <Slider value={[jiggleAmpPx]} min={0} max={30} step={1}
                        onValueChange={([v]) => setJiggleAmpPx(v)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Jiggle rate ({jiggleFreqHz.toFixed(1)} Hz)</Label>
                      <Slider value={[Math.round(jiggleFreqHz * 10)]} min={10} max={120} step={1}
                        onValueChange={([v]) => setJiggleFreqHz(v / 10)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Idle breathing ({breathAmpPx}px)</Label>
                    <Slider value={[breathAmpPx]} min={0} max={15} step={1}
                      onValueChange={([v]) => setBreathAmpPx(v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Render FPS</Label>
                      <Select value={String(fps)} onValueChange={(v) => setFps(parseInt(v, 10))}>
                        <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24">24 (cinematic)</SelectItem>
                          <SelectItem value="30">30 (default)</SelectItem>
                          <SelectItem value="60">60 (high)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <div className="flex items-center justify-between gap-2 w-full">
                        <Label className="text-[10px] text-muted-foreground">LLM emotion tags</Label>
                        <Switch checked={useEmotions} onCheckedChange={setUseEmotions} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                onClick={saveSettings}
                disabled={updateConfig.isPending}
                className="w-full gap-2 glow-accent"
                size="lg"
              >
                {updateConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save avatar settings
              </Button>

              <p className="text-[10px] text-muted-foreground text-center leading-snug">
                Settings save to <code>config.avatar</code>. Switch to another brand and back to confirm
                they snapshot correctly. To lock the snapshot in immediately, hit
                <Link to="/brands" className="text-primary hover:underline mx-1">"Save current"</Link>
                on the brand card.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
