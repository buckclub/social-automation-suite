import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Compass, Loader2, Sparkles, ArrowLeft, Globe, Users, Shield, ShieldAlert, ShieldOff,
  Tag, TrendingUp, Copy, Check, Plus, Youtube,
} from "lucide-react";
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
import { useBrand } from "@/contexts/BrandContext";

type Niche = {
  name: string; description: string; why_trending: string;
  saturation: "low" | "medium" | "high"; audience: string;
  channel_name_ideas: string[]; first_video_ideas: string[];
  fit_score: number;
};

type Filter = "safe" | "normal" | "edgy";
const FILTER_OPTS: { id: Filter; label: string; icon: any; tone: string }[] = [
  { id: "safe",   label: "Safe",   icon: Shield,      tone: "text-emerald-400" },
  { id: "normal", label: "Normal", icon: ShieldAlert, tone: "text-amber-400" },
  { id: "edgy",   label: "Edgy",   icon: ShieldOff,   tone: "text-rose-400" },
];

const REGION_OPTS = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IN", name: "India" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "BR", name: "Brazil" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
];

/**
 * Niche Finder — the "what should my next channel be?" tool.
 *
 * User supplies seed interests + target audience + content-filter
 * preference + region. We pull current YouTube trending data + per-
 * keyword top-videos for each seed, feed both into the LLM, and surface
 * a ranked list of niche cards. Each card has a one-click "Create
 * brand from this niche" button that pre-fills the new-brand dialog
 * on /brands.
 */
