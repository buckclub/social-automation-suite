/**
 * Reels Automation - API client
 * Author: Faheem Alvi <faheemalvi2000@gmail.com>
 * GitHub: https://github.com/FaheemAlvii
 * License: CC BY-NC 4.0
 */
// Use the current page's origin so `localhost:8000`, `127.0.0.1:8000`, LAN IPs,
// etc. all hit the backend without triggering CORS preflights. Override with
// VITE_API_URL for dev setups where the Vite dev server runs on a different
// port than the backend.
const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `API error ${res.status}`);
  }
  return res.json();
}

// ── Types ───────────────────────────────────────────────────────────

export interface PipelineSubStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail?: string;
}

export interface PipelineStep {
  id: string;
  title: string;
  status: "idle" | "running" | "done" | "error";
  detail: string;
  sub_steps?: PipelineSubStep[];
  started_at?: string | null;
  finished_at?: string | null;
}

export interface PipelineState {
  steps: PipelineStep[];
  is_running: boolean;
  current_post: {
    id: string;
    title: string;
    subreddit: string;
    score: number;
  } | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  num_comments: number;
  selftext: string;
  url: string;
  permalink: string;
  age_hours: number;
  over_18: boolean;
  meets_filters: boolean;
  filter_reason: string | null;
  already_used: boolean;
  viral_score?: number;
  est_duration_s?: number;
  word_count?: number;
  title_dupe_of?: string | null;
}

export interface VideoRecord {
  id: string;
  title: string;
  subreddit: string;
  score: number;
  num_comments: number;
  status: string;
  created_at: string;
  has_video: boolean;
  has_audio: boolean;
  render_time_s?: number;
  parts?: number;
  file_size_bytes?: number;
  part_files?: string[];
  has_thumbnails?: boolean;
}

export interface Stats {
  videos_today: number;
  posts_scanned: number;
  avg_render_time_s: number;
  success_rate: number;
  total_runs: number;
}

export interface TtsProviderStatus {
  installed: boolean;
  repo_cloned?: boolean;
  model_downloaded?: boolean;
  python_deps?: boolean;
  details: string;
}

export interface TtsVoiceDetail {
  id: string;
  name: string;
  lang: string;
  gender: string;
  has_bgm: boolean;
  type: "wav" | "streaming";
  file: string;
}

export interface TtsModelOption {
  id: string;
  name: string;
  description: string;
  size: string;
}

export interface TtsProvider extends TtsProviderStatus {
  id: string;
  name: string;
  type: "cloud" | "local";
  voices: string[];
  voices_detailed?: TtsVoiceDetail[];
  models?: TtsModelOption[];
  models_downloaded?: string[];
}

export interface SocialCopy {
  exists: boolean;
  generated_at?: string;
  provider?: string;
  model?: string;
  source_title?: string;
  subreddit?: string;
  youtube?: { titles?: string[]; description?: string; tags?: string[] };
  tiktok?: { caption?: string; hashtags?: string[] };
  instagram?: { caption?: string; hashtags?: string[] };
  benchmarks_used?: Array<{
    title: string;
    channel: string;
    view_count: number;
    video_id: string;
  }>;
}

export interface QueueItem {
  queue_id: string;
  post_id: string;
  title: string;
  subreddit: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  added_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  params: Record<string, unknown>;
}

export interface AiScore {
  score: number;                       // 0-100 overall
  hook_strength: number | null;        // 0-100
  payoff_strength: number | null;      // 0-100
  emotion: string | null;              // e.g. "outrage", "schadenfreude"
  target_audience: string | null;      // e.g. "women 25-34"
  recommended_mode: string | null;     // story | qa | hottake | interactive
  suggested_hook: string | null;       // opening line suggestion
  pitfalls: string[];                  // short risk tags
  content_warnings: string[];          // e.g. ["violence"]
  narrator_gender: "male" | "female" | null;   // first-person narrator gender
  reason: string;                      // one-line verdict
  source: string;                      // "gemini" | "openrouter" | "ollama" | "nvidia_nim" | "heuristic"
}

