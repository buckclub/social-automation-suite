import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Layers, Loader2, Sparkles, ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown,
  Download, Wand2, Image as ImageIcon, Square, RectangleVertical, RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Slide = { title: string; body: string };
type SizePreset = "square" | "portrait_4x5";
type Style = {
  size: SizePreset;
  bg_color: string;
  text_color: string;
  accent_color: string;
  font_path: string;
  title_size: number;
  body_size: number;
  padding: number;
  watermark: string;
  show_pagination: boolean;
};

const DEFAULT_STYLE: Style = {
  size: "portrait_4x5",
  bg_color: "#0F172A",
  text_color: "#F8FAFC",
  accent_color: "#FFD93D",
  font_path: "arial.ttf",
  title_size: 72,
  body_size: 52,
  padding: 80,
  watermark: "",
  show_pagination: true,
};

// localStorage keys — survive page refresh / accidental nav.
const LS_SLIDES = "carousel_draft_slides_v1";
const LS_STYLE  = "carousel_draft_style_v1";

/**
 * Carousel Posts — single-page editor that produces a downloadable zip
 * of PNG slides for IG / TikTok / LinkedIn carousel posts.
 *
 * Flow:
 *   1. (optional) Paste a long script → AI-split into N slide chunks.
 *   2. Edit slides inline. Add / remove / reorder.
 *   3. Tweak style (size, colors, fonts, watermark).
 *   4. Live preview reflects the active slide via a backend render call
 *      (debounced to avoid hammering the renderer on every keystroke).
 *   5. Download all slides as a zip; upload them to IG/TikTok/etc.
 *
 * State is purely client-side (localStorage auto-save). The backend is
 * stateless — split-script returns slides, render returns a zip blob,
 * preview returns a base64 data URI.
 */