export default function NicheFinderPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { refresh: refreshBrands } = useBrand();

  const [interests, setInterests] = useState("");
  const [audience, setAudience] = useState("");
  const [filter, setFilter] = useState<Filter>("normal");
  const [region, setRegion] = useState("US");
  const [count, setCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [trendSignals, setTrendSignals] = useState<{ trending_count: number; keywords_used: string[] } | null>(null);

  const generate = async () => {
    setGenerating(true);
    setNiches([]);
    setTrendSignals(null);
    try {
      const r = await api.generateNiches({
        interests, audience, content_filter: filter, region, count,
      });
      setNiches(r.niches || []);
      setTrendSignals(r.trend_signals || null);
      if (r.niches.length === 0) {
        toast({ title: "No niches returned", description: "Try different seed interests or a wider audience.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const createBrandFrom = async (n: Niche) => {
    // Use the first channel name idea as the brand name; the user can
    // rename inline on /brands. Color is randomised from a small palette.
    const palette = ["#FF5577", "#FF8855", "#FFB84D", "#39C76A", "#3ABCE7", "#7C5CFF", "#D45FB8"];
    const color = palette[Math.floor(Math.random() * palette.length)];
    const proposedName = (n.channel_name_ideas[0] || n.name || "New brand").trim();
    try {
      await api.createBrand({ name: proposedName, color, snapshot_current: true });
      await refreshBrands();
      toast({
        title: `Brand "${proposedName}" created`,
        description: "Snapshotted current config. Switch to it via the header pill, then tweak captions / title card / voice for this niche.",
      });
      navigate("/brands");
    } catch (e: any) {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Compass className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Niche Finder</h1>
            <p className="text-xs text-muted-foreground">
              Real YouTube trend data + your brief → ranked niche ideas with
              channel names, descriptions, and first-video pitches.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>

      {/* Brief form */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Seed interests <span className="opacity-70">(optional, comma-separated)</span>
            </Label>
            <Textarea
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="e.g. retro tech, 90s nostalgia, ASMR cooking — leave empty to surprise yourself with pure trend data"
              className="bg-secondary border-border text-xs min-h-[60px]"
            />
            <p className="text-[10px] text-muted-foreground leading-snug">
              Each comma-separated keyword triggers a YouTube top-videos search (90 days, view-sorted)
              that's fed to the LLM. ~100 quota units per seed, capped at 5 seeds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> Target audience
              </Label>
              <Input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. men 18-25 interested in tech"
                className="bg-secondary border-border h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Content filter</Label>
              <div className="grid grid-cols-3 gap-1">
                {FILTER_OPTS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "h-8 text-[10px] rounded border transition-colors flex items-center justify-center gap-1",
                      filter === f.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30",
                    )}
                  >
                    <f.icon className={cn("h-3 w-3", filter === f.id ? "" : f.tone)} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Globe className="h-3 w-3" /> Region
              </Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGION_OPTS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.name} ({r.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground shrink-0">Niches to return:</Label>
            {[3, 5, 6, 8, 10].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={count === n ? "default" : "outline"}
                onClick={() => setCount(n)}
                className="h-7 w-7 p-0 text-[10px]"
              >
                {n}
              </Button>
            ))}
            <Button
              size="sm"
              onClick={generate}
              disabled={generating}
              className="ml-auto gap-1 glow-accent"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Find niches
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Trend-signal summary */}
      {trendSignals && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <Youtube className="h-3 w-3 text-[#ff0000]" />
          Synthesised from <b className="text-foreground">{trendSignals.trending_count}</b> trending videos in <code>{region}</code>
          {trendSignals.keywords_used.length > 0 && (
            <> + top videos for {trendSignals.keywords_used.map((k) => <code key={k} className="ml-1">{k}</code>)}</>
          )}
        </div>
      )}

      {/* Results */}
      {generating && (
        <Card className="border-border bg-card">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            <p className="text-xs">Pulling YouTube trend data + asking the LLM to synthesise…</p>
          </CardContent>
        </Card>
      )}

      {!generating && niches.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {niches.map((n, i) => (
            <NicheCard key={i} niche={n} onUseAsBrand={() => createBrandFrom(n)} />
          ))}
        </div>
      )}

      {!generating && niches.length === 0 && !trendSignals && (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground space-y-1">
            <Compass className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p>Fill in the brief above and hit <b>Find niches</b>.</p>
            <p>Leave seed interests empty to let the LLM pick purely from the trending feed.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NicheCard({ niche, onUseAsBrand }: { niche: Niche; onUseAsBrand: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1200);
  };

  const satTone =
    niche.saturation === "low"    ? "border-success/40 text-success" :
    niche.saturation === "medium" ? "border-amber-400/40 text-amber-400" :
                                    "border-rose-400/40 text-rose-400";
  const fitTone =
    niche.fit_score >= 80 ? "border-success/40 text-success" :
    niche.fit_score >= 60 ? "border-amber-400/40 text-amber-400" :
                            "border-muted-foreground/40 text-muted-foreground";

  return (
    <Card className="border-border bg-card hover:border-primary/40 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-bold">{niche.name}</h3>
              <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 font-mono", fitTone)}>
                fit {niche.fit_score}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{niche.description}</p>
          </div>
          <Button
            size="sm"
            onClick={onUseAsBrand}
            className="shrink-0 gap-1 h-7 text-[10px]"
            title="Snapshots current config as a new brand named after this niche"
          >
            <Plus className="h-3 w-3" /> Use as brand
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 capitalize", satTone)}>
            {niche.saturation} saturation
          </Badge>
          {niche.audience && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
              <Users className="h-2.5 w-2.5 mr-0.5" /> {niche.audience}
            </Badge>
          )}
        </div>

        {niche.why_trending && (
          <div className="rounded border border-border/60 bg-secondary/40 p-2">
            <div className="flex items-start gap-1.5">
              <TrendingUp className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <p className="text-[10px] leading-snug text-muted-foreground">
                <span className="text-foreground font-medium">Why now: </span>
                {niche.why_trending}
              </p>
            </div>
          </div>
        )}

        {niche.channel_name_ideas.length > 0 && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Channel name ideas</Label>
            <div className="flex flex-wrap gap-1">
              {niche.channel_name_ideas.map((c) => (
                <button
                  key={c}
                  onClick={() => copy(c, c)}
                  className="text-[10px] rounded border border-border bg-secondary/60 hover:bg-secondary px-1.5 py-0.5 inline-flex items-center gap-1 transition-colors"
                  title="Copy"
                >
                  {copied === c ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5 text-muted-foreground" />}
                  <span className="font-medium">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {niche.first_video_ideas.length > 0 && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">First video ideas</Label>
            <ul className="text-[11px] space-y-0.5">
              {niche.first_video_ideas.map((v, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-muted-foreground font-mono text-[9px] mt-0.5 shrink-0">{i + 1}.</span>
                  <span className="leading-snug">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            onClick={() => copy("desc", niche.description)}
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {copied === "desc" ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
            Copy description
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