export interface FullConfig {
  subreddits: string[];
  request_delay: number;
  filters: {
    min_upvotes: number;
    min_comments: number;
    max_comments: number;
    min_age_hours: number;
    max_age_hours: number;
    allow_nsfw: boolean;
    require_selftext: boolean;
  };
  formatting: {
    default_mode: string;
    max_comments: number;
    min_comment_score: number;
  };
  tts: {
    enabled: boolean;
    provider: string;
    model_size: string;
    main_voice: string;
    use_multiple_voices: boolean;
    comment_voices: string[];
    output_format: string;
    speed: number;
  };
  video: {
    mode: string;
    hw_accel: string;
    use_gpu: boolean;
    auto_cleanup: boolean;
    threads: number;
    engine: string;
    split_duration: number;
    outro_text: string;
    branding: string;
  };
  output: {
    posts_directory: string;
    used_posts_file: string;
  };
  discord: {
    enabled: boolean;
    webhook_url: string;
    upload_media: boolean;
  };
  captions?: {
    enabled: boolean;
    font_path: string;
    font_size: number;
    color: string;
    stroke_color: string;
    stroke_width: number;
    bg_color: string | null;
    bg_opacity: number;
    padding: number;
    corner_radius: number;
    max_width_pct: number;
    position: "center" | "bottom" | "top";
    position_offset: number;
    words_per_caption: number;
    uppercase: boolean;
    attribution: boolean;
    animation: "none" | "fade" | "pop" | "fade_pop";
    animation_duration: number;
    pop_overshoot: number;
    pop_start_scale: number;
    force_align?: boolean;
    align_model_size?: string;
    highlight_word?: boolean;
    highlight_color?: string;
    highlight_scale?: number;
    highlight_stroke_color?: string;
  };
  [key: string]: unknown;
}

// ── API Functions ───────────────────────────────────────────────────

