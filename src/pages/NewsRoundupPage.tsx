import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Newspaper, Loader2, ExternalLink, RefreshCw, Sparkles, Globe, Plus,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Feed = { id: string; name: string; url: string; niche: string };
type Item = { title: string; link: string; summary: string; published_at: string; source: string };

/**
 * News Roundup — pick an RSS/Atom feed, browse today's stories, click
 * one to seed the Generate-with-AI dialog with that story's headline +
 * summary as the custom topic. The LLM then writes a script riffing on
 * the news, which the user reviews / approves like any other AI run.
 *
 * Curated feeds come from the backend so we can update the list
 * server-side without a redeploy. Custom URLs are accepted too — paste
 * any RSS / Atom feed and hit Fetch.
 */
export default function NewsRoundupPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [activeFeed, setActiveFeed] = useState<Feed | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load curated feeds on mount.
  useEffect(() => {
    api.listNewsFeeds()
      .then((r) => setFeeds(r.feeds || []))
      .catch(() => setFeeds([]));
  }, []);

  // Group feeds by niche so the picker isn't a flat 11-button row.
  const feedsByNiche = useMemo(() => {
    const m = new Map<string, Feed[]>();
    for (const f of feeds) {
      if (!m.has(f.niche)) m.set(f.niche, []);
      m.get(f.niche)!.push(f);
    }
    return Array.from(m.entries());
  }, [feeds]);

  const fetchUrl = async (url: string, label?: string) => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setItems([]);
    try {
      const r = await api.fetchNewsFeed(url.trim());
      setItems(r.items || []);
      if ((r.items || []).length === 0) {
        setError("Feed parsed OK but contained no items.");
      }
    } catch (e: any) {
      setError(e.message || "Fetch failed");
      toast({ title: "Fetch failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const pickPreset = (f: Feed) => {
    setActiveFeed(f);
    setCustomUrl("");
    fetchUrl(f.url, f.name);
  };

  const useCustom = () => {
    setActiveFeed(null);
    fetchUrl(customUrl);
  };

  // Click a story → seed the Generate-with-AI dialog. We persist the
  // story as a draft so the dialog's Resume banner picks it up. The
  // user opens the dialog from the header and lands on the review
  // screen with the story already plugged in as custom_topic.
  const useStoryAsPrompt = async (it: Item) => {
    const prompt = [
      it.title.trim(),
      it.summary && it.summary.length > 20 ? `\n\n${it.summary.trim()}` : "",
      it.source ? `\n\n— ${it.source}` : "",
    ].join("");
    try {
      // We don't have a "draft seed" endpoint that pre-fills the dialog
      // settings without variants — instead, drop the prompt onto the
      // clipboard and open the AI dialog. User pastes into Custom Topic.
      await navigator.clipboard?.writeText(prompt);
      toast({
        title: "Story copied",
        description: "Click Generate with AI in the header, then paste into Custom Topic.",
      });
    } catch {
      toast({
        title: "Couldn't copy automatically",
        description: prompt.slice(0, 120) + "…",
      });
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        icon={Newspaper}
        title="News Roundup"
        subtitle="Pull today's headlines, click one to seed an AI script. Daily volume + daily algorithm refresh = compounding reach."
      />

      {/* Feed picker */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Curated feeds</Label>
          <div className="space-y-2">
            {feedsByNiche.map(([niche, group]) => (
              <div key={niche} className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{niche}</div>
                <div className="flex flex-wrap gap-1.5">
                  {group.map((f) => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={activeFeed?.id === f.id ? "default" : "outline"}
                      onClick={() => pickPreset(f)}
                      disabled={loading}
                      className="h-7 text-[11px]"
                    >
                      {f.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-border space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Globe className="h-3 w-3" /> Custom RSS / Atom URL
            </Label>
            <div className="flex gap-1.5">
              <Input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
                className="bg-secondary border-border text-xs h-8"
                onKeyDown={(e) => { if (e.key === "Enter") useCustom(); }}
              />
              <Button size="sm" onClick={useCustom} disabled={loading || !customUrl.trim()} className="h-8 gap-1">
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Fetch
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Story list */}
      {loading && (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
            <p className="text-xs">Fetching feed…</p>
          </CardContent>
        </Card>
      )}

      {!loading && error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && items.length > 0 && (
        <Card className="border-border bg-card">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                {items.length} stor{items.length === 1 ? "y" : "ies"}
                {activeFeed && <> from <strong className="text-foreground">{activeFeed.name}</strong></>}
              </Label>
              <Button
                size="sm" variant="ghost"
                onClick={() => activeFeed ? fetchUrl(activeFeed.url) : fetchUrl(customUrl)}
                disabled={loading}
                className="h-6 text-[10px] gap-1"
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {items.map((it, i) => (
                <div
                  key={`${it.link}-${i}`}
                  className={cn(
                    "rounded-md border p-2.5 transition-colors",
                    "border-border bg-secondary/40 hover:border-primary/40",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium leading-snug mb-0.5 line-clamp-2">
                        {it.title}
                      </p>
                      {it.summary && (
                        <p className="text-[10px] text-muted-foreground leading-snug line-clamp-3">
                          {it.summary}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        {it.published_at && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                            {it.published_at.replace("T", " ").slice(0, 16)}
                          </Badge>
                        )}
                        {it.link && (
                          <a
                            href={it.link} target="_blank" rel="noopener noreferrer"
                            className="text-[9px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                          >
                            <ExternalLink className="h-2.5 w-2.5" /> source
                          </a>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => useStoryAsPrompt(it)}
                      className="h-7 gap-1 text-[10px] shrink-0"
                      title="Copy headline + summary, then paste into Generate with AI → Custom Topic"
                    >
                      <Sparkles className="h-3 w-3" /> Use as prompt
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && items.length === 0 && !error && (
        <Card className="border-dashed border-border">
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            <Newspaper className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Pick a curated feed above or paste a custom RSS URL to start.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
