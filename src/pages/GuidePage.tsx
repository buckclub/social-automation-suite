/**
 * GuidePage — in-app reference for new users.
 *
 * Two reasons this lives in-app rather than a README link:
 *
 * 1. Some installs are LAN-served to non-technical operators who don't
 *    have GitHub access — a guide they can open without leaving the app
 *    is genuinely useful.
 * 2. We can deep-link to specific sections from the QuickStartChecklist
 *    + FirstTimeTip toasts (e.g. "Learn more →" buttons), so the guide
 *    becomes the contextual destination instead of a wall of README.
 *
 * Content is intentionally written prose — not a markdown dump — so
 * each section explains *why* a feature exists, not just what each
 * config field does. Links to the relevant config tab where appropriate.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  BookOpen, Sparkles, Mic, Tag, Video, Filter, Wrench,
  RotateCcw, ExternalLink, ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resetFirstTimeTips, countSeenTips } from "@/hooks/use-first-time-tip";
import { useToast } from "@/hooks/use-toast";

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}

// Each section's body is plain JSX — no markdown processor needed for
// this much text, and inline `<Link>` works without escaping. Keep
// paragraphs short; users scan, they don't read.
const SECTIONS: Section[] = [
  {
    id: "first-video",
    title: "Generate your first video",
    icon: <Video className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          The fastest path from clone to video: configure an AI provider in{" "}
          <Link to="/config?tab=ai" className="text-primary underline">Config → AI Model</Link>,
          pick a TTS provider in{" "}
          <Link to="/config?tab=tts" className="text-primary underline">Config → Text-to-Speech</Link>{" "}
          (Streamlabs Polly is free, no key), then go to{" "}
          <Link to="/posts" className="text-primary underline">Posts</Link> and hit{" "}
          <strong>Scan Subreddits</strong>.
        </p>
        <p>
          Each post card shows whether it passes your filters (green check) or
          why it was rejected (red badge). Hit the play button on any eligible
          card to start the pipeline. The pipeline panel on the dashboard shows
          step-by-step progress: fetch → format → TTS → video → thumbnail →
          notify. A full render typically takes 1–3 minutes depending on length
          and hardware.
        </p>
        <p>
          When it's done you'll see a desktop notification (in the bell icon
          top-right), and the video appears in{" "}
          <Link to="/videos" className="text-primary underline">Videos</Link> with
          a preview player + Approve / Reject buttons.
        </p>
      </>
    ),
  },
  {
    id: "ai-providers",
    title: "Picking an AI provider",
    icon: <Sparkles className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          Every AI feature in the app — story generation, virality scoring,
          social copy, hashtag analysis, niche finder, comment replies, optional
          intro hooks + thumbnail text — runs through whatever you pick here.
          Most of them are short prompts so a 7B–8B local model is plenty.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Ollama (local)</strong> — free, runs on your GPU. Best for
            privacy + bulk scoring. Recommended models: <code>llama3.1:8b</code>{" "}
            for general use, <code>llama3.2:3b</code> for cheap tasks. Set the
            URL to <code>http://localhost:11434</code>.
          </li>
          <li>
            <strong>Google Gemini</strong> — generous free tier, very fast.
            Get a key at{" "}
            <a href="https://ai.studio.google.com" target="_blank" rel="noreferrer"
               className="text-primary underline inline-flex items-center gap-0.5">
              ai.studio.google.com <ExternalLink className="h-2.5 w-2.5" />
            </a>.
          </li>
          <li>
            <strong>OpenRouter</strong> — single key for 100+ models, including
            free-tier ones. Good for trying flagship models without a sub.
          </li>
          <li>
            <strong>NVIDIA NIM</strong> — free dev tier with very capable
            models. Good fallback if you don't want to run local.
          </li>
        </ul>
        <p>
          You can mix and match via <strong>per-feature model overrides</strong>{" "}
          at the bottom of the AI Model tab — keep the flagship for story
          generation, drop scoring/hashtag analysis to a cheap local model.
        </p>
      </>
    ),
  },
  {
    id: "brands",
    title: "Brand profiles",
    icon: <Tag className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          A "brand" is a snapshot of every styling decision: title-card colors
          and avatar, caption font + animation, watermark, default voice,
          background folder, music tags, default broll style. Switch brands
          from the header pill before generating, and every render gets tagged
          with which brand made it.
        </p>
        <p>
          This is how you run multiple channels from one install — make a
          brand for each, switch the pill, hit Generate. The Videos page
          filters by brand so you can see only the renders for one channel
          at a time.
        </p>
        <p>
          Manage brands at{" "}
          <Link to="/brands" className="text-primary underline">/brands</Link>{" "}
          — Save snapshots the current config, Apply pulls a brand's settings
          into the active config (you'll be asked to confirm before any
          unsaved changes are clobbered).
        </p>
      </>
    ),
  },
  {
    id: "filters",
    title: "Post filters explained",
    icon: <Filter className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          The Posts page has two filter tiers: a small toolbar (search,
          sort, eligible-only, hide-dupes) and a collapsed panel behind the{" "}
          <strong>Filters</strong> button with everything else. The active
          filter count badge tells you how many constraints are silently
          narrowing the list.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Min upvotes / comments</strong> — basic engagement floor.
          </li>
          <li>
            <strong>Min viral (▲/hr)</strong> — upvotes per hour since posting.
            Better than raw score for catching posts blowing up <em>now</em>.
          </li>
          <li>
            <strong>Min AI score</strong> — the model's 0–100 short-form
            virality estimate. Run <em>Score with AI</em> first to populate.
          </li>
          <li>
            <strong>Exclude / must-contain keywords</strong> — comma-separated
            substrings. Case-insensitive. Matches title + selftext.
          </li>
          <li>
            <strong>AI filters</strong> — only meaningful after Score with AI
            has run. Filter by emotion, recommended mode (story/QA/hottake),
            target audience, narrator gender.
          </li>
        </ul>
        <p>
          Save a filter combo as a preset (top of the panel) so you can reuse
          tuning between sessions. The active preset persists across reloads.
        </p>
      </>
    ),
  },
  {
    id: "voice",
    title: "Voice / TTS providers",
    icon: <Mic className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          Five providers, ordered by setup difficulty:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Streamlabs Polly</strong> — free, no key, robotic but works.
            Default. Picks include Joanna, Brian, Matthew, etc.
          </li>
          <li>
            <strong>LazyPy TikTok</strong> — free, mimics TikTok's voices.
            Ratelimits if used in bulk.
          </li>
          <li>
            <strong>ElevenLabs</strong> — best voices, ~10k free chars/month
            on the free tier. Drop in a key and pick a voice from the
            populated dropdown.
          </li>
          <li>
            <strong>VibeVoice (local)</strong> — runs entirely on your GPU,
            zero per-request cost. Heavier setup; needs the model on disk.
          </li>
          <li>
            <strong>Qwen3-TTS (local)</strong> — same idea, faster on a GPU
            than VibeVoice.
          </li>
        </ul>
        <p>
          Per-segment author can switch voices automatically (Q&A mode + dialogue
          mode), so even with a single provider you can have male/female
          alternating without manual editing.
        </p>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "When something breaks",
    icon: <Wrench className="h-4 w-4 text-primary" />,
    body: (
      <>
        <p>
          Renders are the most common point of failure. Read the bottom of the
          run log first — it almost always points at the failed step. Common
          ones:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Stuck at render</strong> — usually a hung ffmpeg subprocess.
            Click <strong>Resume</strong> on the audio_only video card; resume
            uses the cached audio + timeline so it's fast and avoids whatever
            transient state caused the stall.
          </li>
          <li>
            <strong>Audio_only with no video</strong> — pipeline finished TTS
            but the video step returned no output. The auto-resume detector
            usually catches this and retries automatically; if it doesn't,
            click Resume manually.
          </li>
          <li>
            <strong>Missing codec / font / disk full</strong> — the run log
            categorizes these explicitly with a hint per category. The hint
            is usually right; install the missing dependency or free disk and
            try again.
          </li>
          <li>
            <strong>Quota / 401 / 403</strong> — your AI or TTS provider
            rejected the call. Check the dashboard quota on the provider, or
            switch providers in <Link to="/config?tab=ai" className="text-primary underline">Config → AI Model</Link>.
          </li>
        </ul>
        <p>
          For ffmpeg failures specifically: the project ships with a render
          diagnostics layer that surfaces structured error categories (OOM,
          codec missing, corrupt input, etc.) — those land in the video card
          as colored badges with one-line explanations. Hover for the full
          stderr excerpt.
        </p>
      </>
    ),
  },
];

export default function GuidePage() {
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(SECTIONS[0].id);

  const seenCount = useMemo(() => countSeenTips(), []);

  const handleResetTips = () => {
    resetFirstTimeTips();
    toast({
      title: "Tips reset",
      description: "First-time tips will fire again as you visit each page.",
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" /> Guide
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            How the suite hangs together — written for someone who just cloned the repo.
            Pick a section to expand.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 h-8 text-xs"
          onClick={handleResetTips}
          title="Mark all first-time tips as unseen so they fire again"
        >
          <RotateCcw className="h-3 w-3" />
          Reset tips {seenCount > 0 ? `(${seenCount} seen)` : ""}
        </Button>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-3 text-[11px] text-muted-foreground leading-relaxed">
          <p>
            <strong className="text-foreground">New here?</strong> Start with{" "}
            <button
              onClick={() => setOpen("first-video")}
              className="text-primary underline"
            >
              Generate your first video
            </button>{" "}
            and follow the links. The dashboard's Quick Start checklist tracks
            the same setup steps and disappears once they're done.
          </p>
        </CardContent>
      </Card>

      {SECTIONS.map((s) => {
        const isOpen = open === s.id;
        return (
          <Card key={s.id} className="border-border bg-card">
            <CardContent className="p-0">
              <button
                onClick={() => setOpen(isOpen ? null : s.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/20 transition-colors"
              >
                <span className="shrink-0">{s.icon}</span>
                <span className="font-semibold text-sm flex-1">{s.title}</span>
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-0 space-y-3 text-xs leading-relaxed text-muted-foreground border-t border-border/40">
                  {s.body}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[10px] text-muted-foreground text-center pt-2">
        Missing something? The full readme is in the repo at <code>README.md</code>.
      </p>
    </motion.div>
  );
}
