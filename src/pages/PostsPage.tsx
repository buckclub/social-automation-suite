import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search, RefreshCw, Loader2, Play, Filter, ArrowUpDown, ExternalLink,
  CheckCircle2, XCircle, AlertTriangle, Flame, TrendingUp, Clock, Star,
  Trophy, Sparkles, Save, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useDiscoverPosts } from "@/hooks/use-api";
import { GenerateFromUrlDialog } from "@/components/GenerateFromUrlDialog";
import { GenerateFromCustomDialog } from "@/components/GenerateFromCustomDialog";
import { CommentSelectionDialog } from "@/components/CommentSelectionDialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { RedditPost, AiScore } from "@/lib/api";

const REDDIT_SORTS = [
  { id: "hot", label: "Hot", icon: Flame },
  { id: "viral", label: "Viral", icon: TrendingUp },
  { id: "best", label: "Best", icon: Star },
  { id: "new", label: "New", icon: Clock },
  { id: "rising", label: "Rising", icon: TrendingUp },
  { id: "top", label: "Top", icon: Trophy },
] as const;

type RedditSort = typeof REDDIT_SORTS[number]["id"];

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// --- Filter preset shape + localStorage helpers ----------------------------
interface FilterPreset {
  name: string;
  search: string;
  excludeKeywords: string;        // comma-separated, case-insensitive
  mustContain: string;            // comma-separated
  subredditDeny: string;          // comma-separated subreddit names (no r/)
  eligibleOnly: boolean;
  minScore: number;
  minComments: number;
  minViralPerHr: number;
  maxDurationS: number;           // 0 = no cap
  minAiScore: number;             // 0 = no threshold
  dedupeWarn: boolean;            // hide near-duplicates of used posts
}

const EMPTY_PRESET: FilterPreset = {
  name: "",
  search: "",
  excludeKeywords: "",
  mustContain: "",
  subredditDeny: "",
  eligibleOnly: false,
  minScore: 0,
  minComments: 0,
  minViralPerHr: 0,
  maxDurationS: 0,
  minAiScore: 0,
  dedupeWarn: true,
};

const PRESETS_KEY = "rtr_filter_presets_v1";
const ACTIVE_PRESET_KEY = "rtr_active_filter_preset";

