/**
 * QuickStartChecklist — first-five-minutes checklist on the dashboard.
 *
 * Auto-derives status from existing config + stats so the user doesn't
 * "complete" a step manually — flipping the underlying setting is the
 * source of truth. Auto-hides once everything's checked OR the user
 * clicks "Hide forever" (persisted to localStorage).
 *
 * Designed to coexist with FirstRunGate / FirstRunPage: the wizard
 * blocks the rest of the app until AI is configured, but everything
 * after that step (TTS, brand, first render, YouTube, Discord) is
 * optional. The wizard skipped most of those — this checklist nudges
 * the user back to the rest at their own pace.
 */
import { useMemo, useState } from "react";
import {
  Sparkles, Mic, Tag, Video, Youtube, Check, ChevronRight,
  X, BookOpen,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useConfig, useStats, useVideos } from "@/hooks/use-api";

const HIDE_KEY = "rtr_quickstart_hidden";

interface ChecklistItem {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  href: string;
  cta: string;
  icon: React.ReactNode;
}

export function QuickStartChecklist() {
  const cfg = useConfig();
  const stats = useStats();
  const videos = useVideos();

  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });

  // Each step's "done" predicate is intentionally generous — we want to
  // check off as soon as the user has done the bare minimum, not gate
  // on a perfect setup. The wizard already enforces AI, so it should
  // appear pre-checked on a fresh install.
  const items: ChecklistItem[] = useMemo(() => {
    const c = (cfg.data as Record<string, unknown> | undefined) ?? {};
    const gemini = (c.gemini as Record<string, unknown>) ?? {};
    const tts = (c.tts as Record<string, unknown>) ?? {};
    const yt = (c.youtube as Record<string, unknown>) ?? {};
    const brands = (c.brands as Record<string, unknown>) ?? {};

    const aiKey =
      (gemini.api_key as string) ||
      (gemini.openrouter_api_key as string) ||
      (gemini.nvidia_nim_api_key as string) ||
      (gemini.ollama_url as string) ||
      "";
    const ttsProvider = (tts.provider as string) || "";
    const ttsKey = (tts.api_key as string) || "";
    // Streamlabs Polly + local providers (vibevoice, qwen3tts) need no key.
    const ttsConfigured =
      ttsProvider === "streamlabs_polly" ||
      ttsProvider === "vibevoice" ||
      ttsProvider === "qwen3tts" ||
      Boolean(ttsKey);

    const brandList = (brands.brands as Array<unknown>) ?? [];
    const hasBrand = Array.isArray(brandList) && brandList.length > 0;

    const totalRuns = (stats.data as { total_runs?: number } | undefined)?.total_runs ?? 0;
    const videoCount = ((videos.data as { videos?: unknown[] } | undefined)?.videos ?? []).length;
    const hasRender = totalRuns > 0 || videoCount > 0;

    const hasYouTube = Boolean(yt.api_key);

    return [
      {
        id: "ai",
        label: "Configure an AI provider",
        hint: "Powers story generation, scoring, social copy. Required.",
        done: aiKey.trim().length > 4,
        href: "/config?tab=ai",
        cta: "Open AI Model",
        icon: <Sparkles className="h-3.5 w-3.5" />,
      },
      {
        id: "tts",
        label: "Pick a voice provider",
        hint: "Streamlabs Polly is free with no setup if you don't have an ElevenLabs key.",
        done: ttsConfigured,
        href: "/config?tab=tts",
        cta: "Open Voice",
        icon: <Mic className="h-3.5 w-3.5" />,
      },
      {
        id: "brand",
        label: "Save a brand profile",
        hint: "Snapshots title-card + caption + voice + watermark settings so you can swap channels with one click.",
        done: hasBrand,
        href: "/brands",
        cta: "Add brand",
        icon: <Tag className="h-3.5 w-3.5" />,
      },
      {
        id: "render",
        label: "Generate your first video",
        hint: "Click 'Scan Subreddits' on Posts, pick one, and hit Play to start the pipeline.",
        done: hasRender,
        href: "/posts",
        cta: "Open Posts",
        icon: <Video className="h-3.5 w-3.5" />,
      },
      {
        id: "youtube",
        label: "Connect YouTube (optional)",
        hint: "Only needed for upload + analytics. Skip if you'll publish manually.",
        done: hasYouTube,
        href: "/config?tab=publishing",
        cta: "Open Publishing",
        icon: <Youtube className="h-3.5 w-3.5" />,
      },
    ];
  }, [cfg.data, stats.data, videos.data]);

  const completed = items.filter((i) => i.done).length;
  const total = items.length;
  // Auto-hide once everything (including the optional YouTube step) is
  // done — the user has clearly graduated past needing this.
  const allDone = completed === total;

  if (hidden) return null;
  // While config is loading, render nothing — no flash of an empty card.
  if (cfg.isLoading) return null;
  if (allDone) return null;

  const dismiss = () => {
    try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* ignore */ }
    setHidden(true);
  };

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Quick start</h3>
            <span className="text-[10px] font-mono text-muted-foreground bg-secondary/60 rounded-full px-2 py-0.5">
              {completed} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1">
              <Link to="/guide">
                <BookOpen className="h-3 w-3" /> Guide
              </Link>
            </Button>
            <button
              onClick={dismiss}
              title="Hide forever"
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex items-center justify-center"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar — gives the eye a quick sense of progress before
            the user reads the list. */}
        <div className="h-1 bg-secondary/40 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>

        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                to={it.href}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/40 transition-colors group"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full shrink-0 transition-colors ${
                    it.done
                      ? "bg-success/20 text-success"
                      : "bg-secondary/60 text-muted-foreground border border-dashed border-border"
                  }`}
                >
                  {it.done ? <Check className="h-3 w-3" /> : it.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${it.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {it.label}
                  </p>
                  {!it.done && (
                    <p className="text-[10px] text-muted-foreground leading-snug">{it.hint}</p>
                  )}
                </div>
                {!it.done && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-primary shrink-0">
                    {it.cta} <ChevronRight className="h-3 w-3" />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
