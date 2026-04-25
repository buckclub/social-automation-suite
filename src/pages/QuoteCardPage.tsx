import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Quote, Loader2, Sparkles, Download, Image as ImageIcon,
  Square, RectangleVertical, Wand2, Film,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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
};

const DEFAULT_STYLE: Style = {
  size: "square",
  bg_color: "#0F172A",
  text_color: "#F8FAFC",
  accent_color: "#FFD93D",
  font_path: "arial.ttf",
  title_size: 80,
  body_size: 36,
  padding: 100,
  watermark: "",
};
const LS_QUOTE_STYLE = "quotecard_style_v1";

/**
 * Quote Card Generator — single-image quote post for IG / X / Pinterest.
 * Same renderer as carousels (the title field becomes the quote, the
 * body field becomes optional attribution). Pagination indicator is
 * forced off server-side since there's only one slide.
 *
 * Two flows:
 *   - Type your own quote
 *   - Pull AI-extracted quotable lines from any rendered video → click
 *     one to populate the editor
 */
export default function QuoteCardPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [quote, setQuote] = useState("");
  const [attribution, setAttribution] = useState("");
  const [style, setStyle] = useState<Style>(() => {
    try {
      const raw = localStorage.getItem(LS_QUOTE_STYLE);
      if (raw) return { ...DEFAULT_STYLE, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_STYLE;
  });
  const [previewUri, setPreviewUri] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<number | null>(null);

  // AI quote extractor
  const [postId, setPostId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractedQuotes, setExtractedQuotes] = useState<{ text: string; why: string }[]>([]);
  const [sourceTitle, setSourceTitle] = useState("");

  useEffect(() => {
    try { localStorage.setItem(LS_QUOTE_STYLE, JSON.stringify(style)); } catch {}
  }, [style]);

  // Debounced preview
  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    if (!quote.trim()) { setPreviewUri(""); return; }
    previewTimer.current = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const r = await api.renderQuoteCard({ quote, attribution: attribution || undefined, style });
        setPreviewUri(r.data_uri);
      } catch { /* swallow */ }
      finally { setPreviewLoading(false); }
    }, 350);
    return () => { if (previewTimer.current) window.clearTimeout(previewTimer.current); };
  }, [quote, attribution, style]);

  const downloadPng = () => {
    if (!previewUri) return;
    const a = document.createElement("a");
    a.href = previewUri;
    a.download = `quote_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const extractFromPost = async () => {
    if (!postId.trim()) {
      toast({ title: "Post ID required", description: "Find it on the Videos page (e.g. 1abc234 or ai_story_…)", variant: "destructive" });
      return;
    }
    setExtracting(true);
    try {
      const r = await api.extractQuotes({ post_id: postId.trim(), max_quotes: 5 });
      setExtractedQuotes(r.quotes);
      setSourceTitle(r.source_title);
      if (r.quotes.length === 0) {
        toast({ title: "No quotes found in that post" });
      }
    } catch (e: any) {
      toast({ title: "Extract failed", description: e.message, variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  };

  const useQuote = (q: string) => {
    setQuote(q);
    if (sourceTitle) setAttribution(`— ${sourceTitle}`);
  };

  const aspectStyle = {
    aspectRatio: style.size === "square" ? "1 / 1" : "1080 / 1350",
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <PageHeader
        icon={Quote}
        title="Quote Cards"
        subtitle="Single-image quote posts for IG / X / Pinterest. Type a quote or pull the most-quotable lines from any rendered video."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-3">
          {/* AI extractor */}
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Pull quotes from a rendered video
              </Label>
              <div className="flex gap-1.5">
                <Input
                  value={postId}
                  onChange={(e) => setPostId(e.target.value)}
                  placeholder="post_id (e.g. 1abc234, ai_story_20260424_abcdef)"
                  className="bg-secondary border-border h-8 text-xs font-mono"
                  onKeyDown={(e) => { if (e.key === "Enter") extractFromPost(); }}
                />
                <Button size="sm" onClick={extractFromPost} disabled={extracting || !postId.trim()} className="h-8 gap-1">
                  {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Extract
                </Button>
              </div>
              {extractedQuotes.length > 0 && (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {sourceTitle && (
                    <p className="text-[10px] text-muted-foreground">From <strong className="text-foreground">{sourceTitle}</strong></p>
                  )}
                  {extractedQuotes.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => useQuote(q.text)}
                      className="w-full text-left rounded border border-border bg-secondary/40 hover:border-primary/40 px-2 py-1.5 transition-colors"
                    >
                      <p className="text-[11px] font-medium leading-snug">"{q.text}"</p>
                      {q.why && <p className="text-[9px] text-muted-foreground mt-0.5 italic">{q.why}</p>}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Manual editor */}
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Quote</Label>
              <Textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="The quote — appears as the bold heading on the card."
                className="bg-secondary border-border text-xs min-h-[100px]"
              />
              <Label className="text-xs text-muted-foreground">Attribution (optional)</Label>
              <Input
                value={attribution}
                onChange={(e) => setAttribution(e.target.value)}
                placeholder="— Author or source"
                className="bg-secondary border-border h-8 text-xs"
              />
            </CardContent>
          </Card>

          {/* Style */}
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Style</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant={style.size === "square" ? "default" : "outline"}
                  size="sm" className="h-8 text-[10px] gap-1"
                  onClick={() => setStyle((s) => ({ ...s, size: "square" }))}
                >
                  <Square className="h-3 w-3" /> Square 1:1
                </Button>
                <Button
                  variant={style.size === "portrait_4x5" ? "default" : "outline"}
                  size="sm" className="h-8 text-[10px] gap-1"
                  onClick={() => setStyle((s) => ({ ...s, size: "portrait_4x5" }))}
                >
                  <RectangleVertical className="h-3 w-3" /> Portrait 4:5
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <ColorField label="Background" value={style.bg_color} onChange={(v) => setStyle((s) => ({ ...s, bg_color: v }))} />
                <ColorField label="Text" value={style.text_color} onChange={(v) => setStyle((s) => ({ ...s, text_color: v }))} />
                <ColorField label="Accent" value={style.accent_color} onChange={(v) => setStyle((s) => ({ ...s, accent_color: v }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Quote size ({style.title_size}px)</Label>
                <Slider value={[style.title_size]} min={40} max={140} step={2}
                  onValueChange={([v]) => setStyle((s) => ({ ...s, title_size: v }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Padding ({style.padding}px)</Label>
                <Slider value={[style.padding]} min={40} max={220} step={5}
                  onValueChange={([v]) => setStyle((s) => ({ ...s, padding: v }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Watermark / handle</Label>
                <Input
                  value={style.watermark}
                  onChange={(e) => setStyle((s) => ({ ...s, watermark: e.target.value }))}
                  placeholder="@yourhandle"
                  className="bg-secondary border-border h-8 text-xs"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky preview */}
        <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <Card className="border-border bg-card">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Preview</Label>
                {previewLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <div className="rounded-md overflow-hidden bg-black flex items-center justify-center" style={aspectStyle}>
                {previewUri ? (
                  <img src={previewUri} alt="Quote preview" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                )}
              </div>
            </CardContent>
          </Card>
          <Button
            onClick={downloadPng}
            disabled={!previewUri}
            className="w-full gap-2 glow-accent"
            size="lg"
          >
            <Download className="h-4 w-4" /> Download PNG
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
