import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type ThreadPost } from "@/lib/thread-split";

interface Props {
  posts: ThreadPost[];
  perPostLimit?: number;
  compact?: boolean;
}

/**
 * Renders a split X-thread as individual tweet-shaped cards with per-post
 * copy + char count. Each card's border turns red if the tweet is over the
 * per-post character limit (defaults to Twitter's 280).
 */
export function ThreadView({ posts, perPostLimit = 280, compact = false }: Props) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copyOne = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
    } catch {
      /* swallow — the page-level card toasts on its own copies */
    }
  };

  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      {posts.map((p, i) => {
        const over = p.text.length > perPostLimit;
        return (
          <div
            key={i}
            className={cn(
              "rounded-md border p-2",
              over
                ? "border-destructive/50 bg-destructive/5"
                : "border-border bg-secondary/40",
            )}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold text-accent">
                {p.index}/{p.total}
              </span>
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px]", over ? "text-destructive" : "text-muted-foreground")}>
                  {p.text.length}/{perPostLimit}
                </span>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => copyOne(p.text, i)}
                  className="h-5 px-1.5 text-[10px] gap-1"
                >
                  {copiedIdx === i ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
            <p className={cn("text-xs whitespace-pre-wrap leading-snug", compact && "text-[11px]")}>
              {p.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
