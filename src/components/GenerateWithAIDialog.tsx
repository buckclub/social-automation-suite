import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Sparkles, ArrowRight, ArrowLeft, Loader2, AlertTriangle, RefreshCw,
  Film, Scissors, Mic, MicOff, BookOpen, MessageSquare,
  Gamepad2, Flame, HandMetal, HelpCircle, Star, Brain, Images, User, Shuffle,
  Shield, ShieldAlert, ShieldOff, Users,
  Drama, Laugh, Heart, Zap, Frown,
  Bookmark, BookmarkPlus, Trash2, Check,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useConfig, useTtsProviders } from "@/hooks/use-api";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const CONTENT_STYLES = [
  { id: "story", label: "Story", icon: BookOpen, desc: "First-person Reddit confessional", color: "text-blue-400" },
  { id: "qa", label: "Q&A", icon: MessageSquare, desc: "Viral AskReddit thread with answers", color: "text-green-400" },
  { id: "interactive", label: "Interactive", icon: Gamepad2, desc: '"Put a finger down" / quizzes with pauses', color: "text-purple-400" },
  { id: "hot_take", label: "Hot Take", icon: Flame, desc: "Controversial opinion that drives comments", color: "text-orange-400" },
];

const NICHES = [
  { id: "relationship_drama", name: "Relationship Drama", emoji: "💔" },
  { id: "childhood_nostalgia", name: "Childhood Nostalgia", emoji: "🧸" },
  { id: "workplace_horror", name: "Workplace Horror", emoji: "💼" },
  { id: "dating_disasters", name: "Dating Disasters", emoji: "🫠" },
  { id: "family_secrets", name: "Family Secrets", emoji: "🤫" },
  { id: "school_memories", name: "School Memories", emoji: "🎒" },
  { id: "paranormal_encounters", name: "Paranormal", emoji: "👻" },
  { id: "neighbor_stories", name: "Neighbor Stories", emoji: "🏠" },
  { id: "travel_nightmares", name: "Travel Nightmares", emoji: "✈️" },
  { id: "food_culture", name: "Food & Culture", emoji: "🍕" },
];

const INTERACTIVE_FORMATS = [
  { id: "put_a_finger_down", label: "Put a Finger Down", icon: HandMetal },
  { id: "would_you_rather", label: "Would You Rather", icon: HelpCircle },
  { id: "rate_yourself", label: "Rate Yourself", icon: Star },
  { id: "guess_the_answer", label: "Guess the Answer", icon: Brain },
];

const VIDEO_MODES = [
  { id: "short_reel", label: "Short Reel", icon: Scissors, desc: "< 60s vertical video" },
  { id: "full_video", label: "Full Video", icon: Film, desc: "Full-length horizontal" },
  { id: "reel", label: "Reel", icon: Film, desc: "60-90s vertical format" },
];

const TONES = [
  { id: "dramatic" as const,  label: "Dramatic",  icon: Drama, color: "text-red-400",     desc: "High stakes, mounting tension, gut-punch endings" },
  { id: "funny" as const,     label: "Funny",     icon: Laugh, color: "text-yellow-400",  desc: "Absurdity and comedic timing — readers laugh out loud" },
  { id: "heartfelt" as const, label: "Heartfelt", icon: Heart, color: "text-pink-400",    desc: "Genuine emotion and vulnerability — moves people, doesn't shock" },
  { id: "shocking" as const,  label: "Shocking",  icon: Zap,   color: "text-purple-400",  desc: "Twists that make viewers say 'WHAT.' out loud" },
  { id: "cringe" as const,    label: "Cringe",    icon: Frown, color: "text-orange-400",  desc: "Secondhand embarrassment — readers physically wince" },
];
type Tone = typeof TONES[number]["id"];

const CONTENT_FILTERS = [
  {
    id: "safe" as const,
    label: "Safe",
    icon: Shield,
    color: "text-emerald-400",
    desc: "Zero brand risk — no profanity, no risky words, advertiser-friendly",
  },
  {
    id: "normal" as const,
    label: "Normal",
    icon: ShieldAlert,
    color: "text-amber-400",
    desc: "Mild language only when the moment demands it; no slurs, no gratuitous content",
  },
  {
    id: "edgy" as const,
    label: "Edgy",
    icon: ShieldOff,
    color: "text-rose-400",
    desc: "Reddit-authentic — full curse vocabulary, adult themes, no softening. No targeted slurs.",
  },
];
type ContentFilter = typeof CONTENT_FILTERS[number]["id"];

interface Preset {
  id: string;
  name: string;
  content_style: string;
  niche: string;
  interactive_format?: string;
  content_filter: ContentFilter;
  target_audience: string;
  tone: Tone;
}

