import { useState, useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import {
  Settings2, Save, Loader2, Plus, X, RotateCcw,
  MessageSquare, Mic, Film, FolderOutput, Bell,
  Download, CheckCircle2, XCircle, RefreshCw, Cpu, Sparkles, Zap, Type, Youtube,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
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
import { TitleCardSettings } from "@/components/TitleCardSettings";
import { ELEVENLABS_LIBRARY } from "@/components/ElevenLabsLibraryPresets";
import { ElevenLabsVoiceCloneCard } from "@/components/ElevenLabsVoiceCloneCard";
import { WorkspaceBackupPanel } from "@/components/WorkspaceBackupPanel";

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
  const [redditMaxPages, setRedditMaxPages] = useState(4);

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

  // Background music — surfaces in TTS tab below the voices.
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmVolumeDb, setBgmVolumeDb] = useState(-18);
  const [bgmAutoPickByTone, setBgmAutoPickByTone] = useState(true);
  const [bgmManualTrack, setBgmManualTrack] = useState("");

  // Auto B-roll overlay — Video tab. Pexels free API key + max-per-minute.
  const [brollEnabled, setBrollEnabled] = useState(false);
  const [brollPexelsKey, setBrollPexelsKey] = useState("");
  const [brollMaxPerMin, setBrollMaxPerMin] = useState(4);

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
  // Watermark position + style (config.video.watermark). Sliders feed
  // straight into config; the live preview below mirrors the same
  // x_pct / y_pct math the backend renderer uses so what the user
  // sees in the panel matches what gets composited at render time.
  const [wmXPct, setWmXPct] = useState(100);
  const [wmYPct, setWmYPct] = useState(100);
  const [wmOpacity, setWmOpacity] = useState(100);
  const [wmFontSize, setWmFontSize] = useState(30);
  const [wmBgBox, setWmBgBox] = useState(true);

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
  const [capAnimation, setCapAnimation] = useState<"none" | "fade" | "pop" | "fade_pop" | "karaoke_fill" | "boxed_word">("none");
  const [capAnimationDuration, setCapAnimationDuration] = useState(0.15);
  const [capPopOvershoot, setCapPopOvershoot] = useState(1.12);
  const [capPopStartScale, setCapPopStartScale] = useState(0.7);
  const [capForceAlign, setCapForceAlign] = useState(false);
  const [capAlignModelSize, setCapAlignModelSize] = useState("base");
  const [capHighlightWord, setCapHighlightWord] = useState(false);
  const [capHighlightColor, setCapHighlightColor] = useState("#FFD93D");
  const [capHighlightScale, setCapHighlightScale] = useState(1.1);
  const [capHighlightStrokeColor, setCapHighlightStrokeColor] = useState("#000000");
  const [capSingleLine, setCapSingleLine] = useState(false);
  // Drop-shadow controls (all optional, off by default).
  const [capShadowEnabled, setCapShadowEnabled] = useState(false);
  const [capShadowColor, setCapShadowColor] = useState("#000000");
  const [capShadowOpacity, setCapShadowOpacity] = useState(180);
  const [capShadowOffsetX, setCapShadowOffsetX] = useState(4);
  const [capShadowOffsetY, setCapShadowOffsetY] = useState(4);
  const [capShadowBlur, setCapShadowBlur] = useState(6);

  // ── Caption preset swap ────────────────────────────────────────
  // Two presets live in config: `captions` (Reddit/AI pipeline) and
  // `clip_captions` (Clip Maker). The UI edits one at a time; flipping
  // the switcher below flushes the current values into the inactive
  // preset's buffer and loads the other buffer into the cap* state.
  type CaptionPreset = "reddit" | "clip";
  const [activeCaptionPreset, setActiveCaptionPreset] = useState<CaptionPreset>("reddit");
  // Buffers hold the other preset's values while we're editing the active one.
  const captionBuffers = useRef<Record<CaptionPreset, Record<string, any>>>({
    reddit: {}, clip: {},
  });

  // Snapshot all cap* state into a plain object so we can swap it wholesale.
  const readCurrentCaps = (): Record<string, any> => ({
    enabled: capEnabled, font_path: capFontPath, font_size: capFontSize,
    color: capColor, stroke_color: capStrokeColor, stroke_width: capStrokeWidth,
    bg_enabled: capBgEnabled, bg_color: capBgColor, bg_opacity: capBgOpacity,
    padding: capPadding, corner_radius: capCornerRadius,
    max_width_pct: capMaxWidthPct, position: capPosition, position_offset: capPositionOffset,
    words_per_caption: capWordsPerCaption, uppercase: capUppercase,
    attribution: capAttribution, animation: capAnimation,
    animation_duration: capAnimationDuration, pop_overshoot: capPopOvershoot,
    pop_start_scale: capPopStartScale, force_align: capForceAlign,
    align_model_size: capAlignModelSize, highlight_word: capHighlightWord,
    highlight_color: capHighlightColor, highlight_scale: capHighlightScale,
    highlight_stroke_color: capHighlightStrokeColor, single_line: capSingleLine,
    shadow_enabled: capShadowEnabled, shadow_color: capShadowColor,
    shadow_opacity: capShadowOpacity, shadow_offset_x: capShadowOffsetX,
    shadow_offset_y: capShadowOffsetY, shadow_blur: capShadowBlur,
  });
  const applyCaptionBuffer = (buf: Record<string, any>) => {
    setCapEnabled(buf.enabled ?? true);
    setCapFontPath(buf.font_path ?? "arial.ttf");
    setCapFontSize(buf.font_size ?? 80);
    setCapColor(buf.color ?? "white");
    setCapStrokeColor(buf.stroke_color ?? "black");
    setCapStrokeWidth(buf.stroke_width ?? 4);
    setCapBgEnabled(Boolean(buf.bg_enabled ?? (buf.bg_color != null && buf.bg_color !== "")));
    setCapBgColor(buf.bg_color ?? "black");
    setCapBgOpacity(buf.bg_opacity ?? 160);
    setCapPadding(buf.padding ?? 30);
    setCapCornerRadius(buf.corner_radius ?? 20);
    setCapMaxWidthPct(buf.max_width_pct ?? 0.85);
    setCapPosition(buf.position ?? "bottom");
    setCapPositionOffset(buf.position_offset ?? 0);
    setCapWordsPerCaption(buf.words_per_caption ?? 3);
    setCapUppercase(buf.uppercase ?? true);
    setCapAttribution(buf.attribution ?? false);
    setCapAnimation(buf.animation ?? "none");
    setCapAnimationDuration(buf.animation_duration ?? 0.15);
    setCapPopOvershoot(buf.pop_overshoot ?? 1.12);
    setCapPopStartScale(buf.pop_start_scale ?? 0.7);
    setCapForceAlign(buf.force_align ?? false);
    setCapAlignModelSize(buf.align_model_size ?? "base");
    setCapHighlightWord(buf.highlight_word ?? false);
    setCapHighlightColor(buf.highlight_color ?? "#FFD93D");
    setCapHighlightScale(buf.highlight_scale ?? 1.1);
    setCapHighlightStrokeColor(buf.highlight_stroke_color ?? "#000000");
    setCapSingleLine(buf.single_line ?? false);
    setCapShadowEnabled(buf.shadow_enabled ?? false);
    setCapShadowColor(buf.shadow_color ?? "#000000");
    setCapShadowOpacity(buf.shadow_opacity ?? 180);
    setCapShadowOffsetX(buf.shadow_offset_x ?? 4);
    setCapShadowOffsetY(buf.shadow_offset_y ?? 4);
    setCapShadowBlur(buf.shadow_blur ?? 6);
  };
  const switchCaptionPreset = (next: CaptionPreset) => {
    if (next === activeCaptionPreset) return;
    // Flush current state into the active buffer, then load the other.
    captionBuffers.current[activeCaptionPreset] = readCurrentCaps();
    applyCaptionBuffer(captionBuffers.current[next] || {});
    setActiveCaptionPreset(next);
  };
  // Serialize a buffer into the exact shape the backend config expects.
  const _captionPayload = (buf: Record<string, any>) => ({
    enabled:               buf.enabled ?? true,
    font_path:             buf.font_path ?? "arial.ttf",
    font_size:             buf.font_size ?? 80,
    color:                 buf.color ?? "white",
    stroke_color:          buf.stroke_color ?? "black",
    stroke_width:          buf.stroke_width ?? 4,
    bg_color:              buf.bg_enabled ? (buf.bg_color ?? "black") : null,
    bg_opacity:            buf.bg_opacity ?? 160,
    padding:               buf.padding ?? 30,
    corner_radius:         buf.corner_radius ?? 20,
    max_width_pct:         buf.max_width_pct ?? 0.85,
    position:              buf.position ?? "bottom",
    position_offset:       buf.position_offset ?? 0,
    words_per_caption:     buf.words_per_caption ?? 3,
    uppercase:             buf.uppercase ?? true,
    attribution:           buf.attribution ?? false,
    animation:             buf.animation ?? "none",
    animation_duration:    buf.animation_duration ?? 0.15,
    pop_overshoot:         buf.pop_overshoot ?? 1.12,
    pop_start_scale:       buf.pop_start_scale ?? 0.7,
    force_align:           buf.force_align ?? false,
    align_model_size:      buf.align_model_size ?? "base",
    highlight_word:        buf.highlight_word ?? false,
    highlight_color:       buf.highlight_color ?? "#FFD93D",
    highlight_scale:       buf.highlight_scale ?? 1.1,
    highlight_stroke_color: buf.highlight_stroke_color ?? "#000000",
    single_line:           buf.single_line ?? false,
    shadow_enabled:        buf.shadow_enabled ?? false,
    shadow_color:          buf.shadow_color ?? "#000000",
    shadow_opacity:        buf.shadow_opacity ?? 180,
    shadow_offset_x:       buf.shadow_offset_x ?? 4,
    shadow_offset_y:       buf.shadow_offset_y ?? 4,
    shadow_blur:           buf.shadow_blur ?? 6,
  });

  // Output
  const [postsDir, setPostsDir] = useState("posts");
  const [usedPostsFile, setUsedPostsFile] = useState("used_posts.json");

  // Discord
  const [discordEnabled, setDiscordEnabled] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [uploadMedia, setUploadMedia] = useState(true);

  // Pipeline step skipping. Only the truly-optional steps are
  // exposed: thumbnail (PIL composition + optional captioning AI
  // call) and notify (Discord webhook). The earlier steps are core.
  // We keep these as inverted switches ("skip thumbnail" = ON when
  // step is in disabled_steps) so the OFF state of the toggle is
  // the safe default.
  const [skipThumbnail, setSkipThumbnail] = useState(false);
  const [skipNotify, setSkipNotify] = useState(false);

  // AI Hooks
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiProvider, setGeminiProvider] = useState("gemini");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [nvidiaNimApiKey, setNvidiaNimApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.0-flash");
  const [geminiHook, setGeminiHook] = useState(true);
  const [geminiThumbnail, setGeminiThumbnail] = useState(true);

  // Per-feature model overrides — empty string means "use the global
  // model above." Lets users pay flagship rates only on the things
  // that benefit (story generation) while running cheaper models on
  // the supporting tasks (scoring, hashtags, social copy, etc.).
  const [featureModels, setFeatureModels] = useState<Record<string, string>>({
    story_generation: "",
    scoring:          "",
    social_copy:      "",
    hashtag_analysis: "",
    comment_reply:    "",
    niche_finder:     "",
    dialogue:         "",
  });
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

  // Title-card branding (avatar + username + hide stats + visual knobs)
  const [tnUsername, setTnUsername] = useState("");
  const [tnHideStats, setTnHideStats] = useState(true);
  const [tnProfilePicPath, setTnProfilePicPath] = useState("");
  const [tnCardBgColor, setTnCardBgColor] = useState("#FFFFFF");
  const [tnTextColor, setTnTextColor] = useState("#141414");
  const [tnUsernameColor, setTnUsernameColor] = useState("#1E1E1E");
  const [tnAccentColor, setTnAccentColor] = useState("#FF4500");
  const [tnCornerRadius, setTnCornerRadius] = useState(30);
  const [tnCardMaxWidthPct, setTnCardMaxWidthPct] = useState(0.84);
  const [tnTitleFontSize, setTnTitleFontSize] = useState(52);
  const [tnUsernameFontSize, setTnUsernameFontSize] = useState(36);
  // Border + animation knobs. Width 0 = no border. Default animations
  // are 'fade' on both sides — matches the captions experience and is
  // an unambiguous "this looks more polished than a hard cut" upgrade.
  const [tnBorderColor, setTnBorderColor] = useState("#FF4500");
  const [tnBorderWidth, setTnBorderWidth] = useState(0);
  const [tnEntryAnimation, setTnEntryAnimation] = useState("fade");
  const [tnEntryDuration, setTnEntryDuration] = useState(0.45);
  const [tnExitAnimation, setTnExitAnimation] = useState("fade");
  const [tnExitDuration, setTnExitDuration] = useState(0.35);

  // Default background selector (video.background_selector)
  const [videoBgSelector, setVideoBgSelector] = useState<string>("");
  const [bgFolders, setBgFolders] = useState<{ path: string; name: string; video_count: number }[]>([]);
  useEffect(() => {
    // Live-pull folder list so the dropdown reflects what's in backgrounds/ right now.
    api.listBackgroundFolders()
      .then((r) => setBgFolders(r.folders))
      .catch(() => setBgFolders([{ path: "", name: "(All backgrounds — random)", video_count: 0 }]));
  }, []);

  const [initialLoaded, setInitialLoaded] = useState(false);
  type TabId = "general" | "formatting" | "tts" | "video" | "captions" | "ai" | "publishing" | "output";
  // Honor ?tab=X in the URL so the command palette can deep-link into a section.
  const urlTabRaw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  const validTabs: TabId[] = ["general", "formatting", "tts", "video", "captions", "ai", "publishing", "output"];
  const initialTab = (urlTabRaw && (validTabs as string[]).includes(urlTabRaw) ? urlTabRaw : "general") as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // Sidebar collapse — persisted so the state doesn't jump on refresh.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("rtr_config_sidebar_collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("rtr_config_sidebar_collapsed", sidebarCollapsed ? "1" : "0"); } catch {}
  }, [sidebarCollapsed]);

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "general",    label: "General",       icon: <Settings2 className="h-4 w-4" /> },
    { id: "formatting", label: "Formatting",    icon: <MessageSquare className="h-4 w-4" /> },
    { id: "tts",        label: "Text-to-Speech", icon: <Mic className="h-4 w-4" /> },
    { id: "video",      label: "Video",         icon: <Film className="h-4 w-4" /> },
    { id: "captions",   label: "Captions",      icon: <Type className="h-4 w-4" /> },
    { id: "ai",         label: "AI Model",      icon: <Sparkles className="h-4 w-4" /> },
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
    setRedditMaxPages(rcfg.max_fetch_pages ?? 4);

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

    const bgm = ((t as any).background_music as Record<string, unknown>) ?? {};
    setBgmEnabled(Boolean(bgm.enabled));
    setBgmVolumeDb(typeof bgm.volume_db === "number" ? bgm.volume_db : -18);
    setBgmAutoPickByTone(bgm.auto_pick_by_tone !== undefined ? Boolean(bgm.auto_pick_by_tone) : true);
    setBgmManualTrack(typeof bgm.manual_track === "string" ? bgm.manual_track : "");

    const v = c.video ?? {} as FullConfig["video"];
    setVideoMode(v.mode ?? "short_reel");
    setHwAccel(v.hw_accel ?? "none");
    setAutoCleanup(v.auto_cleanup ?? false);
    setThreads(v.threads ?? 0);
    setEngine(v.engine ?? "ffmpeg");
    setSplitDuration(v.split_duration ?? 30);
    setOutroText(v.outro_text ?? "Follow for Part {next_part}");
    setBranding(v.branding ?? "");
    const wm = (v as any).watermark ?? {};
    setWmXPct(typeof wm.x_pct === "number" ? wm.x_pct : 100);
    setWmYPct(typeof wm.y_pct === "number" ? wm.y_pct : 100);
    setWmOpacity(typeof wm.opacity === "number" ? wm.opacity : 100);
    setWmFontSize(typeof wm.font_size === "number" ? wm.font_size : 30);
    setWmBgBox(wm.bg_box === undefined ? true : Boolean(wm.bg_box));

    const broll = ((v as any).broll as Record<string, unknown>) ?? {};
    setBrollEnabled(Boolean(broll.enabled));
    setBrollPexelsKey(typeof broll.pexels_api_key === "string" ? broll.pexels_api_key : "");
    setBrollMaxPerMin(typeof broll.max_clips_per_minute === "number" ? broll.max_clips_per_minute : 4);

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
    setCapAnimation((cap.animation as "none" | "fade" | "pop" | "fade_pop" | "karaoke_fill" | "boxed_word") ?? "none");
    setCapAnimationDuration(cap.animation_duration ?? 0.15);
    setCapPopOvershoot(cap.pop_overshoot ?? 1.12);
    setCapPopStartScale(cap.pop_start_scale ?? 0.7);
    setCapForceAlign((cap as any).force_align ?? false);
    setCapAlignModelSize((cap as any).align_model_size ?? "base");
    setCapHighlightWord((cap as any).highlight_word ?? false);
    setCapHighlightColor((cap as any).highlight_color ?? "#FFD93D");
    setCapHighlightScale((cap as any).highlight_scale ?? 1.1);
    setCapHighlightStrokeColor((cap as any).highlight_stroke_color ?? (cap.stroke_color ?? "#000000"));
    setCapSingleLine((cap as any).single_line ?? false);
    setCapShadowEnabled((cap as any).shadow_enabled ?? false);
    setCapShadowColor((cap as any).shadow_color ?? "#000000");
    setCapShadowOpacity((cap as any).shadow_opacity ?? 180);
    setCapShadowOffsetX((cap as any).shadow_offset_x ?? 4);
    setCapShadowOffsetY((cap as any).shadow_offset_y ?? 4);
    setCapShadowBlur((cap as any).shadow_blur ?? 6);

    // Seed the OTHER preset's buffer too, so switching is instant. If
    // clip_captions is null/missing, it mirrors reddit captions initially
    // so the user sees sane defaults instead of blanks.
    const redditCap = { ...(cap || {}) };
    const clipCap = { ...((c as any).clip_captions || cap || {}) };
    captionBuffers.current = {
      reddit: redditCap as Record<string, any>,
      clip:   clipCap as Record<string, any>,
    };

    const o = c.output ?? {} as FullConfig["output"];
    setPostsDir(o.posts_directory ?? "posts");
    setUsedPostsFile(o.used_posts_file ?? "used_posts.json");

    const d = c.discord ?? {} as FullConfig["discord"];
    setDiscordEnabled(d.enabled ?? true);
    setWebhookUrl(d.webhook_url ?? "");
    setUploadMedia(d.upload_media ?? true);

    const pipe = (c as any).pipeline ?? {};
    const disabled: string[] = Array.isArray(pipe.disabled_steps) ? pipe.disabled_steps : [];
    setSkipThumbnail(disabled.includes("thumbnail"));
    setSkipNotify(disabled.includes("notify"));

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

    // Per-feature model overrides — only override fields that are
    // non-empty in saved config so a missing block doesn't blank the
    // local defaults. Legacy `scoring_model` key is migrated.
    const fm = (g.feature_models ?? {}) as Record<string, string>;
    setFeatureModels((prev) => ({
      ...prev,
      ...Object.fromEntries(Object.entries(fm).map(([k, v]) => [k, String(v ?? "")])),
      // Migrate the legacy single-purpose field if present:
      ...(g.scoring_model && !fm.scoring ? { scoring: String(g.scoring_model) } : {}),
    }));

    const yt = (c as any).youtube ?? {};
    setYoutubeApiKey(yt.api_key ?? "");

    const tn = (c as any).thumbnail ?? {};
    setTnUsername(tn.username ?? "");
    setTnHideStats(tn.hide_stats ?? true);
    setTnProfilePicPath(tn.profile_pic_path ?? "");
    setTnCardBgColor(tn.card_bg_color ?? "#FFFFFF");
    setTnTextColor(tn.text_color ?? "#141414");
    setTnUsernameColor(tn.username_color ?? "#1E1E1E");
    setTnAccentColor(tn.accent_color ?? "#FF4500");
    setTnCornerRadius(tn.corner_radius ?? 30);
    setTnCardMaxWidthPct(tn.card_max_width_pct ?? 0.84);
    setTnTitleFontSize(tn.title_font_size ?? 52);
    setTnUsernameFontSize(tn.username_font_size ?? 36);
    setTnBorderColor(tn.border_color ?? "#FF4500");
    setTnBorderWidth(tn.border_width ?? 0);
    setTnEntryAnimation(tn.entry_animation ?? "fade");
    setTnEntryDuration(tn.entry_duration ?? 0.45);
    setTnExitAnimation(tn.exit_animation ?? "fade");
    setTnExitDuration(tn.exit_duration ?? 0.35);

    setVideoBgSelector(((c as any).video ?? {}).background_selector ?? "");

    setInitialLoaded(true);
  }, [config, initialLoaded]);

  // Dirty-state detection — compare a signature of the current editable
  // state to the last saved snapshot. Prevents the user from silently
  // losing a subreddit add or filter tweak by navigating away.
  const savedSignature = useRef<string>("");
  const currentSignature = useMemo(() => JSON.stringify({
    subreddits,
    requestDelay,
    redditFetchLimit, redditKeepPerSub, redditMaxPages,
    minUpvotes, minComments, maxComments, minAgeHours, maxAgeHours,
    allowNsfw, requireSelftext,
    fmtMode, fmtMaxComments, fmtMinScore,
    ttsEnabled, ttsProvider, ttsModelSize, ttsMainVoice, ttsMultiVoice,
    ttsCommentVoices, ttsFormat, ttsSpeed, ttsPreNormalize, elevenApiKey,
    elevenModel, votePresets,
    bgmEnabled, bgmVolumeDb, bgmAutoPickByTone, bgmManualTrack,
    brollEnabled, brollPexelsKey, brollMaxPerMin,
    postsDir, usedPostsFile,
    discordEnabled, webhookUrl, uploadMedia,
    skipThumbnail, skipNotify,
    geminiEnabled, geminiProvider, geminiApiKey, openrouterApiKey, nvidiaNimApiKey,
    geminiModel, geminiHook, geminiThumbnail, geminiModels, openrouterModels,
    ollamaUrl, ollamaModels, nvidiaNimModels,
    featureModels,
    youtubeApiKey,
    tnUsername, tnHideStats, tnProfilePicPath,
    tnCardBgColor, tnTextColor, tnUsernameColor, tnAccentColor,
    tnCornerRadius, tnCardMaxWidthPct, tnTitleFontSize, tnUsernameFontSize,
    tnBorderColor, tnBorderWidth,
    tnEntryAnimation, tnEntryDuration, tnExitAnimation, tnExitDuration,
    videoBgSelector,
    capEnabled, capFontPath, capFontSize, capColor, capStrokeColor, capStrokeWidth,
    capBgEnabled, capBgColor, capBgOpacity, capPadding, capCornerRadius,
    capMaxWidthPct, capPosition, capPositionOffset, capWordsPerCaption,
    capUppercase, capAttribution, capAnimation, capAnimationDuration,
    capPopOvershoot, capPopStartScale, capForceAlign, capAlignModelSize,
    capHighlightWord, capHighlightColor, capHighlightScale, capHighlightStrokeColor, capSingleLine,
    capShadowEnabled, capShadowColor, capShadowOpacity, capShadowOffsetX, capShadowOffsetY, capShadowBlur,
    videoMode, hwAccel, engine, splitDuration, outroText,
    branding, wmXPct, wmYPct, wmOpacity, wmFontSize, wmBgBox,
    threads, autoCleanup,
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      subreddits, requestDelay, redditFetchLimit, redditKeepPerSub,
      minUpvotes, minComments, maxComments, minAgeHours, maxAgeHours,
      allowNsfw, requireSelftext, fmtMode, fmtMaxComments, fmtMinScore,
      ttsEnabled, ttsProvider, ttsModelSize, ttsMainVoice, ttsMultiVoice,
      ttsCommentVoices, ttsFormat, ttsSpeed, ttsPreNormalize, elevenApiKey,
      elevenModel, votePresets,
      bgmEnabled, bgmVolumeDb, bgmAutoPickByTone, bgmManualTrack,
      brollEnabled, brollPexelsKey, brollMaxPerMin,
      postsDir, usedPostsFile,
      discordEnabled, webhookUrl, uploadMedia,
      skipThumbnail, skipNotify,
      geminiEnabled, geminiProvider, geminiApiKey, openrouterApiKey, nvidiaNimApiKey,
      geminiModel, geminiHook, geminiThumbnail, geminiModels, openrouterModels,
      ollamaUrl, ollamaModels, nvidiaNimModels, featureModels, youtubeApiKey,
      capEnabled, capFontPath, capFontSize, capColor, capStrokeColor, capStrokeWidth,
      capBgEnabled, capBgColor, capBgOpacity, capPadding, capCornerRadius,
      capMaxWidthPct, capPosition, capPositionOffset, capWordsPerCaption,
      capUppercase, capAttribution, capAnimation, capAnimationDuration,
      capPopOvershoot, capPopStartScale, capForceAlign, capAlignModelSize,
      capHighlightWord, capHighlightColor, capHighlightScale, capHighlightStrokeColor, capSingleLine,
      capShadowEnabled, capShadowColor, capShadowOpacity, capShadowOffsetX, capShadowOffsetY, capShadowBlur,
      videoMode, hwAccel, engine, splitDuration, outroText,
      branding, wmXPct, wmYPct, wmOpacity, wmFontSize, wmBgBox,
    threads, autoCleanup,
    ]
  );
  // Seed the saved snapshot on the first load (after the loader effect ran).
  useEffect(() => {
    if (initialLoaded && !savedSignature.current) {
      savedSignature.current = currentSignature;
    }
  }, [initialLoaded, currentSignature]);
  const isDirty = initialLoaded && currentSignature !== savedSignature.current;

  // Warn on tab close / refresh with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

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
    // Flush whichever caption preset is being edited into its buffer so
    // both `captions` and `clip_captions` go out with fresh values.
    captionBuffers.current[activeCaptionPreset] = readCurrentCaps();
    const redditCapOut = _captionPayload(captionBuffers.current.reddit || {});
    const clipCapOut   = _captionPayload(captionBuffers.current.clip   || {});
    updateMutation.mutate(
      {
        subreddits,
        request_delay: requestDelay,
        reddit: {
          fetch_limit: redditFetchLimit,
          max_per_subreddit_per_run: redditKeepPerSub,
          max_fetch_pages: redditMaxPages,
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
          background_music: {
            enabled: bgmEnabled,
            volume_db: bgmVolumeDb,
            auto_pick_by_tone: bgmAutoPickByTone,
            manual_track: bgmManualTrack || "",
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
          watermark: {
            x_pct:     wmXPct,
            y_pct:     wmYPct,
            opacity:   wmOpacity,
            font_size: wmFontSize,
            bg_box:    wmBgBox,
          },
          background_selector: videoBgSelector,
          broll: {
            enabled: brollEnabled,
            pexels_api_key: brollPexelsKey,
            max_clips_per_minute: brollMaxPerMin,
          },
        },
        captions: redditCapOut,
        clip_captions: clipCapOut,
        output: {
          posts_directory: postsDir,
          used_posts_file: usedPostsFile,
        },
        pipeline: {
          // Build the disabled list from inverted toggles. Empty array
          // when neither is checked — backend treats missing/empty
          // identically to "everything enabled."
          disabled_steps: [
            ...(skipThumbnail ? ["thumbnail"] : []),
            ...(skipNotify ? ["notify"] : []),
          ],
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
          // Per-feature overrides — only persist non-empty values so
          // we don't pollute the config with a flat object of "" keys.
          feature_models: Object.fromEntries(
            Object.entries(featureModels).filter(([, v]) => v && v.trim()),
          ),
        },
        youtube: {
          api_key: youtubeApiKey,
        },
        thumbnail: {
          profile_pic_path: tnProfilePicPath,
          username: tnUsername,
          hide_stats: tnHideStats,
          card_bg_color: tnCardBgColor,
          text_color: tnTextColor,
          username_color: tnUsernameColor,
          accent_color: tnAccentColor,
          corner_radius: tnCornerRadius,
          card_max_width_pct: tnCardMaxWidthPct,
          title_font_size: tnTitleFontSize,
          username_font_size: tnUsernameFontSize,
          border_color: tnBorderColor,
          border_width: tnBorderWidth,
          entry_animation: tnEntryAnimation,
          entry_duration: tnEntryDuration,
          exit_animation: tnExitAnimation,
          exit_duration: tnExitDuration,
        },
      },
      {
        onSuccess: () => {
          savedSignature.current = currentSignature;
          toast({ title: "Configuration saved" });
        },
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
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] text-warning bg-warning/10 border border-warning/40 rounded-full px-2 py-0.5">
              Unsaved
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className={`gap-2 ${isDirty ? "glow-primary" : ""}`}
          >
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save All
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-5">
        {/* Sidebar nav — collapsible to icons only */}
        <aside className={`flex-shrink-0 transition-all duration-200 ${sidebarCollapsed ? "md:w-12" : "md:w-56"}`}>
          <nav className="flex md:flex-col gap-1 md:sticky md:top-4 overflow-x-auto md:overflow-visible">
            {/* Collapse toggle — hidden on mobile (horizontal scroll is already compact) */}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="hidden md:flex items-center justify-center gap-2 px-2 py-2 rounded-md text-[10px] text-muted-foreground hover:bg-secondary/60 mb-1 border border-dashed border-border"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : (
                <>
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Collapse</span>
                </>
              )}
            </button>
            {tabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  title={sidebarCollapsed ? t.label : undefined}
                  className={`flex items-center ${sidebarCollapsed ? "justify-center" : ""} gap-2 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "text-muted-foreground hover:bg-secondary/60 border border-transparent"
                  }`}
                >
                  {t.icon}
                  {!sidebarCollapsed && <span>{t.label}</span>}
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
            {isDirty && (
              <p className="text-[10px] text-warning mt-1 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                You have unsaved changes — click <strong>Save All</strong> (top right) or the sticky save button at the bottom.
              </p>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Request Delay (s)</Label>
              <Input type="number" value={requestDelay} onChange={(e) => setRequestDelay(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={0.5} min={0} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" title="Posts per Reddit listing page (max 100). Higher = each page has more candidates.">
                Page size
              </Label>
              <Input type="number" value={redditFetchLimit} onChange={(e) => setRedditFetchLimit(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={5} min={5} max={100} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" title="Target number of *eligible* posts to keep per subreddit. The scanner keeps paginating until it hits this many or runs out of pages.">
                Keep eligible
              </Label>
              <Input type="number" value={redditKeepPerSub} onChange={(e) => setRedditKeepPerSub(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={1} min={1} max={100} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground" title="Max Reddit listing pages to chain per subreddit if filters reject too many. Higher = more patient but slower and more API calls.">
                Max pages
              </Label>
              <Input type="number" value={redditMaxPages} onChange={(e) => setRedditMaxPages(+e.target.value)} className="h-8 text-xs bg-secondary border-border" step={1} min={1} max={8} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            The scanner pulls <b>{redditFetchLimit}</b> posts at a time and keeps
            paginating up to <b>{redditMaxPages}</b> pages until it collects
            {" "}<b>{redditKeepPerSub}</b> posts that pass your filters. NSFW-rejected
            posts are kept in the results so you can toggle "Allow NSFW" and pick
            them up; other rejects are trimmed heavily (a few are shown for
            context so you can see why filters are too strict).
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

                  {/* Instant Voice Cloning — record / drop a sample, get a new voice_id back */}
                  <ElevenLabsVoiceCloneCard
                    onCloned={() => elevenVoicesQuery.refetch()}
                  />
                </div>
              )}

              <Separator />

              {/* Background Music — picks a track from the music library
                  and mixes it under the narration during render. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      Background Music
                    </label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Mixes a track from your <a href="#/music" className="text-primary hover:underline">music library</a> under the narration.
                    </p>
                  </div>
                  <Switch checked={bgmEnabled} onCheckedChange={setBgmEnabled} />
                </div>
                {bgmEnabled && (
                  <div className="space-y-2 pl-3 border-l-2 border-primary/20">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">
                        Volume ({bgmVolumeDb} dB) — voice stays at unity, music attenuates
                      </Label>
                      <Slider
                        value={[bgmVolumeDb]}
                        onValueChange={([v]) => setBgmVolumeDb(v)}
                        min={-30} max={-3} step={1}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-[11px] text-muted-foreground">Auto-pick by story tone</Label>
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          When on, each render picks a random library track tagged with the story's tone (dramatic / funny / heartfelt / shocking / cringe).
                        </p>
                      </div>
                      <Switch checked={bgmAutoPickByTone} onCheckedChange={setBgmAutoPickByTone} />
                    </div>
                    {!bgmAutoPickByTone && (
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Manual track filename</Label>
                        <Input
                          value={bgmManualTrack}
                          onChange={(e) => setBgmManualTrack(e.target.value)}
                          placeholder="e.g. dramatic_loop.mp3 — exact filename from /music"
                          className="h-8 text-xs bg-secondary border-border font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Empty = no music. Manage tracks on the <a href="#/music" className="text-primary hover:underline">Music Library page</a>.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

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
          {/* Auto B-roll overlay — Pexels-driven topic-relevant footage
              picked by the LLM and stitched on top of the rendered video. */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs text-muted-foreground">Auto B-roll overlay</label>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                  Single largest perceived-quality jump for any reels niche. The LLM
                  picks 3-8 visual moments per render; the suite downloads matching
                  Pexels footage and overlays it at those timestamps via FFmpeg.
                </p>
              </div>
              <Switch checked={brollEnabled} onCheckedChange={setBrollEnabled} />
            </div>
            {brollEnabled && (
              <div className="space-y-2 pl-3 border-l-2 border-primary/20">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Pexels API key</Label>
                  <SecretInput
                    value={brollPexelsKey}
                    onChange={(e) => setBrollPexelsKey(e.target.value)}
                    placeholder="Free tier: 200 req/hr — get one at pexels.com/api"
                    inputClassName="h-8 text-xs bg-secondary border-border font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Sign up free at <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer"
                      className="text-primary hover:underline">pexels.com/api</a>. No payment, no rate limits in practice.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Max clips per minute of narration ({brollMaxPerMin})
                  </Label>
                  <Slider
                    value={[brollMaxPerMin]}
                    onValueChange={([v]) => setBrollMaxPerMin(v)}
                    min={1} max={8} step={1}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    A 60s reel at <code>4</code>/min gets up to 4 b-roll moments,
                    each typically 2-5s. Higher = more visual variety + longer
                    download time.
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground italic leading-snug">
                  Failures (Pexels search returning nothing for a query, download
                  timeout, FFmpeg overlay error) are silently skipped — your
                  render always succeeds even if b-roll falls through.
                </p>
              </div>
            )}
          </div>

          <Separator />

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
            <Label className="text-xs text-muted-foreground">Default Background</Label>
            <Select value={videoBgSelector || "__all__"} onValueChange={(v) => setVideoBgSelector(v === "__all__" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="__all__">
                  🎲 All backgrounds — random
                  {bgFolders[0]?.video_count ? <span className="text-muted-foreground ml-1"> ({bgFolders[0].video_count} videos)</span> : null}
                </SelectItem>
                {bgFolders.slice(1).map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    📁 {f.name} <span className="text-muted-foreground">({f.video_count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Picks the footage layer under your story audio. Leave on "random" to vary each render,
              or target a specific folder (e.g. your Minecraft parkour set). Manage clips in the
              <a href="#/backgrounds" className="text-primary hover:underline ml-1">Backgrounds</a> page.
            </p>
          </div>
          <Separator />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Branding Watermark</Label>
            <Input value={branding} onChange={(e) => setBranding(e.target.value)} placeholder="e.g. @yourhandle or YourChannel" className="h-8 text-xs bg-secondary border-border" />
            <p className="text-[10px] text-muted-foreground">Persistent overlay on every rendered video. Leave blank to disable.</p>
          </div>

          {/* Watermark editor — position / opacity / font size with a
              live mock preview. Slider math mirrors the backend's
              x_pct / y_pct → pixel calc so what the user sees here
              matches what gets composited at render time. */}
          {branding.trim() && (
            <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
              <p className="text-[11px] font-medium">Watermark position + style</p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                {/* Sliders */}
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <Label>Horizontal position</Label>
                      <span className="text-muted-foreground font-mono">
                        {wmXPct === 0 ? "left" : wmXPct === 100 ? "right" : `${wmXPct}%`}
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={wmXPct}
                      onChange={(e) => setWmXPct(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <Label>Vertical position</Label>
                      <span className="text-muted-foreground font-mono">
                        {wmYPct === 0 ? "top" : wmYPct === 100 ? "bottom" : `${wmYPct}%`}
                      </span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5}
                      value={wmYPct}
                      onChange={(e) => setWmYPct(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <Label>Opacity</Label>
                      <span className="text-muted-foreground font-mono">{wmOpacity}%</span>
                    </div>
                    <input
                      type="range" min={20} max={100} step={5}
                      value={wmOpacity}
                      onChange={(e) => setWmOpacity(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <Label>Font size</Label>
                      <span className="text-muted-foreground font-mono">{wmFontSize}px</span>
                    </div>
                    <input
                      type="range" min={16} max={72} step={2}
                      value={wmFontSize}
                      onChange={(e) => setWmFontSize(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Label className="text-[10px]">Background pill</Label>
                    <Switch checked={wmBgBox} onCheckedChange={setWmBgBox} />
                  </div>
                  {/* Quick preset pills for the four corners — saves
                      dragging two sliders to common positions. */}
                  <div className="flex gap-1 pt-1">
                    {[
                      { l: "TL", x: 0,   y: 0   },
                      { l: "TR", x: 100, y: 0   },
                      { l: "BL", x: 0,   y: 100 },
                      { l: "BR", x: 100, y: 100 },
                    ].map(({ l, x, y }) => (
                      <Button
                        key={l}
                        size="sm" variant="outline"
                        onClick={() => { setWmXPct(x); setWmYPct(y); }}
                        className="h-6 px-2 text-[10px]"
                      >
                        {l}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* 9:16 mock preview. Aspect ratio matches the actual
                    render output. The watermark text is positioned
                    using the same percentage math the backend uses. */}
                <div
                  className="rounded border border-border overflow-hidden bg-gradient-to-br from-secondary to-secondary/40 relative"
                  style={{ aspectRatio: "9/16" }}
                  title="Live preview — same position math as the renderer"
                >
                  <div
                    className="absolute pointer-events-none whitespace-nowrap"
                    style={{
                      // Replicate the backend's clamp: paste position
                      // is the LEFT-TOP corner of the watermark; we
                      // approximate using transform with anchor.
                      left:    `${wmXPct}%`,
                      top:     `${wmYPct}%`,
                      transform: `translate(${-wmXPct}%, ${-wmYPct}%)`,
                      opacity: wmOpacity / 100,
                    }}
                  >
                    <div
                      className={cn(
                        "rounded text-white font-semibold",
                        wmBgBox ? "bg-black/50 px-1.5 py-0.5" : "",
                      )}
                      style={{ fontSize: `${Math.max(8, wmFontSize / 4)}px` }}
                    >
                      {branding}
                    </div>
                  </div>
                  <p className="absolute bottom-1 left-1 text-[8px] text-muted-foreground/60 font-mono">9:16 preview</p>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title="Title Card" icon={<Type className="h-4 w-4 text-accent" />}>
          <TitleCardSettings
            username={tnUsername}                       onUsernameChange={setTnUsername}
            hideStats={tnHideStats}                     onHideStatsChange={setTnHideStats}
            profilePicPath={tnProfilePicPath}           onProfilePicChange={setTnProfilePicPath}
            cardBgColor={tnCardBgColor}                 onCardBgColorChange={setTnCardBgColor}
            textColor={tnTextColor}                     onTextColorChange={setTnTextColor}
            usernameColor={tnUsernameColor}             onUsernameColorChange={setTnUsernameColor}
            accentColor={tnAccentColor}                 onAccentColorChange={setTnAccentColor}
            cornerRadius={tnCornerRadius}               onCornerRadiusChange={setTnCornerRadius}
            cardMaxWidthPct={tnCardMaxWidthPct}         onCardMaxWidthPctChange={setTnCardMaxWidthPct}
            titleFontSize={tnTitleFontSize}             onTitleFontSizeChange={setTnTitleFontSize}
            usernameFontSize={tnUsernameFontSize}       onUsernameFontSizeChange={setTnUsernameFontSize}
            borderColor={tnBorderColor}                 onBorderColorChange={setTnBorderColor}
            borderWidth={tnBorderWidth}                 onBorderWidthChange={setTnBorderWidth}
            entryAnimation={tnEntryAnimation}           onEntryAnimationChange={setTnEntryAnimation}
            entryDuration={tnEntryDuration}             onEntryDurationChange={setTnEntryDuration}
            exitAnimation={tnExitAnimation}             onExitAnimationChange={setTnExitAnimation}
            exitDuration={tnExitDuration}               onExitDurationChange={setTnExitDuration}
          />
        </Section>
        </div>

        <div className={activeTab === "captions" ? "" : "hidden"}>
        {/* Preset switcher — the same UI below edits either `captions`
            (Reddit / AI pipeline) or `clip_captions` (Clip Maker). Values
            swap in and out of buffers on toggle; both get saved regardless
            of which one you were editing when you clicked Save. */}
        <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-secondary/40 mb-3">
          <Type className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-medium">Editing preset:</span>
          <div className="flex items-center gap-1">
            {(["reddit", "clip"] as const).map((p) => (
              <button
                key={p}
                onClick={() => switchCaptionPreset(p)}
                className={`h-6 px-2.5 text-[10px] rounded border transition-colors capitalize ${
                  activeCaptionPreset === p
                    ? "border-primary bg-primary/15 text-primary font-medium"
                    : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30"
                }`}
              >
                {p === "reddit" ? "Reddit / AI" : "Clip Maker"}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground ml-auto">
            Both presets save together when you hit Save All.
          </span>
        </div>

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
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Fit on one line</Label>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Never wrap to a second line — if a chunk doesn't fit, scale the whole chunk's
                    font down uniformly until it does. Fixes mid-word breaks.
                  </p>
                </div>
                <Switch checked={capSingleLine} onCheckedChange={setCapSingleLine} />
              </div>

              <Separator />
              {/* Drop shadow */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Drop shadow</Label>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Soft blurred shadow behind the text for extra pop on busy backgrounds.
                      Adds a gaussian-blurred silhouette at the configured offset.
                    </p>
                  </div>
                  <Switch checked={capShadowEnabled} onCheckedChange={setCapShadowEnabled} />
                </div>
                {capShadowEnabled && (
                  <div className="space-y-2 pl-2 border-l border-border/60">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Color</Label>
                        <Input
                          type="color"
                          value={/^#[0-9a-f]{6}$/i.test(capShadowColor) ? capShadowColor : "#000000"}
                          onChange={(e) => setCapShadowColor(e.target.value)}
                          className="h-8 w-full p-0.5 bg-secondary border-border"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">
                          Opacity ({Math.round((capShadowOpacity / 255) * 100)}%)
                        </Label>
                        <Slider
                          value={[capShadowOpacity]}
                          onValueChange={([v]) => setCapShadowOpacity(v)}
                          min={0} max={255} step={5}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Offset X ({capShadowOffsetX}px)</Label>
                        <Slider
                          value={[capShadowOffsetX]}
                          onValueChange={([v]) => setCapShadowOffsetX(v)}
                          min={-30} max={30} step={1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Offset Y ({capShadowOffsetY}px)</Label>
                        <Slider
                          value={[capShadowOffsetY]}
                          onValueChange={([v]) => setCapShadowOffsetY(v)}
                          min={-30} max={30} step={1}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Blur ({capShadowBlur}px)</Label>
                        <Slider
                          value={[capShadowBlur]}
                          onValueChange={([v]) => setCapShadowBlur(v)}
                          min={0} max={40} step={1}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Tip: for a clean cinematic look try <code>offset 4/4, blur 8, opacity 70%</code>.
                      For a hard drop try <code>offset 6/6, blur 0</code>.
                    </p>
                  </div>
                )}
              </div>

              <Separator />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Animation</Label>
                <Select value={capAnimation} onValueChange={(v) => setCapAnimation(v as any)}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="karaoke_fill">Karaoke fill — cumulative word colour sweep ✨</SelectItem>
                    <SelectItem value="boxed_word">Boxed word — pill behind every word ✨</SelectItem>
                    <SelectItem value="fade">Fade in/out (MoviePy only)</SelectItem>
                    <SelectItem value="pop">Pop scale-in (MoviePy only)</SelectItem>
                    <SelectItem value="fade_pop">Fade + Pop (MoviePy only)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  ✨ <b>Karaoke fill</b> and <b>Boxed word</b> work on the FFmpeg engine. They
                  require per-word highlight to be on (so the renderer knows the active word).
                  <br />Fade / Pop animations require <code>engine = moviepy</code>.
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
            singleLine={capSingleLine}
            shadowEnabled={capShadowEnabled}
            shadowColor={capShadowColor}
            shadowOpacity={capShadowOpacity}
            shadowOffsetX={capShadowOffsetX}
            shadowOffsetY={capShadowOffsetY}
            shadowBlur={capShadowBlur}
          />
        </div>
        </div>
        </div>

        <div className={activeTab === "ai" ? "space-y-5" : "hidden"}>
        {/* AI Provider — controls the LLM that powers every AI feature in
            the app (story generation, virality scoring, social copy, hooks,
            thumbnail text, hashtag analysis, etc). The two "Hook" toggles
            further down are individual feature switches that live under
            this provider; they're the reason this tab used to be called
            "AI Hooks" — but that name made it look like a tab about one
            small feature instead of the master AI config. */}
        <Section title="AI Provider" icon={<Sparkles className="h-4 w-4 text-primary" />}>
          <div className="rounded-md bg-secondary/50 border border-border p-3">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">This section configures the language model used by every AI feature</strong> — story generation, virality scoring, social copy, captions/hashtags, comment replies, niche finder, plus the two optional features below (intro hooks + thumbnail text). Pick a provider, drop in the key (or URL for Ollama), click Test, save.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs">Enable AI</label>
              <p className="text-[10px] text-muted-foreground mt-0.5">Master switch. Off = AI features fall back to non-AI paths where possible.</p>
            </div>
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
              <Separator />

              {/* Two optional add-ons that bolt onto every Reddit render.
                  Grouped under their own heading so it's obvious these
                  are extra features, not required setup. */}
              <div className="space-y-2 rounded-md border border-border/60 bg-secondary/20 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <Label className="text-[11px] font-semibold">Optional AI add-ons for Reddit renders</Label>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  These run as part of every Reddit pipeline. Turn off to save tokens — neither is required for a video to render.
                </p>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <label className="text-xs">Intro hook</label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">3–4s spoken hook prepended to the story (without spoiling it)</p>
                  </div>
                  <Switch checked={geminiHook} onCheckedChange={setGeminiHook} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs">Thumbnail text</label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Curiosity-gap overlay text for the video thumbnail</p>
                  </div>
                  <Switch checked={geminiThumbnail} onCheckedChange={setGeminiThumbnail} />
                </div>
              </div>

              <TestAiButton
                provider={geminiProvider}
                model={geminiModel}
                apiKey={geminiProvider === "openrouter" ? openrouterApiKey : geminiProvider === "nvidia_nim" ? nvidiaNimApiKey : geminiApiKey}
                ollamaUrl={geminiProvider === "ollama" ? ollamaUrl : undefined}
              />
            </div>
          )}

          {/* Per-feature model overrides — pay flagship rates only on
              the things that benefit. Empty = use the global model
              above. The picker above + these overrides cover every
              AI call site in the app. */}
          <div className="pt-3 mt-2 border-t border-border/40 space-y-2">
            <div>
              <Label className="text-xs">Per-feature model overrides</Label>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Leave blank to use the global model. Most users override
                <span className="font-mono"> scoring</span> and
                <span className="font-mono"> hashtag_analysis</span> with a cheaper
                model and keep the flagship for
                <span className="font-mono"> story_generation</span>.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { key: "story_generation", label: "Story generation",     hint: "Generate-with-AI dialog" },
                { key: "scoring",          label: "Virality scoring",     hint: "Both variant + Reddit-post scorers" },
                { key: "social_copy",      label: "Social copy",          hint: "Captions + hashtags for upload" },
                { key: "hashtag_analysis", label: "Hashtag analysis",     hint: "Hashtag Lab page" },
                { key: "comment_reply",    label: "Comment replies",      hint: "YouTube comment replier" },
                { key: "niche_finder",     label: "Niche finder",         hint: "Channel-niche brainstorm" },
                { key: "dialogue",         label: "Dialogue mode",        hint: "Two-character scripts" },
              ].map(({ key, label, hint }) => (
                <div key={key} className="space-y-0.5">
                  <Label className="text-[10px] text-muted-foreground">{label}</Label>
                  <Input
                    value={featureModels[key] ?? ""}
                    onChange={(e) => setFeatureModels((m) => ({ ...m, [key]: e.target.value }))}
                    placeholder={`(default: ${geminiModel})`}
                    className="h-7 text-[11px] font-mono bg-secondary border-border"
                  />
                  <p className="text-[9px] text-muted-foreground/70">{hint}</p>
                </div>
              ))}
            </div>
          </div>
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

          <Section title="Workspace backup" icon={<Save className="h-4 w-4 text-primary" />}>
            <p className="text-[10px] text-muted-foreground leading-snug">
              One-click backup of every config, brand profile, queue state, music
              metadata, and per-post social copy. Audio / video / backgrounds are
              excluded — they're large and regenerable.
              Restore on a new machine: install the suite, click Import, restart the server.
            </p>
            <WorkspaceBackupPanel />
          </Section>

          <Section title="Pipeline Steps" icon={<Settings2 className="h-4 w-4 text-primary" />}>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Skip optional steps on every render. Saves wall time +
              token spend for users who don't need them. Affects all
              renders globally — per-run overrides aren't yet exposed.
            </p>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs text-muted-foreground">Skip thumbnail generation</label>
                <p className="text-[10px] text-muted-foreground/70 leading-snug">
                  ~5–15 s/render of PIL composition. Skip if you don't upload to YouTube.
                </p>
              </div>
              <Switch checked={skipThumbnail} onCheckedChange={setSkipThumbnail} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs text-muted-foreground">Skip Discord notify</label>
                <p className="text-[10px] text-muted-foreground/70 leading-snug">
                  Bypass the notify step entirely. (You can also leave the webhook blank.)
                </p>
              </div>
              <Switch checked={skipNotify} onCheckedChange={setSkipNotify} />
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

      {/* Floating save bar — sits above the 32px system status bar. */}
      <div className="sticky bottom-12 flex justify-end items-center gap-3 z-30">
        {isDirty && (
          <span className="text-[11px] text-warning bg-warning/10 border border-warning/40 rounded-full px-3 py-1 shadow">
            Unsaved changes
          </span>
        )}
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          size="lg"
          className={`gap-2 shadow-xl ${isDirty ? "glow-primary" : ""}`}
        >
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Configuration
        </Button>
      </div>
    </motion.div>
  );
}
