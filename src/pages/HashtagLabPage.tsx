import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Hash, Loader2, Sparkles, Copy, Check, Plus, Youtube,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Platform = "tiktok" | "instagram" | "youtube" | "all";
type Suggestion = { tag: string; score: number; reason: string };

/**
 * Hashtag Lab — paste a caption, get ranked tag suggestions backed by
 * the LLM and (when YouTube API key is set in config) cross-referenced
 * against top-performing videos in the same niche so the suggestions
 * mirror what's actually getting reach.
 *
 * Click any suggestion to add it to your "selection" — the selected
 * tags can be copied as one space-separated block at the bottom.
 */
export default function HashtagLabPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [caption, setCaption] = useState("");
  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState<Platform>("all");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fromCaption, setFromCaption] = useState<string[]>([]);
  const [benchmarksUsed, setBenchmarksUsed] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const analyze = async () => {
    if (!caption.trim()) {
      toast({ title: "Caption is required", variant: "destructive" });
      return;
    }
    setAnalyzing(true);
    try {
      const r = await api.analyzeHashtags({
        caption: caption.trim(),
        niche: niche.trim() || undefined,
        platform,
      });
      setSuggestions(r.suggestions || []);
      setFromCaption(r.from_caption || []);
      setBenchmarksUsed(r.benchmarks_used || 0);
      // Auto-pick the strongest 6 so the user has something to copy immediately.
      setPicked(new Set((r.suggestions || []).slice(0, 6).map((s) => s.tag.toLowerCase())));
    } catch (e: any) {
      toast({ title: "Analyze failed", description: e.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const togglePick = (tag: string) => {
    const key = tag.toLowerCase();
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickedTags = suggestions
    .filter((s) => picked.has(s.tag.toLowerCase()))
    .map((s) => s.tag);
  const pickedString = pickedTags.join(" ");

  const copyAll = async () => {
    if (!pickedString) return;
    await navigator.clipboard?.writeText(pickedString);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        icon={Hash}
        title="Hashtag Lab"
        subtitle="Paste a caption, get ranked tag suggestions cross-referenced against top-performing videos in your niche."
      />

      {/* Inputs */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Caption</Label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Paste the post caption / video description you want to rank tags for…"
              className="bg-secondary border-border text-xs font-mono min-h-[120px]"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                Niche <span className="opacity-60">(optional, but better with)</span>
              </Label>
              <Input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. relationship advice, AITA, tech news, gym"
                className="bg-secondary border-border text-xs h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Target platform</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="youtube">YouTube Shorts</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={analyze}
            disabled={analyzing || !caption.trim()}
            className="w-full gap-2 glow-accent"
          >
            {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Analyze caption
          </Button>
        </CardContent>
      </Card>

      {/* Tags already in caption */}
      {fromCaption.length > 0 && (
        <Card className="border-border bg-secondary/30">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 mt-0.5 shrink-0">In caption</Badge>
              <div className="flex flex-wrap gap-1">
                {fromCaption.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
              These won't be re-recommended below. Remove them from the caption above to get fresh suggestions.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Suggestions list */}
      {suggestions.length > 0 && (
        <Card className="border-border bg-card">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
              <Label className="text-xs text-muted-foreground">
                {suggestions.length} suggestions · {picked.size} selected
                {benchmarksUsed > 0 && (
                  <span className="ml-2 text-[10px]">
                    <Youtube className="h-3 w-3 inline mr-0.5 text-[#ff0000]" />
                    cross-referenced against {benchmarksUsed} top videos
                  </span>
                )}
              </Label>
              <div className="flex gap-1.5">
                <Button
                  size="sm" variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => setPicked(new Set(suggestions.map((s) => s.tag.toLowerCase())))}
                >Select all</Button>
                <Button
                  size="sm" variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => setPicked(new Set())}
                >Clear</Button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
              {suggestions.map((s) => {
                const isPicked = picked.has(s.tag.toLowerCase());
                return (
                  <button
                    key={s.tag}
                    onClick={() => togglePick(s.tag)}
                    className={cn(
                      "w-full text-left rounded-md border px-2.5 py-1.5 transition-colors flex items-center gap-2",
                      isPicked
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/40 hover:border-primary/30",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        isPicked ? "border-primary bg-primary" : "border-border",
                      )}
                    >
                      {isPicked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 font-mono shrink-0 w-9 justify-center",
                        s.score >= 80 ? "border-success/40 text-success" :
                          s.score >= 60 ? "border-amber-400/40 text-amber-400" :
                            "border-border text-muted-foreground",
                      )}
                    >
                      {s.score}
                    </Badge>
                    <span className="text-xs font-medium font-mono">{s.tag}</span>
                    <span className="text-[10px] text-muted-foreground truncate flex-1">
                      {s.reason}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Copy bar */}
      {pickedTags.length > 0 && (
        <Card className="border-primary/40 bg-primary/5 sticky bottom-2">
          <CardContent className="p-3 space-y-1.5">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Plus className="h-3 w-3" />
              {pickedTags.length} tag{pickedTags.length === 1 ? "" : "s"} ready to copy
            </Label>
            <div className="flex gap-2 items-start">
              <code className="flex-1 text-[11px] font-mono break-words bg-background/60 rounded p-2 border border-border max-h-24 overflow-y-auto">
                {pickedString}
              </code>
              <Button size="sm" onClick={copyAll} className="gap-1 shrink-0">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!analyzing && suggestions.length === 0 && (
        <Card className="border-dashed border-border">
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            <Hash className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Paste a caption above and hit <b>Analyze</b> to get ranked tags.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