export function GenerateWithAIDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [contentStyle, setContentStyle] = useState("story");
  const [niche, setNiche] = useState("relationship_drama");
  const [customTopic, setCustomTopic] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [interactiveFormat, setInteractiveFormat] = useState("put_a_finger_down");
  const [videoMode, setVideoMode] = useState("short_reel");
  const [ttsEnabled, setTtsEnabled] = useState(true);

  // NEW per-run overrides
  const [narratorGender, setNarratorGender] = useState<"auto" | "male" | "female">("auto");
  const [voiceOverride, setVoiceOverride] = useState<string>("__config__");    // __config__ = use config default
  const [bgSelector, setBgSelector] = useState<string>("__config__");          // __config__ = use config default

  // Content filter + target audience + tone (per-run; defaults come from config)
  const [contentFilter, setContentFilter] = useState<ContentFilter>("normal");
  const [targetAudience, setTargetAudience] = useState<string>("");
  const [tone, setTone] = useState<Tone>("dramatic");

  // Presets: saved {style,niche,filter,audience,tone,...} bundles
  const [loadedPresetName, setLoadedPresetName] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [presetNameInputOpen, setPresetNameInputOpen] = useState(false);

  // Script-review screen — always shown after Generate. The user can:
  //   * Approve one (and Run) → fires the single pipeline immediately.
  //   * Approve multiple (when count > 1) → enqueues them all on the run queue.
  //   * Regenerate one card to swap just that candidate.
  //   * Regenerate all to refresh the whole batch.
  // `candidateCount` = how many candidates to fetch on the next generate
  // (1 = single review, 2+ = multi-pick batch).
  const [candidateCount, setCandidateCount] = useState(1);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variants, setVariants] = useState<Array<Record<string, unknown>>>([]);
  const [approvedSet, setApprovedSet] = useState<Set<number>>(new Set());
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Resumable draft — populated on dialog open by GET /api/ai/drafts.
  // When non-null we show a "Resume previous draft?" banner above step 0.
  const [savedDraft, setSavedDraft] = useState<
    | null
    | {
        created_at: string;
        params: Record<string, unknown>;
        variants: Array<Record<string, unknown>>;
      }
  >(null);

  const [submitting, setSubmitting] = useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();

  // Live config + providers for the voice/background dropdowns
  const { data: config } = useConfig();
  const { data: providersData } = useTtsProviders();
  const [bgFolders, setBgFolders] = useState<{ path: string; name: string; video_count: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    api.listBackgroundFolders()
      .then((r) => setBgFolders(Array.isArray(r?.folders) ? r.folders : []))
      .catch((e) => {
        console.warn("[GenerateWithAIDialog] listBackgroundFolders failed:", e);
        setBgFolders([]);
      });
  }, [open]);

  // On open, look for a previously-saved draft so the user can pick up
  // where they left off after an accidental close. We do NOT auto-restore
  // — we surface a banner and let the user choose Resume vs Discard, so
  // a stale draft from a different intent doesn't surprise them.
  useEffect(() => {
    if (!open) { setSavedDraft(null); return; }
    api.getAIDraft()
      .then((r) => {
        if (!r.draft || !Array.isArray(r.draft.variants) || r.draft.variants.length === 0) {
          setSavedDraft(null);
          return;
        }
        setSavedDraft(r.draft);
      })
      .catch(() => setSavedDraft(null));
  }, [open]);

  // Best-effort persistence — fire-and-forget. The dialog state is the
  // source of truth; the draft is just a backup for accidental close.
  const persistDraft = (variantsArr: Array<Record<string, unknown>>) => {
    if (!variantsArr || variantsArr.length === 0) return;
    api.saveAIDraft({
      params: {
        content_style: contentStyle, niche, custom_topic: customTopic,
        custom_title: customTitle, interactive_format: interactiveFormat,
        video_mode: videoMode, tts_enabled: ttsEnabled,
        narrator_gender: narratorGender, voice_override: voiceOverride,
        background_selector: bgSelector, content_filter: contentFilter,
        target_audience: targetAudience, tone, candidate_count: candidateCount,
      },
      variants: variantsArr,
    }).catch(() => { /* silent — draft saving is a backup, not critical */ });
  };

  const clearDraft = () => {
    setSavedDraft(null);
    api.clearAIDraft().catch(() => { /* silent */ });
  };

  // Restore a saved draft — populate every dialog input from `params` and
  // jump straight to the review screen with the persisted variants.
  const resumeDraft = (draft: NonNullable<typeof savedDraft>) => {
    const p = draft.params || {};
    if (typeof p.content_style === "string") setContentStyle(p.content_style);
    if (typeof p.niche === "string") setNiche(p.niche);
    if (typeof p.custom_topic === "string") setCustomTopic(p.custom_topic);
    if (typeof p.custom_title === "string") setCustomTitle(p.custom_title);
    if (typeof p.interactive_format === "string") setInteractiveFormat(p.interactive_format);
    if (typeof p.video_mode === "string") setVideoMode(p.video_mode);
    if (typeof p.tts_enabled === "boolean") setTtsEnabled(p.tts_enabled);
    if (p.narrator_gender === "auto" || p.narrator_gender === "male" || p.narrator_gender === "female") {
      setNarratorGender(p.narrator_gender);
    }
    if (typeof p.voice_override === "string") setVoiceOverride(p.voice_override);
    if (typeof p.background_selector === "string") setBgSelector(p.background_selector);
    if (p.content_filter === "safe" || p.content_filter === "normal" || p.content_filter === "edgy") {
      setContentFilter(p.content_filter);
    }
    if (typeof p.target_audience === "string") setTargetAudience(p.target_audience);
    if (
      p.tone === "dramatic" || p.tone === "funny" || p.tone === "heartfelt"
      || p.tone === "shocking" || p.tone === "cringe"
    ) setTone(p.tone);
    if (typeof p.candidate_count === "number") setCandidateCount(p.candidate_count);
    setVariants(draft.variants);
    setApprovedSet(draft.variants.length === 1 ? new Set([0]) : new Set());
    setExpandedSet(new Set());
    setShowPicker(true);
    setSavedDraft(null);
  };

  // Hydrate content-filter + target-audience + tone defaults from config on open.
  // Only apply once per open so we don't trample the user's in-dialog edits.
  const [didHydrateDefaults, setDidHydrateDefaults] = useState(false);
  useEffect(() => {
    if (!open) { setDidHydrateDefaults(false); return; }
    if (didHydrateDefaults) return;
    const acg = (config as any)?.ai_content_generation ?? {};
    const cf = String(acg.content_filter_default ?? "normal").toLowerCase();
    if (cf === "safe" || cf === "normal" || cf === "edgy") setContentFilter(cf);
    if (typeof acg.target_audience_default === "string") setTargetAudience(acg.target_audience_default);
    const t = String(acg.tone_default ?? "dramatic").toLowerCase();
    if (TONES.some((x) => x.id === t)) setTone(t as Tone);
    setDidHydrateDefaults(true);
  }, [open, config, didHydrateDefaults]);

  // Presets read from config (no separate fetch — already loaded via useConfig)
  const presets: Preset[] = useMemo(() => {
    const raw = (config as any)?.ai_content_generation?.presets;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
  }, [config]);

  const applyPreset = (p: Preset) => {
    setContentStyle(p.content_style);
    setNiche(p.niche);
    if (p.interactive_format) setInteractiveFormat(p.interactive_format);
    setContentFilter(p.content_filter);
    setTargetAudience(p.target_audience || "");
    setTone(p.tone);
    setLoadedPresetName(p.name);
    toast({ title: `Loaded preset: ${p.name}` });
  };

  const savePreset = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Preset name required", variant: "destructive" });
      return;
    }
    setSavingPreset(true);
    try {
      const newPreset: Preset = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        content_style: contentStyle,
        niche,
        interactive_format: contentStyle === "interactive" ? interactiveFormat : undefined,
        content_filter: contentFilter,
        target_audience: targetAudience,
        tone,
      };
      const next = [...presets, newPreset];
      await api.updateConfig({ ai_content_generation: { presets: next } });
      qc.invalidateQueries({ queryKey: ["config"] });
      setLoadedPresetName(trimmed);
      setNewPresetName("");
      setPresetNameInputOpen(false);
      toast({ title: `Preset saved: ${trimmed}` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSavingPreset(false);
    }
  };

  const deletePreset = async (id: string) => {
    try {
      const next = presets.filter((p) => p.id !== id);
      await api.updateConfig({ ai_content_generation: { presets: next } });
      qc.invalidateQueries({ queryKey: ["config"] });
      toast({ title: "Preset deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  const ttsConfig = (config as any)?.tts ?? {};
  const ttsProvider: string = ttsConfig.provider || "streamlabs_polly";
  const mainVoice: string = ttsConfig.main_voice || "";

  // AI provider drives the paid-tokens warning on the variants toggle.
  const aiProvider: string = (config as any)?.gemini?.provider || "ollama";

  // Build the voice options for the current provider. Falls back to the
  // 21-voice ElevenLabs library when provider=elevenlabs so the dropdown
  // is useful even without a successful /v2/voices fetch.
  //
  // IMPORTANT: filter out any empty-id / empty-label entries. Radix Select
  // throws "A <Select.Item /> must have a value prop that is not an empty
  // string" at render time if ANY item has an empty value — which would
  // crash the whole React tree and blank the page.
  const voiceOptions: { id: string; label: string }[] = useMemo(() => {
    const raw: { id: string; label: string }[] = (() => {
      if (ttsProvider === "elevenlabs") {
        return ELEVENLABS_LIBRARY.map((v) => ({
          id: v.id, label: `${v.name} — ${v.category}`,
        }));
      }
      const providers = providersData?.providers ?? [];
      const pp = providers.find((p) => p.id === ttsProvider);
      const detailed = pp?.voices_detailed ?? [];
      const vs = pp?.voices ?? [];
      return vs.map((vid) => {
        const d = detailed.find((x: any) => x.id === vid);
        return { id: vid, label: d ? `${d.name} (${d.lang}, ${d.gender})` : vid };
      });
    })();
    return raw.filter((v) => v && typeof v.id === "string" && v.id.trim() !== "");
  }, [ttsProvider, providersData]);

  const totalSteps = 5;

  // Fire the pipeline — either with a freshly-generated story, or with
  // a variant the user already picked from the batch picker.
  const startPipeline = async (preselected?: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await api.runPipelineAI({
        content_style: contentStyle,
        niche,
        custom_topic: customTopic || undefined,
        custom_title: customTitle || undefined,
        interactive_format: contentStyle === "interactive" ? interactiveFormat : undefined,
        video_mode: videoMode,
        tts_enabled: ttsEnabled,
        narrator_gender: narratorGender,
        voice_override: voiceOverride === "__config__" ? undefined : voiceOverride,
        background_selector:
          bgSelector === "__config__" ? undefined :
          bgSelector === "__all_random__" ? "" : bgSelector,
        content_filter: contentFilter,
        target_audience: targetAudience.trim() || undefined,
        tone,
        preselected_content: preselected,
      });
      toast({
        title: "AI pipeline started",
        description: preselected
          ? "Using your picked variant"
          : (narratorGender !== "auto" ? `Narrator: ${narratorGender}`
             : voiceOverride !== "__config__" ? "Using custom voice" : "Generating…"),
      });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      clearDraft();
      setOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  // Fetch `candidateCount` candidates and open the review screen. Used both
  // for the initial Generate click and the "Regenerate all" button.
  const fetchCandidates = async (n: number) => {
    setVariantsLoading(true);
    setShowPicker(true);
    setApprovedSet(new Set());
    setExpandedSet(new Set());
    setVariants([]);
    try {
      const res = await api.generateAIVariants({
        content_style: contentStyle,
        niche,
        custom_topic: customTopic || undefined,
        interactive_format: contentStyle === "interactive" ? interactiveFormat : undefined,
        content_filter: contentFilter,
        target_audience: targetAudience.trim() || undefined,
        tone,
        count: n,
      });
      setVariants(res.variants);
      persistDraft(res.variants);
      // When there's only one candidate, auto-approve it so the user
      // can hit Run with one click — but we still show the script first.
      if (res.variants.length === 1) setApprovedSet(new Set([0]));
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message, variant: "destructive" });
      setShowPicker(false);
    } finally {
      setVariantsLoading(false);
    }
  };

  const handleSubmit = async () => {
    await fetchCandidates(candidateCount);
  };

  // Replace just one card in the review screen with a fresh generation.
  // Triggered by the per-card 🔄 button.
  const regenerateOne = async (idx: number) => {
    setRegeneratingIdx(idx);
    try {
      const res = await api.generateAIVariants({
        content_style: contentStyle,
        niche,
        custom_topic: customTopic || undefined,
        interactive_format: contentStyle === "interactive" ? interactiveFormat : undefined,
        content_filter: contentFilter,
        target_audience: targetAudience.trim() || undefined,
        tone,
        count: 1,
      });
      const fresh = res.variants[0];
      if (!fresh) throw new Error("Empty result");
      setVariants((arr) => {
        const next = arr.map((v, i) => (i === idx ? fresh : v));
        persistDraft(next);
        return next;
      });
      // Replacing a card invalidates any prior approval on that slot.
      setApprovedSet((s) => {
        const next = new Set(s);
        next.delete(idx);
        return next;
      });
      setExpandedSet((s) => {
        const next = new Set(s);
        next.delete(idx);
        return next;
      });
    } catch (e: any) {
      toast({ title: "Regenerate failed", description: e?.message, variant: "destructive" });
    } finally {
      setRegeneratingIdx(null);
    }
  };

  const regenerateAll = async () => {
    setRegeneratingAll(true);
    try {
      await fetchCandidates(variants.length || candidateCount);
    } finally {
      setRegeneratingAll(false);
    }
  };

  // Run every approved variant. 1 → fires the pipeline immediately
  // (existing path); 2+ → enqueues them all on the run queue.
  const runApproved = async () => {
    const indices = Array.from(approvedSet).sort((a, b) => a - b);
    if (indices.length === 0) {
      toast({ title: "Nothing approved yet", description: "Tick at least one card." });
      return;
    }
    const picks = indices.map((i) => {
      const v = { ...variants[i] };
      // Custom title applies to whichever variant is run; for batch, only
      // the first picked uses it (otherwise every clip ships with the
      // same title which is rarely what you want).
      if (i === indices[0] && customTitle.trim()) {
        (v as any).title = customTitle.trim();
      }
      return v;
    });

    if (picks.length === 1) {
      setShowPicker(false);
      await startPipeline(picks[0]);
      return;
    }

    // Multi-approve → batch enqueue.
    setSubmitting(true);
    try {
      const res = await api.batchRunAI({
        items: picks.map((preselected) => ({
          preselected_content: preselected,
          content_style: contentStyle,
          niche,
          content_filter: contentFilter,
          target_audience: targetAudience.trim() || undefined,
          tone,
          video_mode: videoMode,
          tts_enabled: ttsEnabled,
          narrator_gender: narratorGender,
          voice_override: voiceOverride === "__config__" ? undefined : voiceOverride,
          background_selector:
            bgSelector === "__config__" ? undefined :
            bgSelector === "__all_random__" ? "" : bgSelector,
        })),
      });
      toast({
        title: `Queued ${res.count} run${res.count === 1 ? "" : "s"}`,
        description: res.failures?.length
          ? `${res.failures.length} failed to enqueue — check the run queue.`
          : "The run queue worker will process them serially.",
      });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      clearDraft();
      setOpen(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Batch enqueue failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleApprove = (idx: number) => {
    setApprovedSet((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  const toggleExpand = (idx: number) => {
    setExpandedSet((s) => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const resetForm = () => {
    setStep(0);
    setContentStyle("story");
    setNiche("relationship_drama");
    setCustomTopic(""); setCustomTitle("");
    setInteractiveFormat("put_a_finger_down");
    setVideoMode("short_reel");
    setTtsEnabled(true);
    setNarratorGender("auto");
    setVoiceOverride("__config__");
    setBgSelector("__config__");
    // Filter + audience + tone are re-hydrated from config on next open via didHydrateDefaults.
    setContentFilter("normal");
    setTargetAudience("");
    setTone("dramatic");
    setLoadedPresetName(null);
    setCandidateCount(1);
    setShowPicker(false);
    setVariants([]);
    setApprovedSet(new Set());
    setExpandedSet(new Set());
    setRegeneratingIdx(null);
    setRegeneratingAll(false);
    setNewPresetName("");
    setPresetNameInputOpen(false);
  };

  // Pretty-print the variant body for the review screen. Each style has
  // its own shape (story body, qa comments, interactive segments) so we
  // join them into one flowing block of text the user can actually read.
  const formatFullScript = (v: Record<string, unknown>): string => {
    if (contentStyle === "qa") {
      const q = (v.question as string) || (v.title as string) || "";
      const comments = (v.comments as Array<{ author?: string; body?: string; score?: number }> | undefined) ?? [];
      const lines = [`Q: ${q}`, ""];
      for (const c of comments) {
        const author = c.author || "anon";
        const score = c.score ? ` (${c.score})` : "";
        lines.push(`${author}${score}: ${c.body || ""}`);
      }
      return lines.join("\n").trim();
    }
    if (contentStyle === "interactive") {
      const segs = (v.segments as Array<{ text?: string; pause_seconds?: number }> | undefined) ?? [];
      return segs
        .map((s) => {
          const pause = s.pause_seconds ? `\n  ⏸ ${s.pause_seconds}s pause` : "";
          return `${s.text || ""}${pause}`;
        })
        .join("\n\n").trim();
    }
    return ((v.body as string) || "").trim();
  };

  // Single-line summary for the collapsed card view.
  const summarizeVariant = (v: Record<string, unknown>): string => {
    if (contentStyle === "qa") {
      const comments = (v.comments as Array<{ body?: string }> | undefined) ?? [];
      const first = comments.slice(0, 2).map((c) => c.body || "").filter(Boolean);
      return first.join(" • ") || (v.question as string) || "";
    }
    if (contentStyle === "interactive") {
      const segs = (v.segments as Array<{ text?: string }> | undefined) ?? [];
      return segs.slice(0, 2).map((s) => s.text || "").filter(Boolean).join(" · ");
    }
    return ((v.body as string) || "").slice(0, 260);
  };

  const renderScriptReview = () => {
    const approvedCount = approvedSet.size;
    const isMulti = variants.length > 1;
    return (
      <div className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">
            {variants.length > 1
              ? `Review ${variants.length} candidates`
              : "Review your script"}
          </Label>
          <p className="text-[10px] text-muted-foreground leading-snug mt-1">
            Read it through, regenerate any cards you don't like, then
            {isMulti ? " tick the ones you want to keep and Run." : " hit Run."}
            {isMulti && " Multi-pick queues each as its own pipeline run."}
          </p>
        </div>

        {variantsLoading && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-[11px]">
              {variants.length > 0
                ? `Regenerating ${variants.length} candidate${variants.length === 1 ? "" : "s"}…`
                : `Generating ${candidateCount} candidate${candidateCount === 1 ? "" : "s"} in parallel…`}
            </p>
            {aiProvider !== "ollama" && candidateCount > 1 && (
              <p className="text-[10px] opacity-70">
                Uses ~{candidateCount}× the provider tokens of a normal run.
              </p>
            )}
          </div>
        )}

        {!variantsLoading && variants.length > 0 && (
          <>
            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {variants.map((v, i) => {
                const approved = approvedSet.has(i);
                const expanded = expandedSet.has(i);
                const regenThis = regeneratingIdx === i;
                return (
                  <div
                    key={i}
                    className={cn(
                      "w-full p-3 rounded-lg border transition-all",
                      approved
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary/40",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {/* Approve checkbox (always visible — single mode auto-approves but lets user un-tick) */}
                      <button
                        onClick={() => toggleApprove(i)}
                        className={cn(
                          "h-4 w-4 shrink-0 rounded border flex items-center justify-center mt-0.5",
                          approved ? "border-primary bg-primary" : "border-border hover:border-primary/50",
                        )}
                        title={approved ? "Approved — click to un-approve" : "Click to approve"}
                      >
                        {approved && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-[11px] font-semibold leading-snug line-clamp-2 flex-1">
                            {(v.title as string) || `Variant ${i + 1}`}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm" variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => regenerateOne(i)}
                              disabled={regenThis || regeneratingAll}
                              title="Regenerate just this candidate"
                            >
                              {regenThis
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <RefreshCw className="h-3 w-3" />}
                            </Button>
                          </div>
                        </div>
                        <p
                          className={cn(
                            "text-[10px] leading-snug whitespace-pre-wrap",
                            expanded ? "text-foreground" : "text-muted-foreground line-clamp-4",
                          )}
                        >
                          {expanded ? formatFullScript(v) : summarizeVariant(v)}
                        </p>
                        <button
                          onClick={() => toggleExpand(i)}
                          className="mt-1 text-[9px] text-primary hover:underline"
                        >
                          {expanded ? "Collapse" : "Read full script"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowPicker(false); setVariants([]); setApprovedSet(new Set()); }}
                  className="flex-1 gap-2"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Button>
                <Button
                  variant="outline"
                  onClick={regenerateAll}
                  disabled={regeneratingAll || regeneratingIdx !== null || submitting}
                  className="flex-1 gap-2"
                  title="Regenerate every candidate from scratch"
                >
                  {regeneratingAll
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate all
                </Button>
              </div>
              <Button
                onClick={runApproved}
                disabled={approvedCount === 0 || submitting || regeneratingAll || regeneratingIdx !== null}
                className="w-full gap-2 glow-accent"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {approvedCount === 0
                  ? "Approve at least one"
                  : approvedCount === 1
                    ? "Run approved"
                    : `Queue ${approvedCount} approved runs`}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderStep = () => {
    // ── Step 0: Content style ────────────────────────────────────
    if (step === 0) {
      return (
        <div className="space-y-4">
          {/* Resume-previous-draft banner — shown only on step 0 so it
              doesn't follow the user as they navigate the wizard. */}
          {savedDraft && (
            <div className="rounded-md border border-accent/40 bg-accent/5 p-2.5 space-y-1.5">
              <div className="flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold">
                    Resume previous draft?
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    {savedDraft.variants.length} candidate{savedDraft.variants.length === 1 ? "" : "s"} from{" "}
                    {(() => {
                      try {
                        const t = new Date(savedDraft.created_at).getTime();
                        const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
                        if (mins < 1) return "just now";
                        if (mins < 60) return `${mins} min ago`;
                        const hrs = Math.round(mins / 60);
                        return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
                      } catch { return "earlier"; }
                    })()}
                    {(() => {
                      const cs = (savedDraft.params?.content_style as string) || "";
                      const n = (savedDraft.params?.niche as string) || "";
                      return cs || n ? ` · ${[cs, n].filter(Boolean).join(" / ")}` : "";
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-7 text-[10px] flex-1 gap-1 glow-accent"
                  onClick={() => resumeDraft(savedDraft)}
                >
                  <ArrowRight className="h-3 w-3" /> Resume to review
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-[10px] gap-1"
                  onClick={clearDraft}
                  title="Throw the draft away and start fresh"
                >
                  <Trash2 className="h-3 w-3" /> Discard
                </Button>
              </div>
            </div>
          )}

          {presets.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Bookmark className="h-3 w-3" /> Load Preset
              </Label>
              <Select
                value={loadedPresetName ?? "__none__"}
                onValueChange={(v) => {
                  if (v === "__none__") { setLoadedPresetName(null); return; }
                  const p = presets.find((x) => x.id === v);
                  if (p) applyPreset(p);
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue placeholder="Pick a saved preset…" /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  <SelectItem value="__none__">None</SelectItem>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <span className="text-muted-foreground ml-2">
                        ({p.content_style} · {p.content_filter}{p.target_audience ? ` · ${p.target_audience.slice(0, 24)}` : ""})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadedPresetName && (
                <div className="flex items-center justify-between text-[10px] pt-0.5">
                  <span className="text-muted-foreground">
                    Loaded: <span className="text-foreground">{loadedPresetName}</span>
                  </span>
                  <button
                    onClick={() => {
                      const p = presets.find((x) => x.name === loadedPresetName);
                      if (p) {
                        if (window.confirm(`Delete preset "${p.name}"?`)) {
                          deletePreset(p.id);
                          setLoadedPresetName(null);
                        }
                      }
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          )}

          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Content Style</Label>
          <div className="grid grid-cols-1 gap-2">
            {CONTENT_STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setContentStyle(s.id)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                  contentStyle === s.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <s.icon className={cn("h-5 w-5 shrink-0", contentStyle === s.id ? s.color : "")} />
                <div>
                  <p className="text-xs font-medium">{s.label}</p>
                  <p className="text-[10px] opacity-70">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <Button onClick={() => setStep(1)} className="w-full gap-2">
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }

    // ── Step 1: Niche + Custom topic ─────────────────────────────
    if (step === 1) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Choose Niche</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {NICHES.map((n) => (
              <button
                key={n.id}
                onClick={() => setNiche(n.id)}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                  niche === n.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <span className="text-sm">{n.emoji}</span>
                <span className="text-[10px] font-medium leading-tight">{n.name}</span>
              </button>
            ))}
          </div>

          <div className="space-y-1 pt-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Tone</Label>
            <div className="grid grid-cols-5 gap-1">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTone(t.id)}
                  title={t.desc}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                    tone === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                  )}
                >
                  <t.icon className={cn("h-4 w-4", tone === t.id ? t.color : "")} />
                  <span className="text-[9px] font-medium">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              {TONES.find((t) => t.id === tone)?.desc}
            </p>
          </div>

          {contentStyle === "interactive" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Format</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {INTERACTIVE_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setInteractiveFormat(f.id)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                      interactiveFormat === f.id
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border bg-secondary/50 text-muted-foreground hover:border-accent/30"
                    )}
                  >
                    <f.icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[10px] font-medium">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom Topic (optional)</Label>
            <Input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. 'caught my roommate doing something weird at 3am'"
              className="h-8 text-xs bg-secondary border-border"
            />
            <p className="text-[10px] text-muted-foreground">Leave empty for AI to choose a fresh angle.</p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom Title (optional)</Label>
            <Input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Override the AI-chosen headline"
              className="h-8 text-xs bg-secondary border-border"
            />
          </div>

          <div className="space-y-1 pt-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Shield className="h-3 w-3" /> Content Filter
            </Label>
            <div className="grid grid-cols-1 gap-1.5">
              {CONTENT_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setContentFilter(f.id)}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border text-left transition-all",
                    contentFilter === f.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                  )}
                >
                  <f.icon className={cn("h-4 w-4 shrink-0", contentFilter === f.id ? f.color : "")} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium">{f.label}</p>
                    <p className="text-[10px] opacity-70 leading-snug">{f.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3" /> Target Audience (optional)
            </Label>
            <Input
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="e.g. women 18-35, teenagers, millennial dads"
              className="h-8 text-xs bg-secondary border-border"
            />
            <p className="text-[10px] text-muted-foreground">
              The story's voice, slang, and references will be tailored to this group.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(2)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 2: Voice & TTS ─────────────────────────────────────
    if (step === 2) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Mic className="h-3 w-3" /> Voice
          </Label>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/50">
            <div className="flex items-center gap-2">
              {ttsEnabled ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="text-xs font-medium">Text-to-Speech</p>
                <p className="text-[10px] text-muted-foreground">Off renders a silent video</p>
              </div>
            </div>
            <Button size="sm" variant={ttsEnabled ? "default" : "outline"} onClick={() => setTtsEnabled(!ttsEnabled)} className="h-7 text-xs">
              {ttsEnabled ? "On" : "Off"}
            </Button>
          </div>

          {ttsEnabled && (
            <>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Narrator gender
                </Label>
                <div className="grid grid-cols-3 gap-1">
                  {(["auto", "male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setNarratorGender(g)}
                      className={cn(
                        "h-7 text-[10px] rounded border transition-colors capitalize",
                        narratorGender === g
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {g === "auto" ? "Auto (use preset)" : g}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Auto follows your gender-preset in config. Force male/female to override for this run only.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Voice (optional override)</Label>
                <Select value={voiceOverride} onValueChange={setVoiceOverride}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    <SelectItem value="__config__">
                      Use config default {mainVoice && <span className="text-muted-foreground">({mainVoice})</span>}
                    </SelectItem>
                    {voiceOptions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Provider: <code>{ttsProvider}</code>. Change provider in Config → TTS.
                </p>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(3)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 3: Video + background ─────────────────────────────
    if (step === 3) {
      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Video Format</Label>
          <div className="grid grid-cols-1 gap-2">
            {VIDEO_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setVideoMode(m.id)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                  videoMode === m.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-secondary/50 text-muted-foreground hover:border-primary/30"
                )}
              >
                <m.icon className="h-5 w-5 shrink-0" />
                <div>
                  <p className="text-xs font-medium">{m.label}</p>
                  <p className="text-[10px] opacity-70">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Images className="h-3 w-3" /> Background footage
            </Label>
            <Select value={bgSelector} onValueChange={setBgSelector}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-[280px]">
                <SelectItem value="__config__">
                  Use config default
                </SelectItem>
                <SelectItem value="__all_random__">
                  <span className="flex items-center gap-1"><Shuffle className="h-3 w-3" /> All backgrounds — random</span>
                </SelectItem>
                {(bgFolders || []).filter((f) => f && typeof f.path === "string" && f.path.trim() !== "").map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    📁 {f.name} <span className="text-muted-foreground">({f.video_count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Override the default background for this run. Manage clips on the Backgrounds page.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={() => setStep(4)} className="flex-1 gap-2">
              Next <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      );
    }

    // ── Step 4: Review & generate ──────────────────────────────
    if (step === 4) {
      const styleInfo  = CONTENT_STYLES.find((s) => s.id === contentStyle);
      const nicheInfo  = NICHES.find((n) => n.id === niche);
      const formatInfo = INTERACTIVE_FORMATS.find((f) => f.id === interactiveFormat);
      const voiceLabel =
        voiceOverride === "__config__"
          ? `default (${mainVoice || "—"})`
          : (voiceOptions.find((v) => v.id === voiceOverride)?.label || voiceOverride);
      const bgLabel =
        bgSelector === "__config__"
          ? "config default"
          : bgSelector === "__all_random__"
          ? "all backgrounds (random)"
          : bgSelector;

      const filterInfo = CONTENT_FILTERS.find((f) => f.id === contentFilter);

      const toneInfo = TONES.find((t) => t.id === tone);

      return (
        <div className="space-y-4">
          <Label className="text-xs text-muted-foreground uppercase tracking-wider">Review</Label>
          <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3 text-[10px]">
            <Row label="Style" value={styleInfo?.label} />
            <Row label="Niche" value={`${nicheInfo?.emoji} ${nicheInfo?.name}`} />
            {contentStyle === "interactive" && <Row label="Format" value={formatInfo?.label} />}
            {customTopic && <Row label="Topic" value={customTopic} truncate />}
            {customTitle && <Row label="Title" value={customTitle} truncate />}
            <Row label="Filter" value={filterInfo?.label} />
            <Row label="Tone" value={toneInfo?.label} />
            {targetAudience.trim() && <Row label="Audience" value={targetAudience} truncate />}
            <Row label="Video" value={VIDEO_MODES.find((m) => m.id === videoMode)?.label} />
            <Row label="TTS" value={ttsEnabled ? "Enabled" : "Disabled"} />
            {ttsEnabled && <Row label="Narrator" value={narratorGender === "auto" ? "auto (by detection)" : narratorGender} />}
            {ttsEnabled && <Row label="Voice" value={voiceLabel} truncate />}
            <Row label="Background" value={bgLabel} truncate />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-secondary/30 gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Sparkles className="h-3.5 w-3.5 text-accent shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium">How many candidates to generate?</p>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    You'll review every script before anything renders. Pick more
                    than one to compare or queue several runs at once.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {[1, 2, 3, 5].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={candidateCount === n ? "default" : "outline"}
                    onClick={() => setCandidateCount(n)}
                    className="h-7 w-7 p-0 text-xs"
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            {candidateCount > 1 && aiProvider !== "ollama" && (
              <p className="text-[10px] text-amber-400/90 flex items-center gap-1 px-1">
                <AlertTriangle className="h-3 w-3" />
                Uses ~{candidateCount}× the provider tokens of a normal run ({aiProvider}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            {!presetNameInputOpen ? (
              <button
                onClick={() => { setPresetNameInputOpen(true); setNewPresetName(loadedPresetName ?? ""); }}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <BookmarkPlus className="h-3 w-3" /> Save these settings as a preset
              </button>
            ) : (
              <div className="flex gap-1.5">
                <Input
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Preset name (e.g. 'Toxic Gf TikTok')"
                  className="h-7 text-xs bg-secondary border-border"
                  onKeyDown={(e) => { if (e.key === "Enter") savePreset(newPresetName); }}
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={() => savePreset(newPresetName)}
                  disabled={savingPreset || !newPresetName.trim()}
                  className="h-7 text-[10px] px-2"
                >
                  {savingPreset ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={() => { setPresetNameInputOpen(false); setNewPresetName(""); }}
                  className="h-7 text-[10px] px-2"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            AI will generate original content using your configured provider.
            Nothing renders until you approve the script on the next screen.
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)} className="flex-1 gap-2">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || variantsLoading} className="flex-1 gap-2 glow-accent">
              {(submitting || variantsLoading)
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              Generate {candidateCount > 1 ? `${candidateCount} candidates` : "script"}
            </Button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-accent/30 hover:border-accent/60 hover:bg-accent/5">
          <Sparkles className="h-4 w-4 text-accent" />
          Generate with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            AI Content Generator
            {!showPicker && (
              <span className="text-[10px] text-muted-foreground font-normal ml-auto">
                Step {step + 1} of {totalSteps}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {!showPicker && (
          <div className="flex gap-1">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-accent" : "bg-muted"
                )}
              />
            ))}
          </div>
        )}
        <DialogErrorBoundary>
          {showPicker ? renderScriptReview() : renderStep()}
        </DialogErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, truncate }: { label: string; value?: React.ReactNode; truncate?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={cn("font-medium text-right", truncate && "truncate max-w-[220px]")}>{value}</span>
    </div>
  );
}

// Dialog-local error boundary so a crash inside the wizard (a bad
// SelectItem, a throwing Select value, a malformed config payload…) can't
// take down the entire React tree into a black page. Shows the actual
// error so the user can report it.
class DialogErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: unknown) {
    console.error("[GenerateWithAIDialog] render crash:", err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-semibold">Dialog crashed — please report this.</p>
          </div>
          <pre className="text-[10px] whitespace-pre-wrap break-words text-muted-foreground bg-background/40 rounded p-2 max-h-40 overflow-auto">
            {this.state.err.name}: {this.state.err.message}
            {this.state.err.stack ? "\n\n" + this.state.err.stack : ""}
          </pre>
          <Button
            size="sm" variant="outline"
            className="h-7 text-[10px]"
            onClick={() => this.setState({ err: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
