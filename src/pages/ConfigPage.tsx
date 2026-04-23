import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Settings2, Save, Loader2, Plus, X, RotateCcw,
  MessageSquare, Mic, Film, FolderOutput, Bell,
  Download, CheckCircle2, XCircle, RefreshCw, Cpu, Sparkles, Zap, Type, Youtube
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useConfig, useUpdateConfig, useTtsProviders, useInstallTtsProvider, useSystemFonts, useElevenLabsVoices } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import type { FullConfig, TtsProvider } from "@/lib/api";
import { CaptionsPreview } from "@/components/CaptionsPreview";
import { ColorInput } from "@/components/ColorInput";
import { SecretInput } from "@/components/ui/secret-input";
import { YouTubePublishingPanel } from "@/components/YouTubePublishingPanel";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";

function TestAiButton({ provider, model, apiKey, ollamaUrl }: { provider: string; model: string; apiKey: string; ollamaUrl?: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null);
  const { toast } = useToast();

  const handleTest = async () => {
    if (provider !== "ollama" && !apiKey) {
      toast({ title: "Missing API key", description: "Enter an API key first.", variant: "destructive" });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const res = await api.testAiModel({ provider, model, api_key: apiKey, ollama_url: ollamaUrl });
      setResult({ success: true, text: res.response });
    } catch (e: any) {
      setResult({ success: false, text: e.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={testing}
        className="w-full gap-2 text-xs"
      >
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Test AI Model
      </Button>
      {result && (
        <div className={`rounded-md border p-2.5 text-xs ${result.success ? "border-green-500/30 bg-green-500/5" : "border-destructive/30 bg-destructive/5"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {result.success ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
            <span className="font-medium">{result.success ? "Success" : "Error"}</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">{result.text}</p>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

const STREAMLABS_VOICES = [
  "Brian", "Amy", "Emma", "Joanna", "Matthew",
  "Joey", "Justin", "Kendra", "Kimberly", "Salli",
];

export default function ConfigPage() {
  const { data: config, isLoading, isError, error } = useConfig();
  const updateMutation = useUpdateConfig();
  const { data: providersData, isLoading: providersLoading } = useTtsProviders();
  const { data: fontsData } = useSystemFonts();
  const installMutation = useInstallTtsProvider();
  const { toast } = useToast();
  const providers = providersData?.providers ?? [];

  // Local state for all config sections
  const [subreddits, setSubreddits] = useState<string[]>([]);
  const [newSub, setNewSub] = useState("");
  const [requestDelay, setRequestDelay] = useState(2);
  const [redditFetchLimit, setRedditFetchLimit] = useState(25);
  const [redditKeepPerSub, setRedditKeepPerSub] = useState(10);

  // Filters
  const [minUpvotes, setMinUpvotes] = useState(500);
  const [minComments, setMinComments] = useState(10);
  const [maxComments, setMaxComments] = useState(500);
  const [minAgeHours, setMinAgeHours] = useState(1);
  const [maxAgeHours, setMaxAgeHours] = useState(168);
  const [allowNsfw, setAllowNsfw] = useState(false);
  const [requireSelftext, setRequireSelftext] = useState(true);

  // Formatting
  const [fmtMode, setFmtMode] = useState("qa");
  const [fmtMaxComments, setFmtMaxComments] = useState(10);
  const [fmtMinScore, setFmtMinScore] = useState(10);

  // TTS
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsProvider, setTtsProvider] = useState("streamlabs_polly");
  const [ttsModelSize, setTtsModelSize] = useState("");
  const [ttsMainVoice, setTtsMainVoice] = useState("Matthew");
  const [ttsMultiVoice, setTtsMultiVoice] = useState(true);
  const [ttsCommentVoices, setTtsCommentVoices] = useState<string[]>(STREAMLABS_VOICES);
  const [ttsFormat, setTtsFormat] = useState("mp3");
  const [ttsSpeed, setTtsSpeed] = useState(0.5);
  const [ttsPreNormalize, setTtsPreNormalize] = useState(true);

  // Voice presets: per-provider male / female defaults used when
  // the pipeline picks a gendered narrator.
  const [votePresets, setVotePresets] = useState<Record<string, { male: string; female: string }>>({});

  // ElevenLabs-specific
  const [elevenApiKey, setElevenApiKey] = useState("");
  const [elevenModel, setElevenModel] = useState("eleven_multilingual_v2");
  const [elevenStability, setElevenStability] = useState(0.5);
  const [elevenSimilarity, setElevenSimilarity] = useState(0.75);
  const [elevenStyle, setElevenStyle] = useState(0.0);
  const [elevenSpeakerBoost, setElevenSpeakerBoost] = useState(true);
  const elevenVoicesQuery = useElevenLabsVoices(ttsProvider === "elevenlabs");

  // Video
  const [videoMode, setVideoMode] = useState("short_reel");
  const [hwAccel, setHwAccel] = useState("none");
  const [autoCleanup, setAutoCleanup] = useState(false);
  const [threads, setThreads] = useState(0);
  const [engine, setEngine] = useState("ffmpeg");
  const [splitDuration, setSplitDuration] = useState(30);
  const [outroText, setOutroText] = useState("Follow for Part {next_part}");
  const [branding, setBranding] = useState("");

  // Captions
  const [capEnabled, setCapEnabled] = useState(true);
  const [capFontPath, setCapFontPath] = useState("arial.ttf");
  const [capFontSize, setCapFontSize] = useState(80);
  const [capColor, setCapColor] = useState("white");
  const [capStrokeColor, setCapStrokeColor] = useState("black");
  const [capStrokeWidth, setCapStrokeWidth] = useState(4);
  const [capBgEnabled, setCapBgEnabled] = useState(false);
  const [capBgColor, setCapBgColor] = useState("black");
  const [capBgOpacity, setCapBgOpacity] = useState(160);
  const [capPadding, setCapPadding] = useState(30);
  const [capCornerRadius, setCapCornerRadius] = useState(20);
  const [capMaxWidthPct, setCapMaxWidthPct] = useState(0.85);
  const [capPosition, setCapPosition] = useState<"center" | "bottom" | "top">("bottom");
  const [capPositionOffset, setCapPositionOffset] = useState(0);
  const [capWordsPerCaption, setCapWordsPerCaption] = useState(3);
  const [capUppercase, setCapUppercase] = useState(true);
  const [capAttribution, setCapAttribution] = useState(false);
  const [capAnimation, setCapAnimation] = useState<"none" | "fade" | "pop" | "fade_pop">("none");
  const [capAnimationDuration, setCapAnimationDuration] = useState(0.15);
  const [capPopOvershoot, setCapPopOvershoot] = useState(1.12);
  const [capPopStartScale, setCapPopStartScale] = useState(0.7);
  const [capForceAlign, setCapForceAlign] = useState(false);
  const [capAlignModelSize, setCapAlignModelSize] = useState("base");
  const [capHighlightWord, setCapHighlightWord] = useState(false);
  const [capHighlightColor, setCapHighlightColor] = useState("#FFD93D");
  const [capHighlightScale, setCapHighlightScale] = useState(1.1);
  const [capHighlightStrokeColor, setCapHighlightStrokeColor] = useState("#000000");

  // Output
  const [postsDir, setPostsDir] = useState("posts");
  const [usedPostsFile, setUsedPostsFile] = useState("used_posts.json");

  // Discord
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [uploadMedia, setUploadMedia] = useState(true);

  // AI Hooks
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiProvider, setGeminiProvider] = useState("gemini");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [nvidiaNimApiKey, setNvidiaNimApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.0-flash");
  const [geminiHook, setGeminiHook] = useState(true);
  const [geminiThumbnail, setGeminiThumbnail] = useState(true);
  const [geminiModels, setGeminiModels] = useState<string[]>([
    "gemini-2.0-flash", "gemini-2.5-flash-preview-05-20",
    "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-lite",
  ]);
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([
    "google/gemma-3-27b-it:free", "google/gemma-3-12b-it:free",
    "google/gemma-3-4b-it:free", "google/gemma-3-1b-it:free",
    "google/gemini-2.0-flash-exp:free", "google/gemini-2.5-flash-preview:thinking",
    "deepseek/deepseek-chat-v3-0324:free", "meta-llama/llama-4-maverick:free",
    "qwen/qwen3-235b-a22b:free", "mistralai/mistral-small-3.1-24b-instruct:free",
  ]);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModels, setOllamaModels] = useState<string[]>([
    "llama3.2", "llama3.1", "gemma3", "gemma2",
    "mistral", "qwen2.5", "phi3", "deepseek-r1",
  ]);
  const [nvidiaNimModels, setNvidiaNimModels] = useState<string[]>([
    "meta/llama-3.1-405b-instruct", "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct", "google/gemma-2-27b-it",
    "google/gemma-2-9b-it", "mistralai/mixtral-8x22b-instruct-v0.1",
    "nvidia/llama-3.1-nemotron-70b-instruct", "deepseek-ai/deepseek-r1",
  ]);
  const [newModelId, setNewModelId] = useState("");

  // YouTube benchmark API (for social copy style references)
  const [youtubeApiKey, setYoutubeApiKey] = useState("");

  const [initialLoaded, setInitialLoaded] = useState(false);
  type TabId = "general" | "formatting" | "tts" | "video" | "captions" | "ai" | "publishing" | "output";
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "general",    label: "General",       icon: <Settings2 className="h-4 w-4" /> },
    { id: "formatting", label: "Formatting",    icon: <MessageSquare className="h-4 w-4" /> },
    { id: "tts",        label: "Text-to-Speech", icon: <Mic className="h-4 w-4" /> },
    { id: "video",      label: "Video",         icon: <Film className="h-4 w-4" /> },
    { id: "captions",   label: "Captions",      icon: <Type className="h-4 w-4" /> },
    { id: "ai",         label: "AI Hooks",      icon: <Sparkles className="h-4 w-4" /> },
    { id: "publishing", label: "Publishing",    icon: <Youtube className="h-4 w-4" /> },
    { id: "output",     label: "Output & Discord", icon: <FolderOutput className="h-4 w-4" /> },
  ];

  useEffect(() => {
    if (!config || initialLoaded) return;
    const c = config as FullConfig;
    setSubreddits(c.subreddits ?? []);
    setRequestDelay(c.request_delay ?? 2);
    const rcfg = ((c as any).reddit ?? {}) as Record<string, any>;
    setRedditFetchLimit(rcfg.fetch_limit ?? 25);
    setRedditKeepPerSub(rcfg.max_per_subreddit_per_run ?? 10);

    const f = c.filters ?? {} as FullConfig["filters"];
    setMinUpvotes(f.min_upvotes ?? 500);
    setMinComments(f.min_comments ?? 10);
    setMaxComments(f.max_comments ?? 500);
    setMinAgeHours(f.min_age_hours ?? 1);
    setMaxAgeHours(f.max_age_hours ?? 168);
    setAllowNsfw(f.allow_nsfw ?? false);
    setRequireSelftext(f.require_selftext ?? true);

    const fmt = c.formatting ?? {} as FullConfig["formatting"];
    setFmtMode(fmt.default_mode ?? "qa");
    setFmtMaxComments(fmt.max_comments ?? 10);
    setFmtMinScore(fmt.min_comment_score ?? 10);

    const t = c.tts ?? {} as FullConfig["tts"];
    setTtsEnabled(t.enabled ?? true);
    setTtsProvider(t.provider ?? "streamlabs_polly");
    setTtsModelSize(t.model_size ?? "");
    setTtsMainVoice(t.main_voice ?? "Matthew");
    setTtsMultiVoice(t.use_multiple_voices ?? true);
    setTtsCommentVoices(t.comment_voices ?? STREAMLABS_VOICES);
    setTtsFormat(t.output_format ?? "mp3");
    setTtsSpeed(t.speed ?? 0.5);
    setTtsPreNormalize((t as any).pre_normalize ?? true);
    setVotePresets(((t as any).voice_presets ?? {}) as Record<string, { male: string; female: string }>);

    const el = ((t as any).elevenlabs as Record<string, unknown>) ?? {};
    setElevenApiKey((t as any).elevenlabs_api_key ?? el.api_key ?? "");
    setElevenModel((t as any).elevenlabs_model_id ?? el.model_id ?? "eleven_multilingual_v2");
    setElevenStability(typeof el.stability === "number" ? el.stability : 0.5);
    setElevenSimilarity(typeof el.similarity_boost === "number" ? el.similarity_boost : 0.75);
    setElevenStyle(typeof el.style === "number" ? el.style : 0.0);
    setElevenSpeakerBoost(el.use_speaker_boost !== undefined ? Boolean(el.use_speaker_boost) : true);

    const v = c.video ?? {} as FullConfig["video"];
    setVideoMode(v.mode ?? "short_reel");
    setHwAccel(v.hw_accel ?? "none");
    setAutoCleanup(v.auto_cleanup ?? false);
    setThreads(v.threads ?? 0);
    setEngine(v.engine ?? "ffmpeg");
    setSplitDuration(v.split_duration ?? 30);
    setOutroText(v.outro_text ?? "Follow for Part {next_part}");
    setBranding(v.branding ?? "");

    const cap = c.captions ?? {} as NonNullable<FullConfig["captions"]>;
    setCapEnabled(cap.enabled ?? true);
    setCapFontPath(cap.font_path ?? "arial.ttf");
    setCapFontSize(cap.font_size ?? 80);
    setCapColor(cap.color ?? "white");
    setCapStrokeColor(cap.stroke_color ?? "black");
    setCapStrokeWidth(cap.stroke_width ?? 4);
    setCapBgEnabled(cap.bg_color != null && cap.bg_color !== "");
    setCapBgColor(cap.bg_color ?? "black");
    setCapBgOpacity(cap.bg_opacity ?? 160);
    setCapPadding(cap.padding ?? 30);
    setCapCornerRadius(cap.corner_radius ?? 20);
    setCapMaxWidthPct(cap.max_width_pct ?? 0.85);
    setCapPosition((cap.position as "center" | "bottom" | "top") ?? "bottom");
    setCapPositionOffset(cap.position_offset ?? 0);
    setCapWordsPerCaption(cap.words_per_caption ?? 3);
    setCapUppercase(cap.uppercase ?? true);
    setCapAttribution(cap.attribution ?? false);
    setCapAnimation((cap.animation as "none" | "fade" | "pop" | "fade_pop") ?? "none");
    setCapAnimationDuration(cap.animation_duration ?? 0.15);
    setCapPopOvershoot(cap.pop_overshoot ?? 1.12);
    setCapPopStartScale(cap.pop_start_scale ?? 0.7);
    setCapForceAlign((cap as any).force_align ?? false);
    setCapAlignModelSize((cap as any).align_model_size ?? "base");
    setCapHighlightWord((cap as any).highlight_word ?? false);
    setCapHighlightColor((cap as any).highlight_color ?? "#FFD93D");
    setCapHighlightScale((cap as any).highlight_scale ?? 1.1);
    setCapHighlightStrokeColor((cap as any).highlight_stroke_color ?? (cap.stroke_color ?? "#000000"));

    const o = c.output ?? {} as FullConfig["output"];
    setPostsDir(o.posts_directory ?? "posts");
    setUsedPostsFile(o.used_posts_file ?? "used_posts.json");

    const d = c.discord ?? {} as FullConfig["discord"];
    setDiscordEnabled(d.enabled ?? true);
    setWebhookUrl(d.webhook_url ?? "");
    setUploadMedia(d.upload_media ?? true);

    const g = (c as any).gemini ?? {};
    setGeminiEnabled(g.enabled ?? false);
    setGeminiProvider(g.provider ?? "gemini");
    setGeminiApiKey(g.api_key ?? "");
    setOpenrouterApiKey(g.openrouter_api_key ?? "");
    setGeminiModel(g.model ?? "gemini-2.0-flash");
    setGeminiHook(g.generate_hook ?? true);
    setGeminiThumbnail(g.generate_thumbnail_text ?? true);
    if (g.gemini_models?.length) setGeminiModels(g.gemini_models);
    if (g.openrouter_models?.length) setOpenrouterModels(g.openrouter_models);
    if (g.ollama_url) setOllamaUrl(g.ollama_url);
    if (g.ollama_models?.length) setOllamaModels(g.ollama_models);
    setNvidiaNimApiKey(g.nvidia_nim_api_key ?? "");
    if (g.nvidia_nim_models?.length) setNvidiaNimModels(g.nvidia_nim_models);

    const yt = (c as any).youtube ?? {};
    setYoutubeApiKey(yt.api_key ?? "");

    setInitialLoaded(true);
  }, [config, initialLoaded]);

  // Auto-set default model size when provider changes
  useEffect(() => {
    const currentProvider = providers.find((p) => p.id === ttsProvider);
    if (currentProvider?.models?.length && !ttsModelSize) {
      setTtsModelSize(currentProvider.models[0].id);
    }
  }, [ttsProvider, providers, ttsModelSize]);

  const addSubreddit = () => {
    const s = newSub.trim().replace(/^r\//, "");
    if (s && !subreddits.includes(s)) {
      setSubreddits([...subreddits, s]);
      setNewSub("");
    }
  };

  const toggleVoice = (voice: string) => {
    setTtsCommentVoices((prev) =>
      prev.includes(voice) ? prev.filter((v) => v !== voice) : [...prev, voice]
    );
  };

  const handleSave = () => {
    updateMutation.mutate(
      {
        subreddits,
        request_delay: requestDelay,
        reddit: {
          fetch_limit: redditFetchLimit,
          max_per_subreddit_per_run: redditKeepPerSub,
        },
        filters: {
          min_upvotes: minUpvotes,
          min_comments: minComments,
          max_comments: maxComments,
          min_age_hours: minAgeHours,
          max_age_hours: maxAgeHours,
          allow_nsfw: allowNsfw,
          require_selftext: requireSelftext,
        },
        formatting: {
          default_mode: fmtMode,
          max_comments: fmtMaxComments,
          min_comment_score: fmtMinScore,
        },
        tts: {
          enabled: ttsEnabled,
          provider: ttsProvider,
          model_size: ttsModelSize,
          main_voice: ttsMainVoice,
          use_multiple_voices: ttsMultiVoice,
          comment_voices: ttsCommentVoices,
          output_format: ttsFormat,
          speed: ttsSpeed,
          pre_normalize: ttsPreNormalize,
          voice_presets: votePresets,
          elevenlabs_api_key: elevenApiKey,
          elevenlabs_model_id: elevenModel,
          elevenlabs: {
            api_key: elevenApiKey,
            model_id: elevenModel,
            stability: elevenStability,
            similarity_boost: elevenSimilarity,
            style: elevenStyle,
            use_speaker_boost: elevenSpeakerBoost,
          },
        },
        video: {
          mode: videoMode,
          hw_accel: hwAccel,
          use_gpu: hwAccel !== "none",
          auto_cleanup: autoCleanup,
          threads,
          engine,
          split_duration: splitDuration,
          outro_text: outroText,
          branding,
        },
        captions: {
          enabled: capEnabled,
          font_path: capFontPath,
          font_size: capFontSize,
          color: capColor,
          stroke_color: capStrokeColor,
          stroke_width: capStrokeWidth,
          bg_color: capBgEnabled ? capBgColor : null,
          bg_opacity: capBgOpacity,
          padding: capPadding,
          corner_radius: capCornerRadius,
          max_width_pct: capMaxWidthPct,
          position: capPosition,
          position_offset: capPositionOffset,
          words_per_caption: capWordsPerCaption,
          uppercase: capUppercase,
          attribution: capAttribution,
          animation: capAnimation,
          animation_duration: capAnimationDuration,
          pop_overshoot: capPopOvershoot,
          pop_start_scale: capPopStartScale,
          force_align: capForceAlign,
          align_model_size: capAlignModelSize,
          highlight_word: capHighlightWord,
          highlight_color: capHighlightColor,
          highlight_scale: capHighlightScale,
          highlight_stroke_color: capHighlightStrokeColor,
        },
        output: {
          posts_directory: postsDir,
          used_posts_file: usedPostsFile,
        },
        discord: {
          enabled: discordEnabled,
          webhook_url: webhookUrl,
          upload_media: uploadMedia,
        },
        gemini: {
          enabled: geminiEnabled,
          provider: geminiProvider,
          api_key: geminiApiKey,
          openrouter_api_key: openrouterApiKey,
          nvidia_nim_api_key: nvidiaNimApiKey,
          model: geminiModel,
          generate_hook: geminiHook,
          generate_thumbnail_text: geminiThumbnail,
          gemini_models: geminiModels,
          openrouter_models: openrouterModels,
          ollama_url: ollamaUrl,
          ollama_models: ollamaModels,
          nvidia_nim_models: nvidiaNimModels,
        },
        youtube: {
          api_key: youtubeApiKey,
        },
      },
      {
        onSuccess: () => toast({ title: "Configuration saved" }),
        onError: (e) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-destructive text-sm">{(error as Error)?.message || "Failed to load config"}</p>
        <p className="text-muted-foreground text-xs">Make sure the backend is running</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Configuration</h2>
          <p className="text-xs text-muted-foreground mt-1">Manage your pipeline settings — all sections of config.json</p>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="glow-primary gap-2">
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save All
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        {/* Sidebar nav */}
        <aside className="md:w-56 flex-shrink-0">
          <nav className="flex md:flex-col gap-1 md:sticky md:top-4 overflow-x-auto md:overflow-visible">
            {tabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "text-muted-foreground hover:bg-secondary/60 border border-transparent"
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Tab content */}
        <div className="flex-1 min-w-0 space-y-5">
        <div className={activeTab === "general" ? "space-y-5" : "hidden"}>
        {/* Subreddits & General */}
        <Section title="Subreddits & General" icon={<Settings2 className="h-4 w-4 text-primary" />}>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Subreddits</Label>
            <div className="flex flex-wrap gap-1.5">
              {subreddits.map((sub) => (
                <Badge key={sub} variant="secondary" className="gap-1 font-mono text-xs">
                  r/{sub}
                  <button onClick={() => setSubreddits(subreddits.filter((s) => s !== sub))}>
                    <X className="h-3 w-3 hover:text-destructive transition-colors" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubreddit()}
                placeholder="Add subreddit..."
                className="h-8 text-xs bg-secondary border-border"
              />
              <Button size="sm" variant="outline" onClick={addSubreddit} className="h-8 px-2">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Request Delay (s)</Label>
              <Input type="number" value={requestDelay} onChange={(e) => setRequestDelay(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={0.5} min={0} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" title="How many posts to request from Reddit per subreddit listing (max 100). Higher = more candidates survive filtering.">
                Fetch per sub
              </Label>
              <Input type="number" value={redditFetchLimit} onChange={(e) => setRedditFetchLimit(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={5} min={5} max={100} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" title="Max posts to keep per subreddit after filtering. Must be <= Fetch per sub.">
                Keep per sub
              </Label>
              <Input type="number" value={redditKeepPerSub} onChange={(e) => setRedditKeepPerSub(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={1} min={1} max={100} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            The scanner pulls <b>{redditFetchLimit}</b> posts per subreddit, applies
            your filters, then keeps at most <b>{redditKeepPerSub}</b>. If good posts
            get filtered out, bump Fetch higher (not Keep).
          </p>
        </Section>

        {/* Filters */}
        <Section title="Post Filters" icon={<MessageSquare className="h-4 w-4 text-primary" />}>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span>Min Upvotes</span>
              <span className="font-mono text-primary">{minUpvotes}</span>
            </div>
            <Slider value={[minUpvotes]} onValueChange={([v]) => setMinUpvotes(v)} max={10000} step={50} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Min Comments</label>
              <Input type="number" value={minComments} onChange={(e) => setMinComments(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max Comments</label>
              <Input type="number" value={maxComments} onChange={(e) => setMaxComments(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Min Age (hours)</label>
              <Input type="number" value={minAgeHours} onChange={(e) => setMinAgeHours(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max Age (hours)</label>
              <Input type="number" value={maxAgeHours} onChange={(e) => setMaxAgeHours(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Allow NSFW</label>
            <Switch checked={allowNsfw} onCheckedChange={setAllowNsfw} />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Require Story Text</label>
            <Switch checked={requireSelftext} onCheckedChange={setRequireSelftext} />
          </div>
        </Section>
        </div>

        <div className={activeTab === "formatting" ? "space-y-5" : "hidden"}>
        {/* Formatting */}
        <Section title="Story Formatting" icon={<MessageSquare className="h-4 w-4 text-accent" />}>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Default Mode</Label>
            <Select value={fmtMode} onValueChange={setFmtMode}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="qa">Q&A (Question + Answers)</SelectItem>
                <SelectItem value="story">Story (Selftext narration)</SelectItem>
                <SelectItem value="comments">Comments Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Max Comments</label>
              <Input type="number" value={fmtMaxComments} onChange={(e) => setFmtMaxComments(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Min Comment Score</label>
              <Input type="number" value={fmtMinScore} onChange={(e) => setFmtMinScore(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
          </div>
        </Section>
        </div>

        <div className={activeTab === "tts" ? "space-y-5" : "hidden"}>
        {/* TTS */}
        <Section title="Text-to-Speech" icon={<Mic className="h-4 w-4 text-accent" />}>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">TTS Enabled</label>
            <Switch checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
          </div>

          {ttsEnabled && (
            <>
              {/* Info box */}
              <div className="rounded-md bg-secondary/50 border border-border p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">How it works:</strong> The pipeline splits the story into <strong>segments</strong> — title, body paragraphs, and individual comments each become a separate audio clip. These are stitched into a timeline that drives the video rendering.
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Multiple Voices:</strong> When enabled, the narrator voice reads the title & body, while each comment is read by a randomly assigned voice from your selected pool — creating a natural multi-speaker feel.
                </p>
              </div>

              <Separator />

              {/* Provider Selection with Install/Verify */}
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <div className="space-y-2">
                  {providers.map((p) => {
                    const isSelected = ttsProvider === p.id;
                    const isLocal = p.type === "local";
                    return (
                      <div
                        key={p.id}
                        className={`rounded-lg border p-3 cursor-pointer transition-all ${
                          isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                        }`}
                        onClick={() => setTtsProvider(p.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isLocal ? <Cpu className="h-3.5 w-3.5 text-accent" /> : <Mic className="h-3.5 w-3.5 text-primary" />}
                            <span className="text-xs font-medium">{p.name}</span>
                            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                              {p.type === "local" ? "Local GPU" : "Cloud"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {p.installed ? (
                              <Badge variant="default" className="text-[9px] px-1.5 py-0 gap-0.5">
                                <CheckCircle2 className="h-3 w-3" /> Ready
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5 border-warning text-warning">
                                <XCircle className="h-3 w-3" /> Not Installed
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">{p.details}</p>
                        
                        {/* Install/Verify buttons for local providers */}
                        {isLocal && (
                          <div className="flex gap-2 mt-2">
                            {!p.installed && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] gap-1"
                                disabled={installMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  installMutation.mutate(p.id, {
                                    onSuccess: (data) => {
                                      if (data.success) {
                                        toast({ title: `${p.name} installed`, description: "Provider is now ready to use." });
                                      } else {
                                        toast({ title: "Install failed", description: data.error || "Check server logs", variant: "destructive" });
                                      }
                                    },
                                    onError: (err) => toast({ title: "Install error", description: err.message, variant: "destructive" }),
                                  });
                                }}
                              >
                                {installMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                Install
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Re-fetch providers to verify
                                toast({ title: "Checking...", description: `Verifying ${p.name} installation` });
                              }}
                            >
                              <RefreshCw className="h-3 w-3" /> Verify
                            </Button>
                          </div>
                        )}

                        {/* Model size selector for local providers */}
                        {isLocal && isSelected && p.models && p.models.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Model Size</Label>
                            <div className="space-y-1">
                              {p.models.map((m: any) => {
                                const isDownloaded = p.models_downloaded?.includes(m.id);
                                const isActive = ttsModelSize === m.id;
                                return (
                                  <div
                                    key={m.id}
                                    className={`rounded-md border p-2 cursor-pointer transition-all ${
                                      isActive ? "border-primary bg-primary/10" : "border-border/50 hover:border-primary/30"
                                    }`}
                                    onClick={(e) => { e.stopPropagation(); setTtsModelSize(m.id); }}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-[11px] font-medium">{m.name}</span>
                                      <div className="flex items-center gap-1">
                                        <Badge variant="outline" className="text-[8px] px-1 py-0">{m.size}</Badge>
                                        {isDownloaded && (
                                          <Badge variant="default" className="text-[8px] px-1 py-0 gap-0.5">
                                            <CheckCircle2 className="h-2.5 w-2.5" /> Cached
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <p className="text-[9px] text-muted-foreground mt-0.5">{m.description}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        
                        {isSelected && p.voices && (
                          <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/50">
                            {(p.voices_detailed ?? p.voices.map(v => ({ id: v, name: v, lang: "en", gender: "unknown" }))).slice(0, 8).map((v: any) => (
                              <Badge key={typeof v === "string" ? v : v.id} variant="secondary" className="text-[9px] gap-0.5">
                                {typeof v === "string" ? v : (
                                  <>
                                    <span className="font-medium">{v.name}</span>
                                    <span className="text-muted-foreground">({v.lang})</span>
                                  </>
                                )}
                              </Badge>
                            ))}
                            {p.voices.length > 8 && (
                              <Badge variant="secondary" className="text-[9px]">+{p.voices.length - 8} more</Badge>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {providersLoading && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Main Narrator Voice</Label>
                {(() => {
                  // For ElevenLabs, pull the live voice library using the saved API key.
                  if (ttsProvider === "elevenlabs") {
                    const voices = elevenVoicesQuery.data?.voices ?? [];
                    const err = elevenVoicesQuery.data?.error;
                    const isLoading = elevenVoicesQuery.isFetching;
                    return (
                      <>
                        <Select value={ttsMainVoice} onValueChange={setTtsMainVoice}>
                          <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                            <SelectValue placeholder={
                              err === "missing_api_key" ? "Enter API key below first" :
                              err === "unauthorized" ? "API key rejected" :
                              err ? "Failed to load voices" :
                              isLoading ? "Loading voices..." :
                              voices.length ? "Select a voice..." : "No voices found"
                            } />
                          </SelectTrigger>
                          <SelectContent className="max-h-[380px]">
                            {/* 1. User's account voices (live from /v2/voices) */}
                            {voices.length > 0 && (
                              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground">Your voices</div>
                            )}
                            {voices.map((v) => (
                              <SelectItem key={v.voice_id} value={v.voice_id}>
                                {v.name}
                                {v.category ? ` — ${v.category}` : ""}
                              </SelectItem>
                            ))}
                            {/* 2. ElevenLabs default library voices (always available) —
                                   skip ones already shown in the user's account above. */}
                            <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground border-t border-border mt-1">
                              ElevenLabs Library
                            </div>
                            {ELEVENLABS_LIBRARY
                              .filter((lib) => !voices.some((v) => v.voice_id === lib.id))
                              .map((lib) => (
                                <SelectItem key={lib.id} value={lib.id}>
                                  {lib.name} — {lib.category}
                                </SelectItem>
                              ))}
                            {/* Keep the current value selectable even if not in either list */}
                            {ttsMainVoice && !voices.some(v => v.voice_id === ttsMainVoice) &&
                              !ELEVENLABS_LIBRARY.some(l => l.id === ttsMainVoice) && (
                              <SelectItem value={ttsMainVoice}>{ttsMainVoice} (saved)</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {err && (
                          <p className="text-[10px] text-destructive">
                            {err === "missing_api_key" ? "Save your ElevenLabs API key below, then click Save All to refresh this list." :
                             err === "unauthorized" ? "Your ElevenLabs API key was rejected (401)." :
                             `ElevenLabs error: ${err}`}
                          </p>
                        )}
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">
                            Or paste a raw voice_id (e.g. public library voice)
                          </Label>
                          <Input
                            value={ttsMainVoice}
                            onChange={(e) => setTtsMainVoice(e.target.value)}
                            placeholder="nPczCjzI2devNBz1zQrb (Brian), 21m00Tcm4TlvDq8ikWAM (Rachel), ..."
                            className="h-7 text-[11px] font-mono bg-secondary border-border"
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Voices are fetched live from your ElevenLabs account. To use a library voice
                          like <strong>Brian</strong>, either add it via{" "}
                          <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noreferrer"
                             className="underline hover:text-primary">elevenlabs.io/app/voice-library</a>
                          {" "}or paste its voice_id above.
                        </p>
                      </>
                    );
                  }
                  // Default: use the provider's static voice list from /api/tts/providers.
                  const currentProvider = providers.find((p) => p.id === ttsProvider);
                  const voiceList = currentProvider?.voices ?? STREAMLABS_VOICES;
                  const detailedList = currentProvider?.voices_detailed;
                  return (
                    <>
                      <Select value={ttsMainVoice} onValueChange={setTtsMainVoice}>
                        <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {voiceList.map((v) => {
                            const detail = detailedList?.find((d) => d.id === v);
                            return (
                              <SelectItem key={v} value={v}>
                                {detail ? `${detail.name} (${detail.lang}, ${detail.gender})` : v}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        Used for the post title and body/story text narration.
                      </p>
                    </>
                  );
                })()}
              </div>

              {/* Per-provider Male / Female presets */}
              <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                <div>
                  <label className="text-xs font-medium text-foreground">Gender Presets</label>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Used when the Run dialog selects a narrator gender (auto-detected from the post or forced).
                    Falls back to Main Narrator Voice if left blank.
                  </p>
                </div>
                {(() => {
                  const currentProvider = providers.find((p) => p.id === ttsProvider);
                  let voiceList: { id: string; label: string }[] = [];
                  if (ttsProvider === "elevenlabs") {
                    const ev = elevenVoicesQuery.data?.voices ?? [];
                    voiceList = ev.map((v) => ({ id: v.voice_id, label: `${v.name}${v.category ? ` — ${v.category}` : ""}` }));
                    // Append library voices not already in the account.
                    for (const lib of ELEVENLABS_LIBRARY) {
                      if (!voiceList.some((x) => x.id === lib.id)) {
                        voiceList.push({ id: lib.id, label: `${lib.name} (library) — ${lib.category}` });
                      }
                    }
                  } else {
                    const detailed = currentProvider?.voices_detailed ?? [];
                    const raw = currentProvider?.voices ?? STREAMLABS_VOICES;
                    voiceList = raw.map((v) => {
                      const d = detailed.find((x: any) => x.id === v);
                      return { id: v, label: d ? `${d.name} (${d.lang}, ${d.gender})` : v };
                    });
                  }
                  const preset = votePresets[ttsProvider] ?? { male: "", female: "" };
                  const set = (g: "male" | "female", v: string) => {
                    setVotePresets({
                      ...votePresets,
                      [ttsProvider]: { ...preset, [g]: v },
                    });
                  };
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Male preset</Label>
                        <Select value={preset.male || "__none__"} onValueChange={(v) => set("male", v === "__none__" ? "" : v)}>
                          <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— none —</SelectItem>
                            {voiceList.map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Female preset</Label>
                        <Select value={preset.female || "__none__"} onValueChange={(v) => set("female", v === "__none__" ? "" : v)}>
                          <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— none —</SelectItem>
                            {voiceList.map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {ttsProvider === "elevenlabs" && (
                <div className="rounded-lg border border-border p-3 space-y-3 bg-primary/5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">ElevenLabs Settings</span>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">API Key</Label>
                    <SecretInput
                      value={elevenApiKey}
                      onChange={(e) => setElevenApiKey(e.target.value)}
                      placeholder="sk_..."
                      inputClassName="h-8 text-xs bg-secondary border-border"
                    />
                    <p className="text-[10px] text-muted-foreground">Get one at <code>elevenlabs.io</code> → Profile → API Keys.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Model</Label>
                    <Select value={elevenModel} onValueChange={setElevenModel}>
                      <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eleven_multilingual_v2">Multilingual v2 (best quality)</SelectItem>
                        <SelectItem value="eleven_turbo_v2_5">Turbo v2.5 (fast, low latency)</SelectItem>
                        <SelectItem value="eleven_monolingual_v1">Monolingual v1 (classic English)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Stability ({elevenStability.toFixed(2)})</Label>
                      <Slider value={[Math.round(elevenStability * 100)]} onValueChange={([v]) => setElevenStability(v / 100)} min={0} max={100} step={1} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Similarity ({elevenSimilarity.toFixed(2)})</Label>
                      <Slider value={[Math.round(elevenSimilarity * 100)]} onValueChange={([v]) => setElevenSimilarity(v / 100)} min={0} max={100} step={1} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Style ({elevenStyle.toFixed(2)})</Label>
                      <Slider value={[Math.round(elevenStyle * 100)]} onValueChange={([v]) => setElevenStyle(v / 100)} min={0} max={100} step={1} />
                    </div>
                    <div className="flex items-end justify-between pb-1">
                      <label className="text-xs text-muted-foreground">Speaker Boost</label>
                      <Switch checked={elevenSpeakerBoost} onCheckedChange={setElevenSpeakerBoost} />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Lower stability = more emotion/variance. Higher similarity = closer to the voice preset.
                  </p>
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-muted-foreground">Multiple Voices for Comments</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Each comment gets a random voice from the pool below</p>
                </div>
                <Switch checked={ttsMultiVoice} onCheckedChange={setTtsMultiVoice} />
              </div>
              {ttsMultiVoice && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Comment Voice Pool</Label>
                    <span className="text-[10px] text-muted-foreground">{ttsCommentVoices.length} selected</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(() => {
                      const currentProvider = providers.find((p) => p.id === ttsProvider);
                      const voiceList = currentProvider?.voices ?? STREAMLABS_VOICES;
                      const detailedList = currentProvider?.voices_detailed;
                      return voiceList.map((v) => {
                        const detail = detailedList?.find((d) => d.id === v);
                        const label = detail ? `${detail.name} (${detail.lang})` : v;
                        return (
                          <Badge
                            key={v}
                            variant={ttsCommentVoices.includes(v) ? "default" : "outline"}
                            className="cursor-pointer text-xs"
                            onClick={() => toggleVoice(v)}
                          >
                            {label}
                          </Badge>
                        );
                      });
                    })()}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Click to toggle. More voices = more variety in the final video.</p>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span>Playback Speed</span>
                  <span className="font-mono text-primary">{ttsSpeed}x</span>
                </div>
                <Slider value={[ttsSpeed]} onValueChange={([v]) => setTtsSpeed(v)} min={0.25} max={2} step={0.05} />
                <p className="text-[10px] text-muted-foreground">
                  {ttsSpeed < 0.8 ? "Slow — good for dramatic stories" : ttsSpeed > 1.2 ? "Fast — more content per video" : "Normal conversational pace"}
                </p>
              </div>

              <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Pre-TTS Cleanup (Ollama)</label>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                      Runs your text through local Ollama to expand Reddit shorthand
                      (<code>tho</code>→<code>though</code>, <code>cuz</code>→<code>because</code>)
                      and fix typos before sending to paid TTS. Skipped automatically if Ollama is offline.
                    </p>
                  </div>
                  <Switch checked={ttsPreNormalize} onCheckedChange={setTtsPreNormalize} />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Uses the <code>gemini.ollama_url</code> and AI Hooks model. Cached per-post so Re-render doesn't re-query.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Output Format</Label>
                <Select value={ttsFormat} onValueChange={setTtsFormat}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mp3">MP3 (smaller files)</SelectItem>
                    <SelectItem value="wav">WAV (lossless quality)</SelectItem>
                    <SelectItem value="ogg">OGG (good compression)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </Section>
        </div>

        <div className={activeTab === "video" ? "space-y-5" : "hidden"}>
        {/* Video */}
        <Section title="Video Rendering" icon={<Film className="h-4 w-4 text-warning" />}>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Video Mode</Label>
            <Select value={videoMode} onValueChange={setVideoMode}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Video</SelectItem>
                <SelectItem value="reel">Reel</SelectItem>
                <SelectItem value="short_reel">Short Reel (Split)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Engine</Label>
            <Select value={engine} onValueChange={setEngine}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ffmpeg">FFmpeg (Recommended)</SelectItem>
                <SelectItem value="moviepy">MoviePy (Fallback)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Hardware Acceleration</Label>
            <Select value={hwAccel} onValueChange={setHwAccel}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">CPU (libx264)</SelectItem>
                <SelectItem value="nvenc">NVIDIA GPU (NVENC)</SelectItem>
                <SelectItem value="amf">AMD GPU (AMF)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              {hwAccel === "nvenc" ? "Requires NVIDIA GPU with NVENC support" : hwAccel === "amf" ? "Requires AMD GPU with AMF support (RX 400+)" : "Works on any system, no GPU required"}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Auto Cleanup</label>
            <Switch checked={autoCleanup} onCheckedChange={setAutoCleanup} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Threads (0 = auto)</label>
              <Input type="number" value={threads} onChange={(e) => setThreads(+e.target.value)} className="h-8 text-xs bg-secondary border-border" min={0} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Split Duration (s)</label>
              <Input type="number" value={splitDuration} onChange={(e) => setSplitDuration(+e.target.value)} className="h-8 text-xs bg-secondary border-border" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Outro Text</Label>
            <Input value={outroText} onChange={(e) => setOutroText(e.target.value)} className="h-8 text-xs bg-secondary border-border" />
          </div>
          <Separator />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Branding Watermark</Label>
            <Input value={branding} onChange={(e) => setBranding(e.target.value)} placeholder="e.g. @yourhandle or YourChannel" className="h-8 text-xs bg-secondary border-border" />
            <p className="text-[10px] text-muted-foreground">Shown on thumbnails to prevent uncredited copying. Leave blank to disable.</p>
          </div>
        </Section>
        </div>

        <div className={activeTab === "captions" ? "" : "hidden"}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
        {/* Captions */}
        <Section title="Captions" icon={<Type className="h-4 w-4 text-primary" />}>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs text-muted-foreground">Enable Captions</label>
              <p className="text-[10px] text-muted-foreground">Turn off to render video with no on-screen text</p>
            </div>
            <Switch checked={capEnabled} onCheckedChange={setCapEnabled} />
          </div>

          {capEnabled && (
            <>
              <Separator />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Font {fontsData?.fonts ? `(${fontsData.fonts.length} installed)` : ""}
                </Label>
                {(() => {
                  const fonts = fontsData?.fonts ?? [];
                  const values = new Set(fonts.map((f) => f.path));
                  const currentInList = values.has(capFontPath);
                  const selectValue = currentInList ? capFontPath : "__custom__";
                  return (
                    <>
                      <Select
                        value={selectValue}
                        onValueChange={(v) => {
                          if (v === "__custom__") return;
                          setCapFontPath(v);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                          <SelectValue placeholder={fonts.length ? "Select a font..." : "Loading fonts..."} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[320px]">
                          <SelectItem value="__custom__">Custom path (edit below)</SelectItem>
                          {fonts.map((f) => (
                            <SelectItem key={f.path} value={f.path}>
                              <span style={{ fontFamily: `"${f.family}", sans-serif` }}>
                                {f.family}{f.style && f.style.toLowerCase() !== "regular" ? ` — ${f.style}` : ""}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={capFontPath}
                        onChange={(e) => setCapFontPath(e.target.value)}
                        placeholder="arial.ttf or absolute .ttf path"
                        className="h-8 text-xs bg-secondary border-border font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Pick from installed fonts, or type a name/path — PIL resolves <code>arial.ttf</code> from the Windows fonts folder automatically.
                      </p>
                    </>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Font Size</Label>
                  <Input type="number" value={capFontSize} onChange={(e) => setCapFontSize(+e.target.value)} className="h-8 text-xs bg-secondary border-border" min={10} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Words per Caption (0 = whole)</Label>
                  <Input type="number" value={capWordsPerCaption} onChange={(e) => setCapWordsPerCaption(+e.target.value)} className="h-8 text-xs bg-secondary border-border" min={0} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Text Color</Label>
                  <ColorInput value={capColor} onChange={setCapColor} placeholder="#ffffff" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Stroke Color</Label>
                  <ColorInput value={capStrokeColor} onChange={setCapStrokeColor} placeholder="#000000" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Stroke Width ({capStrokeWidth}px)</Label>
                <Slider value={[capStrokeWidth]} onValueChange={([v]) => setCapStrokeWidth(v)} min={0} max={10} step={1} />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">UPPERCASE</label>
                <Switch checked={capUppercase} onCheckedChange={setCapUppercase} />
              </div>

              <Separator />
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Background Box</label>
                <Switch checked={capBgEnabled} onCheckedChange={setCapBgEnabled} />
              </div>
              {capBgEnabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">BG Color</Label>
                      <ColorInput value={capBgColor} onChange={setCapBgColor} placeholder="#000000" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Corner Radius ({capCornerRadius}px)</Label>
                      <Slider value={[capCornerRadius]} onValueChange={([v]) => setCapCornerRadius(v)} min={0} max={80} step={1} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">BG Opacity ({capBgOpacity})</Label>
                      <Slider value={[capBgOpacity]} onValueChange={([v]) => setCapBgOpacity(v)} min={0} max={255} step={1} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Padding ({capPadding}px)</Label>
                      <Slider value={[capPadding]} onValueChange={([v]) => setCapPadding(v)} min={0} max={100} step={1} />
                    </div>
                  </div>
                </>
              )}

              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Position</Label>
                  <Select value={capPosition} onValueChange={(v) => setCapPosition(v as "center" | "bottom" | "top")}>
                    <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="bottom">Bottom (third)</SelectItem>
                      <SelectItem value="top">Top (third)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Position Offset ({capPositionOffset}px)</Label>
                  <Slider value={[capPositionOffset]} onValueChange={([v]) => setCapPositionOffset(v)} min={-400} max={400} step={5} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max Width ({Math.round(capMaxWidthPct * 100)}% of frame)</Label>
                <Slider value={[Math.round(capMaxWidthPct * 100)]} onValueChange={([v]) => setCapMaxWidthPct(v / 100)} min={20} max={100} step={1} />
              </div>

              <Separator />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Animation</Label>
                <Select value={capAnimation} onValueChange={(v) => setCapAnimation(v as "none" | "fade" | "pop" | "fade_pop")}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="fade">Fade in/out</SelectItem>
                    <SelectItem value="pop">Pop (scale-in)</SelectItem>
                    <SelectItem value="fade_pop">Fade + Pop</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Animations require <code>engine = moviepy</code>. FFmpeg engine ignores them.
                </p>
              </div>
              {capAnimation !== "none" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Animation Duration ({capAnimationDuration.toFixed(2)}s)</Label>
                    <Slider value={[Math.round(capAnimationDuration * 100)]} onValueChange={([v]) => setCapAnimationDuration(v / 100)} min={2} max={80} step={1} />
                  </div>
                  {(capAnimation === "pop" || capAnimation === "fade_pop") && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Pop Start Scale ({capPopStartScale.toFixed(2)})</Label>
                        <Slider value={[Math.round(capPopStartScale * 100)]} onValueChange={([v]) => setCapPopStartScale(v / 100)} min={10} max={100} step={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Pop Overshoot ({capPopOvershoot.toFixed(2)})</Label>
                        <Slider value={[Math.round(capPopOvershoot * 100)]} onValueChange={([v]) => setCapPopOvershoot(v / 100)} min={100} max={150} step={1} />
                      </div>
                    </div>
                  )}
                </>
              )}

              <Separator />
              <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Highlight Spoken Word</label>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                      Currently-spoken word gets a different color (and optionally scales up).
                      Requires <strong>Forced Alignment</strong> below to be enabled — otherwise there's
                      no per-word timing data to drive it.
                    </p>
                  </div>
                  <Switch checked={capHighlightWord} onCheckedChange={setCapHighlightWord} />
                </div>
                {capHighlightWord && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Highlight Color</Label>
                        <ColorInput value={capHighlightColor} onChange={setCapHighlightColor} placeholder="#FFD93D" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Highlight Stroke</Label>
                        <ColorInput value={capHighlightStrokeColor} onChange={setCapHighlightStrokeColor} placeholder="#000000" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Active-word Scale ({capHighlightScale.toFixed(2)}×)
                      </Label>
                      <Slider value={[Math.round(capHighlightScale * 100)]} onValueChange={([v]) => setCapHighlightScale(v / 100)} min={100} max={150} step={1} />
                      <p className="text-[10px] text-muted-foreground">1.00× = no scale-up. 1.10× is classic TikTok pop. Above 1.20× may cause line-height jumps.</p>
                    </div>
                  </>
                )}
              </div>

              <Separator />
              <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-muted-foreground font-medium">Forced Alignment (Whisper)</label>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                      Runs local faster-whisper on each TTS clip to get per-word timestamps, then
                      syncs caption chunks to the actual spoken words. Results cached per-file
                      so Re-render is free. Silently skipped if <code>faster-whisper</code> isn't installed.
                    </p>
                  </div>
                  <Switch checked={capForceAlign} onCheckedChange={setCapForceAlign} />
                </div>
                {capForceAlign && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Whisper Model Size</Label>
                    <Select value={capAlignModelSize} onValueChange={setCapAlignModelSize}>
                      <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tiny">tiny (~75 MB, fastest, less accurate)</SelectItem>
                        <SelectItem value="base">base (~145 MB, recommended)</SelectItem>
                        <SelectItem value="small">small (~500 MB, more accurate)</SelectItem>
                        <SelectItem value="medium">medium (~1.5 GB, slow, best for noisy voices)</SelectItem>
                        <SelectItem value="large-v2">large-v2 (~3 GB, most stable on TTS voices — recommended)</SelectItem>
                        <SelectItem value="large-v3">large-v3 (~3 GB, best on real voices but can hallucinate on TTS)</SelectItem>
                        <SelectItem value="distil-large-v3">distil-large-v3 (~1.5 GB, 6× faster than large-v3, near-identical accuracy)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">
                      Auto-detects CUDA. First run downloads the model (one-time).
                    </p>
                  </div>
                )}
              </div>

              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-muted-foreground">Show Attribution</label>
                  <p className="text-[10px] text-muted-foreground">Shows "u/&lt;branding&gt;" above the caption per segment</p>
                </div>
                <Switch checked={capAttribution} onCheckedChange={setCapAttribution} />
              </div>
            </>
          )}
        </Section>
        </div>
        <div className="xl:sticky xl:top-4 self-start">
          <CaptionsPreview
            enabled={capEnabled}
            fontPath={capFontPath}
            fontSize={capFontSize}
            color={capColor}
            strokeColor={capStrokeColor}
            strokeWidth={capStrokeWidth}
            bgEnabled={capBgEnabled}
            bgColor={capBgColor}
            bgOpacity={capBgOpacity}
            padding={capPadding}
            cornerRadius={capCornerRadius}
            maxWidthPct={capMaxWidthPct}
            position={capPosition}
            positionOffset={capPositionOffset}
            wordsPerCaption={capWordsPerCaption}
            uppercase={capUppercase}
            animation={capAnimation}
            animationDuration={capAnimationDuration}
            popOvershoot={capPopOvershoot}
            popStartScale={capPopStartScale}
            highlightWord={capHighlightWord}
            highlightColor={capHighlightColor}
            highlightScale={capHighlightScale}
            highlightStrokeColor={capHighlightStrokeColor}
          />
        </div>
        </div>
        </div>

        <div className={activeTab === "ai" ? "space-y-5" : "hidden"}>
        {/* AI Hooks */}
        <Section title="AI Hooks" icon={<Sparkles className="h-4 w-4 text-primary" />}>
          <div className="rounded-md bg-secondary/50 border border-border p-3">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">How it works:</strong> AI generates a 3-4 second attention-grabbing hook prepended to the video narration, plus curiosity-driven thumbnail text — all without spoiling the story.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Enable AI Hooks</label>
            <Switch checked={geminiEnabled} onCheckedChange={setGeminiEnabled} />
          </div>
          {geminiEnabled && (
            <div className="space-y-3 pl-2 border-l-2 border-primary/20">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <Select value={geminiProvider} onValueChange={(v) => {
                  setGeminiProvider(v);
                  if (v === "openrouter") setGeminiModel(openrouterModels[0] || "");
                  else if (v === "ollama") setGeminiModel(ollamaModels[0] || "llama3.2");
                  else if (v === "nvidia_nim") setGeminiModel(nvidiaNimModels[0] || "meta/llama-3.1-405b-instruct");
                  else setGeminiModel(geminiModels[0] || "gemini-2.0-flash");
                }}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gemini">Gemini (Google AI Studio)</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                    <SelectItem value="ollama">Ollama (Local / Cloud)</SelectItem>
                    <SelectItem value="nvidia_nim">Nvidia NIM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Model</Label>
                <Select value={geminiModel} onValueChange={setGeminiModel}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(geminiProvider === "openrouter" ? openrouterModels : geminiProvider === "ollama" ? ollamaModels : geminiProvider === "nvidia_nim" ? nvidiaNimModels : geminiModels).map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1.5 mt-1.5">
                  <Input
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const id = newModelId.trim();
                        if (!id) return;
                        if (geminiProvider === "openrouter") {
                          if (!openrouterModels.includes(id)) setOpenrouterModels([...openrouterModels, id]);
                        } else if (geminiProvider === "ollama") {
                          if (!ollamaModels.includes(id)) setOllamaModels([...ollamaModels, id]);
                        } else if (geminiProvider === "nvidia_nim") {
                          if (!nvidiaNimModels.includes(id)) setNvidiaNimModels([...nvidiaNimModels, id]);
                        } else {
                          if (!geminiModels.includes(id)) setGeminiModels([...geminiModels, id]);
                        }
                        setNewModelId("");
                      }
                    }}
                    placeholder="Add custom model ID..."
                    className="h-7 text-xs bg-secondary border-border font-mono"
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => {
                    const id = newModelId.trim();
                    if (!id) return;
                    if (geminiProvider === "openrouter") {
                      if (!openrouterModels.includes(id)) setOpenrouterModels([...openrouterModels, id]);
                    } else if (geminiProvider === "ollama") {
                      if (!ollamaModels.includes(id)) setOllamaModels([...ollamaModels, id]);
                    } else if (geminiProvider === "nvidia_nim") {
                      if (!nvidiaNimModels.includes(id)) setNvidiaNimModels([...nvidiaNimModels, id]);
                    } else {
                      if (!geminiModels.includes(id)) setGeminiModels([...geminiModels, id]);
                    }
                    setNewModelId("");
                  }}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {(geminiProvider === "openrouter" ? openrouterModels : geminiProvider === "ollama" ? ollamaModels : geminiProvider === "nvidia_nim" ? nvidiaNimModels : geminiModels).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {(geminiProvider === "openrouter" ? openrouterModels : geminiProvider === "ollama" ? ollamaModels : geminiProvider === "nvidia_nim" ? nvidiaNimModels : geminiModels).map((m) => (
                      <Badge key={m} variant="secondary" className="gap-1 font-mono text-[10px] px-1.5 py-0">
                        {m}
                        <button onClick={() => {
                          if (geminiProvider === "openrouter") {
                            const updated = openrouterModels.filter((x) => x !== m);
                            setOpenrouterModels(updated);
                            if (geminiModel === m) setGeminiModel(updated[0] || "");
                          } else if (geminiProvider === "ollama") {
                            const updated = ollamaModels.filter((x) => x !== m);
                            setOllamaModels(updated);
                            if (geminiModel === m) setGeminiModel(updated[0] || "");
                          } else if (geminiProvider === "nvidia_nim") {
                            const updated = nvidiaNimModels.filter((x) => x !== m);
                            setNvidiaNimModels(updated);
                            if (geminiModel === m) setGeminiModel(updated[0] || "");
                          } else {
                            const updated = geminiModels.filter((x) => x !== m);
                            setGeminiModels(updated);
                            if (geminiModel === m) setGeminiModel(updated[0] || "");
                          }
                        }}>
                          <X className="h-2.5 w-2.5 hover:text-destructive transition-colors" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              {geminiProvider === "gemini" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Gemini API Key</Label>
                  <SecretInput
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIza..."
                    inputClassName="h-8 text-xs bg-secondary border-border"
                  />
                </div>
              )}
              {geminiProvider === "openrouter" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">OpenRouter API Key</Label>
                  <SecretInput
                    value={openrouterApiKey}
                    onChange={(e) => setOpenrouterApiKey(e.target.value)}
                    placeholder="sk-or-..."
                    inputClassName="h-8 text-xs bg-secondary border-border"
                  />
                </div>
              )}
              {geminiProvider === "ollama" && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Ollama URL</Label>
                    <Input
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="h-8 text-xs bg-secondary border-border font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Local: http://localhost:11434 · Cloud: your remote Ollama endpoint
                    </p>
                  </div>
                </div>
              )}
              {geminiProvider === "nvidia_nim" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Nvidia NIM API Key</Label>
                  <SecretInput
                    value={nvidiaNimApiKey}
                    onChange={(e) => setNvidiaNimApiKey(e.target.value)}
                    placeholder="nvapi-..."
                    inputClassName="h-8 text-xs bg-secondary border-border"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Get your key from <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">build.nvidia.com</a>
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-muted-foreground">Generate Video Hook</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">3-4s spoken intro prepended to the story</p>
                </div>
                <Switch checked={geminiHook} onCheckedChange={setGeminiHook} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-muted-foreground">Generate Thumbnail Text</label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Eye-catching overlay text for thumbnails</p>
                </div>
                <Switch checked={geminiThumbnail} onCheckedChange={setGeminiThumbnail} />
              </div>

              <Separator />

              <TestAiButton
                provider={geminiProvider}
                model={geminiModel}
                apiKey={geminiProvider === "openrouter" ? openrouterApiKey : geminiProvider === "nvidia_nim" ? nvidiaNimApiKey : geminiApiKey}
                ollamaUrl={geminiProvider === "ollama" ? ollamaUrl : undefined}
              />
            </div>
          )}
        </Section>

        {/* YouTube Benchmarks (style references for Social Copy) */}
        <Section title="YouTube Benchmarks" icon={<Youtube className="h-4 w-4 text-destructive" />}>
          <p className="text-[11px] text-muted-foreground leading-snug">
            When generating social copy, the AI can reference the top-performing short
            videos in the same niche (same subreddit + "reddit stories shorts") to match
            proven hook phrasing, tag patterns, and tone. Uses the YouTube Data API v3.
            Free tier = 10,000 units/day ≈ ~90 generations. Results cached for 24h per query.
          </p>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">YouTube Data API v3 Key</Label>
            <SecretInput
              value={youtubeApiKey}
              onChange={(e) => setYoutubeApiKey(e.target.value)}
              placeholder="AIza... (leave empty to disable benchmarks)"
              inputClassName="h-8 text-xs bg-secondary border-border"
            />
            <p className="text-[10px] text-muted-foreground">
              Get a key: <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console</a> →
              enable "YouTube Data API v3" → create an API key. No billing required for free tier.
            </p>
          </div>
        </Section>
        </div>

        <div className={activeTab === "publishing" ? "space-y-5" : "hidden"}>
        <Section title="YouTube Shorts" icon={<Youtube className="h-4 w-4 text-[#ff0000]" />}>
          <YouTubePublishingPanel />
        </Section>
        <Section title="TikTok" icon={<Film className="h-4 w-4 text-muted-foreground" />}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Coming next. TikTok's Content Posting API requires a developer app
            that's been approved — until approval you're stuck in sandbox mode
            (5 test users). We'll wire it up once you're ready to apply.
          </p>
        </Section>
        <Section title="Instagram Reels" icon={<Film className="h-4 w-4 text-muted-foreground" />}>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Coming next. Instagram needs a Business/Creator account linked to a
            Facebook Page plus a public URL for the video during upload (IG
            fetches, doesn't accept direct bytes). More setup-heavy than YouTube.
          </p>
        </Section>
        </div>

        <div className={activeTab === "output" ? "space-y-5" : "hidden"}>
        {/* Output & Discord */}
        <div className="space-y-5">
          <Section title="Output Paths" icon={<FolderOutput className="h-4 w-4 text-success" />}>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Posts Directory</Label>
              <Input value={postsDir} onChange={(e) => setPostsDir(e.target.value)} className="h-8 text-xs bg-secondary border-border font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Used Posts File</Label>
              <Input value={usedPostsFile} onChange={(e) => setUsedPostsFile(e.target.value)} className="h-8 text-xs bg-secondary border-border font-mono" />
            </div>
          </Section>

          <Section title="Discord Notifications" icon={<Bell className="h-4 w-4 text-accent" />}>
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Discord Enabled</label>
              <Switch checked={discordEnabled} onCheckedChange={setDiscordEnabled} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Webhook URL</Label>
              <SecretInput
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                inputClassName="h-8 text-xs bg-secondary border-border"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">Upload Media Files</label>
              <Switch checked={uploadMedia} onCheckedChange={setUploadMedia} />
            </div>
          </Section>
        </div>
        </div>
        </div>
      </div>

      {/* Floating save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={handleSave} disabled={updateMutation.isPending} size="lg" className="glow-primary gap-2 shadow-xl">
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Configuration
        </Button>
      </div>
    </motion.div>
  );
}