export default function CarouselPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [slides, setSlides] = useState<Slide[]>(() => {
    try {
      const raw = localStorage.getItem(LS_SLIDES);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [{ title: "Hook line goes here.", body: "" }];
  });
  const [style, setStyle] = useState<Style>(() => {
    try {
      const raw = localStorage.getItem(LS_STYLE);
      if (raw) return { ...DEFAULT_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_STYLE;
  });
  const [activeIdx, setActiveIdx] = useState(0);
  const [splitting, setSplitting] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [scriptToSplit, setScriptToSplit] = useState("");
  const [splitCount, setSplitCount] = useState(6);

  // Auto-save to localStorage
  useEffect(() => {
    try { localStorage.setItem(LS_SLIDES, JSON.stringify(slides)); } catch {}
  }, [slides]);
  useEffect(() => {
    try { localStorage.setItem(LS_STYLE, JSON.stringify(style)); } catch {}
  }, [style]);

  // Live preview — debounced server-side render of just the active slide.
  const [previewUri, setPreviewUri] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    if (!slides[activeIdx]) return;
    previewTimer.current = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const r = await api.carouselPreview({
          slide: slides[activeIdx],
          style,
          idx: activeIdx + 1,
          total: slides.length,
        });
        setPreviewUri(r.data_uri);
      } catch {
        // swallow — preview is best-effort
      } finally {
        setPreviewLoading(false);
      }
    }, 350);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
  }, [activeIdx, slides, style]);

  const updateSlide = (idx: number, patch: Partial<Slide>) => {
    setSlides((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const addSlide = () => {
    setSlides((arr) => [...arr, { title: "", body: "" }]);
    setActiveIdx(slides.length);
  };
  const removeSlide = (idx: number) => {
    if (slides.length === 1) {
      toast({ title: "Need at least one slide" });
      return;
    }
    setSlides((arr) => arr.filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, Math.min(cur, slides.length - 2)));
  };
  const moveSlide = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= slides.length) return;
    setSlides((arr) => {
      const next = [...arr];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setActiveIdx(j);
  };

  const splitScript = async () => {
    if (!scriptToSplit.trim()) {
      toast({ title: "Paste a script first", variant: "destructive" });
      return;
    }
    setSplitting(true);
    try {
      const r = await api.carouselSplitScript({ script: scriptToSplit, slide_count: splitCount });
      setSlides(r.slides);
      setActiveIdx(0);
      setScriptToSplit("");
      toast({ title: `Split into ${r.slides.length} slides`, description: "Edit any slide, then download." });
    } catch (e: any) {
      toast({ title: "Split failed", description: e.message, variant: "destructive" });
    } finally {
      setSplitting(false);
    }
  };

  const downloadZip = async () => {
    if (!slides.length) return;
    setRendering(true);
    try {
      const res = await fetch(api.carouselRenderUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slides, style }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Render failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `carousel_${slides.length}slides_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: `Downloaded ${slides.length} slides` });
    } catch (e: any) {
      toast({ title: "Render failed", description: e.message, variant: "destructive" });
    } finally {
      setRendering(false);
    }
  };

  const aspectStyle = useMemo(() => ({
    aspectRatio: style.size === "square" ? "1 / 1" : "1080 / 1350",
  }), [style.size]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Carousel Posts</h1>
            <p className="text-xs text-muted-foreground">
              Multi-slide IG / TikTok / LinkedIn carousels — paste a story,
              AI splits it into slides, edit, download as a zip.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>

      {/* AI splitter */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5" /> AI split a story into slides
            </Label>
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] text-muted-foreground">Slides:</Label>
              {[3, 5, 6, 8, 10].map((n) => (
                <Button
                  key={n} size="sm"
                  variant={splitCount === n ? "default" : "outline"}
                  className="h-6 w-6 p-0 text-[10px]"
                  onClick={() => setSplitCount(n)}
                >{n}</Button>
              ))}
            </div>
          </div>
          <Textarea
            value={scriptToSplit}
            onChange={(e) => setScriptToSplit(e.target.value)}
            placeholder="Paste your story / script here. The LLM picks a hook for slide 1, splits the body into beat-sized chunks, and adds a CTA on the final slide."
            className="bg-secondary border-border text-xs font-mono min-h-[100px]"
          />
          <Button
            onClick={splitScript}
            disabled={splitting || !scriptToSplit.trim()}
            className="w-full gap-1"
            size="sm"
          >
            {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Split into {splitCount} slides
          </Button>
        </CardContent>
      </Card>

      {/* Editor + preview side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-3">
          {/* Slide list */}
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  {slides.length} slide{slides.length === 1 ? "" : "s"}
                </Label>
                <Button size="sm" variant="outline" onClick={addSlide} className="h-7 text-[10px] gap-1">
                  <Plus className="h-3 w-3" /> Add slide
                </Button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {slides.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIdx(i)}
                    className={cn(
                      "shrink-0 rounded-md border px-2 py-1.5 text-left transition-colors min-w-[120px] max-w-[180px]",
                      activeIdx === i
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/40 hover:border-primary/30",
                    )}
                  >
                    <div className="text-[9px] text-muted-foreground">Slide {i + 1}/{slides.length}</div>
                    <div className="text-[10px] font-medium leading-tight line-clamp-2">
                      {(s.title || s.body || "(empty)").slice(0, 80)}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Active slide editor */}
          {slides[activeIdx] && (
            <Card className="border-primary/40 bg-card">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Editing slide {activeIdx + 1}
                  </Label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => moveSlide(activeIdx, -1)} disabled={activeIdx === 0} title="Move up">
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => moveSlide(activeIdx, +1)} disabled={activeIdx === slides.length - 1} title="Move down">
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => removeSlide(activeIdx)} title="Delete">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Title (optional, bold heading)</Label>
                  <Input
                    value={slides[activeIdx].title}
                    onChange={(e) => updateSlide(activeIdx, { title: e.target.value })}
                    placeholder="The hook line that makes them stop scrolling"
                    className="bg-secondary border-border h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Body</Label>
                  <Textarea
                    value={slides[activeIdx].body}
                    onChange={(e) => updateSlide(activeIdx, { body: e.target.value })}
                    placeholder="The paragraph that fills the slide. Keep it readable on mobile (~50-80 words)."
                    className="bg-secondary border-border text-xs min-h-[110px]"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Style controls */}
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Style</Label>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Slide size</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    variant={style.size === "square" ? "default" : "outline"}
                    size="sm" className="h-8 text-[10px] gap-1"
                    onClick={() => setStyle((s) => ({ ...s, size: "square" }))}
                  >
                    <Square className="h-3 w-3" /> Square 1080×1080
                  </Button>
                  <Button
                    variant={style.size === "portrait_4x5" ? "default" : "outline"}
                    size="sm" className="h-8 text-[10px] gap-1"
                    onClick={() => setStyle((s) => ({ ...s, size: "portrait_4x5" }))}
                  >
                    <RectangleVertical className="h-3 w-3" /> Portrait 1080×1350
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ColorField label="Background" value={style.bg_color}
                  onChange={(v) => setStyle((s) => ({ ...s, bg_color: v }))} />
                <ColorField label="Text" value={style.text_color}
                  onChange={(v) => setStyle((s) => ({ ...s, text_color: v }))} />
                <ColorField label="Accent" value={style.accent_color}
                  onChange={(v) => setStyle((s) => ({ ...s, accent_color: v }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Title size ({style.title_size}px)</Label>
                  <Slider value={[style.title_size]} min={32} max={140} step={2}
                    onValueChange={([v]) => setStyle((s) => ({ ...s, title_size: v }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Body size ({style.body_size}px)</Label>
                  <Slider value={[style.body_size]} min={24} max={100} step={2}
                    onValueChange={([v]) => setStyle((s) => ({ ...s, body_size: v }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Padding ({style.padding}px)</Label>
                <Slider value={[style.padding]} min={20} max={200} step={5}
                  onValueChange={([v]) => setStyle((s) => ({ ...s, padding: v }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Watermark / handle</Label>
                <Input
                  value={style.watermark}
                  onChange={(e) => setStyle((s) => ({ ...s, watermark: e.target.value }))}
                  placeholder="@yourhandle (shows bottom-left)"
                  className="bg-secondary border-border h-8 text-xs"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-[11px]">Show "1/N" pagination indicator</Label>
                <Switch
                  checked={style.show_pagination}
                  onCheckedChange={(v) => setStyle((s) => ({ ...s, show_pagination: v }))}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky preview pane */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Preview · slide {activeIdx + 1}/{slides.length}
                </Label>
                {previewLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div
                className="rounded-md overflow-hidden bg-black flex items-center justify-center"
                style={aspectStyle}
              >
                {previewUri ? (
                  <img
                    src={previewUri} alt={`Slide ${activeIdx + 1}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                )}
              </div>
              <p className="text-[9px] text-muted-foreground leading-snug">
                Live render at exact output resolution. Updates ~350 ms after the last edit.
              </p>
            </CardContent>
          </Card>

          <Button
            onClick={downloadZip}
            disabled={rendering || slides.length === 0}
            className="w-full gap-2 glow-accent"
            size="lg"
          >
            {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download {slides.length} slide{slides.length === 1 ? "" : "s"} as zip
          </Button>
          <Button
            onClick={() => {
              if (!confirm("Clear all slides + style? This can't be undone.")) return;
              setSlides([{ title: "", body: "" }]);
              setStyle(DEFAULT_STYLE);
              setActiveIdx(0);
            }}
            variant="ghost" size="sm" className="w-full text-[10px] text-muted-foreground gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Reset to a blank carousel
          </Button>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <div className="flex gap-1">
        <Input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 p-0.5 bg-secondary border-border shrink-0"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-secondary border-border h-8 text-[11px] font-mono flex-1 min-w-0"
        />
      </div>
    </div>
  );
}