export const api = {
  // Health
  health: () => request<{ status: string }>("/api/health"),

  // System fonts
  listFonts: () => request<{ fonts: { family: string; style: string; file: string; path: string }[] }>("/api/fonts"),

  // Narrator gender detection
  getNarratorGender: (postId: string) =>
    request<{ detected: "male" | "female" | null; title?: string }>(`/api/posts/${postId}/narrator-gender`),

  // Destructive maintenance
  clearAllData: (body: {
    posts?: boolean;
    videos?: boolean;
    history?: boolean;
    registry?: boolean;
    confirm: "DELETE";
  }) =>
    request<{ success: boolean; removed_paths: string[]; errors: string[] }>(
      "/api/maintenance/clear-all",
      { method: "POST", body: JSON.stringify(body) }
    ),

  // AI virality scorer
  scoreViralBatch: (posts: { id: string; title: string; selftext?: string; subreddit?: string; score?: number; num_comments?: number }[]) =>
    request<{ scores: Record<string, AiScore> }>("/api/posts/score-viral", {
      method: "POST",
      body: JSON.stringify({ posts }),
    }),

  // Social copy (YouTube / TikTok / Instagram)
  getSocialCopy: (postId: string) =>
    request<SocialCopy>(`/api/posts/${postId}/social`),
  generateSocialCopy: (postId: string) =>
    request<SocialCopy>(`/api/posts/${postId}/generate-social`, { method: "POST" }),

  // Publishing — YouTube
  youtubeStatus: () =>
    request<{
      has_credentials: boolean;
      connected: boolean;
      channel_title: string;
      channel_id: string;
      custom_url: string;
    }>("/api/publish/youtube/status"),
  youtubeSaveCredentials: (client_id: string, client_secret: string) =>
    request<{ saved: boolean }>("/api/publish/youtube/credentials", {
      method: "POST",
      body: JSON.stringify({ client_id, client_secret }),
    }),
  youtubeOauthStart: (host: string) =>
    request<{ auth_url: string }>(`/api/publish/youtube/oauth/start?host=${encodeURIComponent(host)}`),
  youtubeDisconnect: () =>
    request<{ disconnected: boolean }>("/api/publish/youtube/disconnect", { method: "POST" }),
  youtubeQuota: () =>
    request<{
      today: string;
      daily_limit: number;
      used_today: number;
      remaining: number;
      pct_used: number;
      events_today: Record<string, number>;
      history: { date: string; total: number }[];
      reset_at: string;
      seconds_until_reset: number;
    }>("/api/publish/youtube/quota"),
  youtubeQuotaSetLimit: (limit: number) =>
    request<{ saved: boolean; limit: number }>("/api/publish/youtube/quota/limit", {
      method: "POST",
      body: JSON.stringify({ limit }),
    }),
  youtubeQuotaReset: () =>
    request<{ reset: boolean }>("/api/publish/youtube/quota/reset", { method: "POST" }),
  youtubeUpload: (body: {
    video_id: string;
    part_index?: number;
    title?: string;
    description?: string;
    tags?: string[];
    privacy?: "public" | "unlisted" | "private";
    publish_at?: string;
  }) =>
    request<{
      success: boolean;
      video_id: string;
      url: string;
      privacy: string;
      publish_at: string | null;
    }>("/api/publish/youtube/upload", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ElevenLabs voices (live, authenticated via server-side config.api_key)
  listElevenLabsVoices: () =>
    request<{
      voices: { voice_id: string; name: string; category?: string; description?: string; labels?: Record<string, string>; preview_url?: string }[];
      error?: string;
    }>("/api/tts/elevenlabs/voices"),

  // Backgrounds library
  listBackgrounds: (path = "") =>
    request<{
      path: string;
      parent: string | null;
      folders: { name: string; path: string; video_count: number }[];
      videos:  { name: string; path: string; size: number; mtime: string }[];
    }>(`/api/backgrounds?path=${encodeURIComponent(path)}`),
  listBackgroundFolders: () =>
    request<{ folders: { path: string; name: string; video_count: number }[] }>(
      "/api/backgrounds/all-folders",
    ),
  uploadBackground: (file: File, folder = "", onProgress?: (pct: number) => void) =>
    new Promise<{ saved: boolean; path: string; size: number }>((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      if (folder) form.append("folder", folder);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/backgrounds/upload`);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("Bad upload response")); }
        } else {
          try {
            const j = JSON.parse(xhr.responseText);
            reject(new Error(j.detail || xhr.statusText));
          } catch {
            reject(new Error(xhr.statusText || "Upload failed"));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(form);
    }),
  deleteBackground: (path: string) =>
    request<{ deleted: boolean; path: string }>(
      `/api/backgrounds?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    ),
  createBackgroundFolder: (path: string) =>
    request<{ created: boolean; path: string }>("/api/backgrounds/folders", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  deleteBackgroundFolder: (path: string, recursive = false) =>
    request<{ deleted: boolean; path: string }>(
      `/api/backgrounds/folders?path=${encodeURIComponent(path)}&recursive=${recursive ? "true" : "false"}`,
      { method: "DELETE" },
    ),
  backgroundPreviewUrl: (path: string) =>
    `${API_BASE}/api/backgrounds/preview?path=${encodeURIComponent(path)}`,
  moveBackground: (src_path: string, dest_folder: string) =>
    request<{ moved: boolean; path: string }>("/api/backgrounds/move", {
      method: "POST",
      body: JSON.stringify({ src_path, dest_folder }),
    }),

  // Branding / title-card profile pic
  uploadProfilePic: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE}/api/branding/profile-pic`, {
      method: "POST",
      body: form,
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      return r.json() as Promise<{ saved: boolean; path: string; size_bytes: number }>;
    });
  },
  clearProfilePic: () =>
    request<{ cleared: boolean }>("/api/branding/profile-pic", { method: "DELETE" }),
  profilePicUrl: () => `${API_BASE}/api/branding/profile-pic?v=${Date.now()}`,

  // Run queue
  getQueue: () =>
    request<{
      paused: boolean;
      history_cap: number;
      items: QueueItem[];
    }>("/api/pipeline/queue"),
  queueAdd: (body: { post_id: string; title?: string; subreddit?: string; params?: Record<string, unknown> }) =>
    request<{ queued: boolean; item: QueueItem }>("/api/pipeline/queue/add", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  queueAddMany: (items: { post_id: string; title?: string; subreddit?: string; params?: Record<string, unknown> }[]) =>
    request<{ queued: number; items: QueueItem[] }>("/api/pipeline/queue/add-many", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  queueRemove: (queue_id: string) =>
    request<{ removed: boolean }>(`/api/pipeline/queue/${queue_id}`, { method: "DELETE" }),
  queueRetry: (queue_id: string) =>
    request<{ requeued: boolean; item: QueueItem }>(`/api/pipeline/queue/${queue_id}/retry`, { method: "POST" }),
  queueMove: (queue_id: string, direction: -1 | 1) =>
    request<{ moved: boolean }>(`/api/pipeline/queue/${queue_id}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    }),
  queuePause:        () => request<{ paused: boolean }>("/api/pipeline/queue/pause",   { method: "POST" }),
  queueResume:       () => request<{ paused: boolean }>("/api/pipeline/queue/resume",  { method: "POST" }),
  queueClearHistory: () => request<{ dropped: number }>("/api/pipeline/queue/clear-history", { method: "POST" }),

  // Cost tracker (TTS + AI provider usage)
  getCostSummary: () =>
    request<{
      today: Record<string, Record<string, number>>;
      month: Record<string, Record<string, number>>;
      series_30d: { date: string; chars: number }[];
    }>("/api/cost/summary"),
  getElevenLabsBalance: () =>
    request<{
      available: boolean;
      reason?: string;
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
      tier?: string;
    }>("/api/cost/elevenlabs-balance"),

  // Render history (for Dashboard chart)
  getRenderHistory: (days = 30) =>
    request<{
      series: { date: string; renders: number; successes: number; failures: number; total_time_s: number; resumes: number }[];
      days_covered: number;
      totals: { renders: number; successes: number; failures: number; success_rate: number; avg_render_s: number };
      today: { renders: number; successes: number; failures: number };
    }>(`/api/render-history?days=${days}`),

  // System status (for the bottom status bar)
  getSystemStatus: () =>
    request<{
      ollama_reachable: boolean;
      ollama_detail: string;
      ollama_url: string;
      disk_free_gb: number | null;
      videos_dir_gb: number | null;
    }>("/api/system/status"),

  // Config — full config.json
  getConfig: () => request<FullConfig>("/api/config"),
  updateConfig: (update: Record<string, unknown>) =>
    request<{ success: boolean; config: FullConfig }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(update),
    }),

  // Posts
  discoverPosts: (sort: string = "hot") =>
    request<{ posts: RedditPost[]; total: number }>(`/api/posts/discover?sort=${sort}`),

  // Fetch comments for selection
  fetchPostComments: (params: { url?: string; post_id?: string }) =>
    request<{
      post_id: string;
      title: string;
      comments: Array<{ index: number; author: string; body: string; score: number; char_count: number }>;
    }>("/api/posts/comments", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Generate from URL
  runPipelineFromUrl: (params: {
    url: string; video_mode: string; format_mode: string; tts_enabled: boolean;
    selected_comments?: number[]; max_comment_chars?: number;
  }) =>
    request<{ started: boolean }>("/api/pipeline/run-url", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Pipeline
  getPipelineStatus: () => request<PipelineState>("/api/pipeline/status"),
  runPipeline: (params?: {
    post_id?: string;
    selected_comments?: number[];
    max_comment_chars?: number;
    narrator_gender?: "auto" | "male" | "female";
    voice_override?: string;
    fresh?: boolean;
  }) =>
    request<{ started: boolean }>("/api/pipeline/run", {
      method: "POST",
      body: JSON.stringify(params || {}),
    }),
  resetPipeline: () =>
    request<{ success: boolean }>("/api/pipeline/reset", { method: "POST" }),
  cancelPipeline: () =>
    request<{ success: boolean }>("/api/pipeline/cancel", { method: "POST" }),

  // Custom content pipeline
  runPipelineCustom: (params: {
    title: string; content: string; format_mode: string;
    video_mode: string; tts_enabled: boolean;
    comments?: Array<{ author: string; body: string }>;
  }) =>
    request<{ started: boolean }>("/api/pipeline/run-custom", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Videos
  getVideos: () => request<{ videos: VideoRecord[] }>("/api/videos"),

  // Stats
  getStats: () => request<Stats>("/api/stats"),

  // Used posts
  getUsedPosts: () => request<{ used_posts: string[] }>("/api/used-posts"),

  // Logs
  getLogs: () => request<{ logs: string[] }>("/api/logs"),

  // Video actions
  deleteVideo: (id: string, opts?: { keep_files?: boolean }) =>
    request<{ success: boolean; files_deleted?: number; paths?: string[] }>(
      `/api/videos/${id}${opts?.keep_files ? "?keep_files=true" : ""}`,
      { method: "DELETE" }
    ),

  // TTS Provider management
  getTtsProviders: () =>
    request<{ providers: TtsProvider[] }>("/api/tts/providers"),
  checkTtsProvider: (providerId: string) =>
    request<TtsProviderStatus>(`/api/tts/check/${providerId}`),
  installTtsProvider: (providerId: string) =>
    request<{ success: boolean; steps: unknown[]; error?: string }>(`/api/tts/install/${providerId}`, {
      method: "POST",
    }),

  // AI test
  testAiModel: (params: { provider: string; model: string; api_key: string; ollama_url?: string }) =>
    request<{ success: boolean; response: string }>("/api/ai/test", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // AI content generation pipeline
  runPipelineAI: (params: {
    content_style: string; niche: string; custom_topic?: string;
    interactive_format?: string; video_mode: string; tts_enabled: boolean;
  }) =>
    request<{ started: boolean }>("/api/pipeline/run-ai", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Resume video from audio-only post
  resumeVideo: (post_id: string) =>
    request<{ started: boolean }>("/api/pipeline/resume-video", {
      method: "POST",
      body: JSON.stringify({ post_id }),
    }),
};