function loadPresets(): FilterPreset[] {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]") || []; } catch { return []; }
}
function savePresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}
function tokens(s: string): string[] {
  return s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export default function PostsPage() {
  const [redditSort, setRedditSort] = useState<RedditSort>("hot");
  const { data, refetch, isFetching, isError, error } = useDiscoverPosts(redditSort);
  const [selectedPost, setSelectedPost] = useState<RedditPost | null>(null);
  const [sortBy, setSortBy] = useState<"score" | "comments" | "age" | "viral" | "ai">("score");
  const { toast } = useToast();

  // Filter state (flat so a preset can replace it wholesale)
  const [f, setF] = useState<FilterPreset>(EMPTY_PRESET);
  const update = <K extends keyof FilterPreset>(k: K, v: FilterPreset[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  // Filter presets
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets());
  const [activePreset, setActivePreset] = useState<string>(
    localStorage.getItem(ACTIVE_PRESET_KEY) || ""
  );
  useEffect(() => {
    // Auto-apply active preset once on mount if one is saved
    if (activePreset) {
      const p = presets.find((x) => x.name === activePreset);
      if (p) setF({ ...p, name: activePreset });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI score state keyed by post id
  const [aiScores, setAiScores] = useState<Record<string, AiScore>>({});
  const [aiLoading, setAiLoading] = useState(false);

  const posts = data?.posts ?? [];

  const filtered = useMemo(() => {
    const excl = tokens(f.excludeKeywords);
    const must = tokens(f.mustContain);
    const denySubs = new Set(tokens(f.subredditDeny));
    return posts
      .filter((p) => {
        if (f.eligibleOnly && (!p.meets_filters || p.already_used)) return false;
        if (f.dedupeWarn && p.title_dupe_of) return false;
        if (denySubs.size && denySubs.has(p.subreddit.toLowerCase())) return false;
        if (f.minScore && p.score < f.minScore) return false;
        if (f.minComments && p.num_comments < f.minComments) return false;
        if (f.minViralPerHr && (p.viral_score ?? 0) < f.minViralPerHr) return false;
        if (f.maxDurationS && (p.est_duration_s ?? 0) > f.maxDurationS) return false;
        const ai = aiScores[p.id]?.score ?? 0;
        if (f.minAiScore && ai < f.minAiScore) return false;
        const hay = (p.title + " " + (p.selftext || "")).toLowerCase();
        if (must.length && !must.every((t) => hay.includes(t))) return false;
        if (excl.length && excl.some((t) => hay.includes(t))) return false;
        if (f.search) {
          const q = f.search.toLowerCase();
          return p.title.toLowerCase().includes(q) || p.subreddit.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "score") return b.score - a.score;
        if (sortBy === "comments") return b.num_comments - a.num_comments;
        if (sortBy === "viral") return (b.viral_score ?? 0) - (a.viral_score ?? 0);
        if (sortBy === "ai") return (aiScores[b.id]?.score ?? 0) - (aiScores[a.id]?.score ?? 0);
        return a.age_hours - b.age_hours;
      });
  }, [posts, f, aiScores, sortBy]);

  const eligible = posts.filter((p) => p.meets_filters && !p.already_used).length;

  // --- Preset handlers ---
  const saveAsPreset = () => {
    const name = prompt("Preset name?");
    if (!name) return;
    const updated = [...presets.filter((p) => p.name !== name), { ...f, name }];
    setPresets(updated);
    savePresets(updated);
    setActivePreset(name);
    localStorage.setItem(ACTIVE_PRESET_KEY, name);
    toast({ title: "Preset saved", description: name });
  };
  const loadPreset = (name: string) => {
    if (name === "__none__") {
      setF({ ...EMPTY_PRESET });
      setActivePreset("");
      localStorage.removeItem(ACTIVE_PRESET_KEY);
      return;
    }
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setF(p);
    setActivePreset(name);
    localStorage.setItem(ACTIVE_PRESET_KEY, name);
  };
  const deletePreset = () => {
    if (!activePreset) return;
    const updated = presets.filter((p) => p.name !== activePreset);
    setPresets(updated);
    savePresets(updated);
    setActivePreset("");
    localStorage.removeItem(ACTIVE_PRESET_KEY);
  };

  // --- AI scoring ---
  const runAiScore = async () => {
    const visible = filtered.slice(0, 40);
    if (!visible.length) return;
    setAiLoading(true);
    try {
      const r = await api.scoreViralBatch(
        visible.map((p) => ({
          id: p.id, title: p.title, selftext: p.selftext,
          subreddit: p.subreddit, score: p.score, num_comments: p.num_comments,
        }))
      );
      setAiScores((prev) => ({ ...prev, ...r.scores }));
      toast({ title: `AI scored ${Object.keys(r.scores).length} posts` });
    } catch (e: any) {
      toast({ title: "AI scoring failed", description: e.message, variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Post Discovery</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Scan configured subreddits for eligible posts
            {posts.length > 0 && (
              <span> — {eligible} eligible of {posts.length} total</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <GenerateFromCustomDialog />
          <GenerateFromUrlDialog />
          <Button onClick={() => refetch()} disabled={isFetching} className="gap-2">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Scan Subreddits
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Reddit Sort */}
        <div className="flex items-center gap-1.5">
          {REDDIT_SORTS.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={redditSort === s.id ? "default" : "outline"}
              onClick={() => setRedditSort(s.id)}
              className="h-7 px-2 text-xs gap-1"
            >
              <s.icon className="h-3 w-3" />
              {s.label}
            </Button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={f.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="Search by title or subreddit..."
            className="h-9 pl-8 text-xs bg-secondary border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <label className="text-xs text-muted-foreground">Eligible only</label>
          <Switch checked={f.eligibleOnly} onCheckedChange={(v) => update("eligibleOnly", v)} />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          {(["score", "comments", "age", "viral", "ai"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={sortBy === s ? "default" : "outline"}
              onClick={() => setSortBy(s)}
              className="h-7 px-2 text-xs capitalize"
              title={s === "ai" ? "AI virality score — run 'Score with AI' first" : undefined}
            >
              {s}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={runAiScore}
          disabled={aiLoading || filtered.length === 0}
          title="Score visible posts 0–100 for short-form virality using your configured AI provider"
        >
          {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Score with AI ({Math.min(filtered.length, 40)})
        </Button>
      </div>

      {/* Advanced filters + presets */}
      <div className="rounded-md border border-border bg-card/50 p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Preset</span>
          <Select value={activePreset || "__none__"} onValueChange={loadPreset}>
            <SelectTrigger className="h-7 w-[180px] text-xs bg-secondary border-border">
              <SelectValue placeholder="No preset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— none —</SelectItem>
              {presets.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={saveAsPreset}>
            <Save className="h-3 w-3" /> Save as…
          </Button>
          {activePreset && (
            <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 text-destructive"
              onClick={deletePreset}>
              <X className="h-3 w-3" /> Delete "{activePreset}"
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-[10px]"
            onClick={() => setF({ ...EMPTY_PRESET })}>Reset filters</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Exclude keywords (comma-sep)</label>
            <Input value={f.excludeKeywords} onChange={(e) => update("excludeKeywords", e.target.value)}
              placeholder="nsfw, drama, politics" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Must contain (comma-sep, all)</label>
            <Input value={f.mustContain} onChange={(e) => update("mustContain", e.target.value)}
              placeholder="revenge, update" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Deny subreddits</label>
            <Input value={f.subredditDeny} onChange={(e) => update("subredditDeny", e.target.value)}
              placeholder="askreddit, funny" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Min AI score (0–100)</label>
            <Input type="number" min={0} max={100} value={f.minAiScore || ""}
              onChange={(e) => update("minAiScore", +e.target.value || 0)}
              placeholder="0" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Min upvotes</label>
            <Input type="number" min={0} value={f.minScore || ""}
              onChange={(e) => update("minScore", +e.target.value || 0)}
              placeholder="0" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Min comments</label>
            <Input type="number" min={0} value={f.minComments || ""}
              onChange={(e) => update("minComments", +e.target.value || 0)}
              placeholder="0" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Min viral (▲/hr)</label>
            <Input type="number" min={0} value={f.minViralPerHr || ""}
              onChange={(e) => update("minViralPerHr", +e.target.value || 0)}
              placeholder="0" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">Max est. duration (s)</label>
            <Input type="number" min={0} value={f.maxDurationS || ""}
              onChange={(e) => update("maxDurationS", +e.target.value || 0)}
              placeholder="0 = no cap" className="h-7 text-[11px] bg-secondary border-border" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <label className="flex items-center gap-2 text-muted-foreground">
            <Switch checked={f.dedupeWarn} onCheckedChange={(v) => update("dedupeWarn", v)} />
            Hide near-duplicates of used posts
          </label>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-destructive text-center py-4">{(error as Error)?.message}</p>
      )}

      {!isFetching && posts.length === 0 && !isError && (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">No posts loaded</p>
            <p className="text-xs mt-1">Click "Scan Subreddits" to discover posts</p>
          </CardContent>
        </Card>
      )}

      {isFetching && posts.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-xs text-muted-foreground">Scanning subreddits...</p>
          </CardContent>
        </Card>
      )}

      {/* Posts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((post, i) => {
          const isEligible = post.meets_filters && !post.already_used;
          return (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <Card className={`border-border bg-card hover:border-primary/30 transition-all ${!isEligible ? "opacity-50" : ""}`}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xs font-semibold leading-snug line-clamp-2">{post.title}</h3>
                      <p className="text-[10px] font-mono text-muted-foreground mt-1">
                        r/{post.subreddit} · {formatAge(post.age_hours)} ago
                      </p>
                    </div>
                    {isEligible ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : post.already_used ? (
                      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                  </div>

                  {post.selftext && (
                    <p className="text-[10px] text-muted-foreground line-clamp-3 leading-relaxed">{post.selftext}</p>
                  )}

                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                    <span>▲ {post.score.toLocaleString()}</span>
                    <span>💬 {post.num_comments}</span>
                    {post.viral_score !== undefined && post.viral_score > 0 && (
                      <span title="Score per hour since posted" className="flex items-center gap-0.5 text-primary">
                        <TrendingUp className="h-3 w-3" />
                        {post.viral_score.toFixed(0)}/h
                      </span>
                    )}
                    {post.est_duration_s !== undefined && post.est_duration_s > 0 && (
                      <span title="Estimated narration length at ~155 wpm">
                        ~{post.est_duration_s}s
                      </span>
                    )}
                    {aiScores[post.id] && (
                      <AiScoreChip score={aiScores[post.id]} />
                    )}
                    {aiScores[post.id]?.emotion && (
                      <span className="flex items-center gap-0.5" title={`Primary emotion: ${aiScores[post.id].emotion}`}>
                        {emotionEmoji(aiScores[post.id].emotion)}
                      </span>
                    )}
                    {aiScores[post.id]?.content_warnings?.length ? (
                      <span className="flex items-center gap-0.5 text-destructive" title={`Content warnings: ${aiScores[post.id].content_warnings.join(", ")}`}>
                        <AlertTriangle className="h-3 w-3" />
                        CW
                      </span>
                    ) : null}
                    {post.over_18 && <Badge variant="destructive" className="text-[9px] px-1 py-0">NSFW</Badge>}
                  </div>

                  {post.title_dupe_of && !post.already_used && (
                    <p className="text-[10px] text-warning font-mono flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Similar to used: "{post.title_dupe_of.slice(0, 50)}..."
                    </p>
                  )}

                  {!isEligible && (
                    <p className="text-[10px] text-destructive font-mono">
                      {post.already_used ? "Already used" : post.filter_reason}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!isEligible}
                      onClick={() => setSelectedPost(post)}
                      className="h-7 text-xs gap-1 flex-1"
                    >
                      <Play className="h-3 w-3" />
                      Use This Post
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => window.open(`https://reddit.com${post.permalink}`, "_blank")}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <CommentSelectionDialog
        post={selectedPost}
        open={!!selectedPost}
        onOpenChange={(open) => { if (!open) setSelectedPost(null); }}
        actionLabel="Use This Post"
      />
    </motion.div>
  );
}

// ── AI Score UI helpers ─────────────────────────────────────────────────────

function emotionEmoji(emotion: string | null | undefined): string {
  if (!emotion) return "";
  const e = emotion.toLowerCase();
  const map: Record<string, string> = {
    anger: "😡", outrage: "🤬", shock: "😱",
    schadenfreude: "😈", sympathy: "🥺", heartbreak: "💔",
    amusement: "😂", curiosity: "🤔", vindication: "✊",
    disgust: "🤢", awe: "🤯", fear: "😰",
  };
  return map[e] || "✨";
}

function scoreColor(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 70) return "text-success";
  if (n >= 40) return "text-warning";
  return "text-muted-foreground";
}

function Bar({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null;
  const color =
    value >= 70 ? "bg-success" : value >= 40 ? "bg-warning" : "bg-muted-foreground/50";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={scoreColor(value)}>{value}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function AiScoreChip({ score }: { score: AiScore }) {
  const color = scoreColor(score.score);
  return (
    <HoverCard openDelay={120} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          className={`flex items-center gap-0.5 font-medium cursor-help ${color}`}
        >
          <Sparkles className="h-3 w-3" />
          AI {score.score}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-3 space-y-2.5 text-xs" side="top" align="start">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold">AI Analysis</span>
          </div>
          <span className={`font-mono text-sm ${color}`}>{score.score}/100</span>
        </div>

        {score.reason && (
          <p className="text-[11px] text-muted-foreground leading-snug italic">
            "{score.reason}"
          </p>
        )}

        <div className="space-y-1.5">
          <Bar value={score.hook_strength} label="Hook strength" />
          <Bar value={score.payoff_strength} label="Payoff" />
        </div>

        {score.suggested_hook && (
          <div className="space-y-0.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5">
            <p className="text-[9px] uppercase tracking-wide text-primary font-semibold">Suggested opening line</p>
            <p className="text-[11px] leading-snug">"{score.suggested_hook}"</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {score.emotion && (
            <div>
              <p className="text-muted-foreground">Emotion</p>
              <p className="font-medium">{emotionEmoji(score.emotion)} {score.emotion}</p>
            </div>
          )}
          {score.recommended_mode && (
            <div>
              <p className="text-muted-foreground">Best mode</p>
              <p className="font-medium capitalize">{score.recommended_mode}</p>
            </div>
          )}
          {score.target_audience && (
            <div className="col-span-2">
              <p className="text-muted-foreground">Target audience</p>
              <p className="font-medium">{score.target_audience}</p>
            </div>
          )}
        </div>

        {score.pitfalls?.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[9px] uppercase tracking-wide text-warning font-semibold">Watch out for</p>
            <div className="flex flex-wrap gap-1">
              {score.pitfalls.map((p, i) => (
                <Badge key={i} variant="outline" className="text-[9px] border-warning/40 text-warning px-1.5 py-0">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {score.content_warnings?.length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[9px] uppercase tracking-wide text-destructive font-semibold">Content warnings</p>
            <div className="flex flex-wrap gap-1">
              {score.content_warnings.map((c, i) => (
                <Badge key={i} variant="outline" className="text-[9px] border-destructive/40 text-destructive px-1.5 py-0">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <p className="text-[9px] text-muted-foreground text-right pt-1 border-t border-border/40">
          via {score.source}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
