/**
 * Dashboard panel that surfaces 3-5 fresh story ideas for the active
 * brand's niche. Powered by /api/ideas/daily — backend caches 6h per
 * (niche, content_filter) so opening the dashboard repeatedly is
 * cheap.
 *
 * Each card shows a title + one-line premise + suggested
 * style/tone, and a "Use this" button that copies the premise into
 * the clipboard so the user can paste it into the Generate-with-AI
 * dialog's `custom_topic` field. (Direct dialog auto-open with
 * pre-fill is on the wishlist; clipboard handoff covers the
 * 80% case for now.)
 *
 * Auto-hides when no AI provider is configured (the endpoint would
 * 400) or when the brand has no niche set.
 */
import { useCallback, useEffect, useState } from "react";
import { Lightbulb, RefreshCw, Loader2, ClipboardCopy, Check } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useConfig } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";

type Idea = Awaited<ReturnType<typeof api.generateDailyIdeas>>["ideas"][number];

export function DailyIdeasPanel() {
  const { data: config } = useConfig();
  const { toast } = useToast();

  // Use the brand's niche if set; fall back to the global default.
  // No niche = no panel (the AI would just get 'general' and the
  // ideas would be too vague to be useful).
  const niche: string =
    (config as any)?.formatting?.default_niche ||
    (config as any)?.ai_content_generation?.default_niche ||
    "";
  const aiEnabled: boolean = Boolean((config as any)?.gemini?.enabled);

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const refresh = useCallback(async (force: boolean = false) => {
    if (!niche || !aiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.generateDailyIdeas({ niche, count: 5, force });
      setIdeas(r.ideas);
      setFromCache(r.from_cache);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't load ideas.");
    } finally {
      setLoading(false);
    }
  }, [niche, aiEnabled]);

  // Lazy initial load — only fires once per dashboard mount + per
  // niche change. The 6h backend cache makes this near-free for
  // repeat visits in a session.
  useEffect(() => {
    if (!niche || !aiEnabled) return;
    refresh(false);
  }, [niche, aiEnabled, refresh]);

  if (!niche || !aiEnabled) return null;

  const copy = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      toast({
        title: "Premise copied",
        description: "Paste it into Generate with AI → step 1 → Custom topic.",
      });
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-warning" />
          Today's ideas
          <Badge variant="outline" className="text-[9px] capitalize">{niche.replace(/_/g, " ")}</Badge>
          {fromCache && <Badge variant="outline" className="text-[9px] text-muted-foreground">cached</Badge>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 gap-1 text-[11px]"
            onClick={() => refresh(true)}
            disabled={loading}
            title="Force refresh (skips the 6h cache; uses tokens)"
          >
            {loading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-2 text-xs">
        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}

        {!error && loading && ideas.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            Brainstorming fresh ideas for {niche.replace(/_/g, " ")}…
          </p>
        )}

        {ideas.map((idea, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-secondary/30 p-2.5 space-y-1"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold leading-tight flex-1">
                {idea.title}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => copy(i, idea.premise)}
                title="Copy premise — paste into Generate with AI → Custom topic"
              >
                {copiedIdx === i
                  ? <Check className="h-3 w-3 text-success" />
                  : <ClipboardCopy className="h-3 w-3" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              {idea.premise}
            </p>
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/80">
              <Badge variant="outline" className="text-[9px] capitalize">{idea.content_style.replace(/_/g, " ")}</Badge>
              <Badge variant="outline" className="text-[9px] capitalize">{idea.tone}</Badge>
              {idea.why && <span className="italic ml-1 line-clamp-1">{idea.why}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
