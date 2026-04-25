# Social Automation Suite

End-to-end short-form content automation. What started as a Reddit-to-Reels pipeline has grown into a full suite for faceless-video operators:

- **Reels** — Reddit posts or AI-generated scripts → vertical 1080×1920 video with TTS narration, word-level captions, optional auto B-roll overlay (Pexels-sourced topic-relevant footage), background music auto-picked by tone, and optional auto-publishing to YouTube Shorts / TikTok / Instagram Reels / Snapchat Spotlight.
- **Brand Profiles** — saved snapshots of every "what this channel looks like" config key (title card, captions, watermark, default voice, BG selector, music tags, auto-broll style). Switch via a header pill before each render — every Generate dialog confirms which brand will style the output, every rendered video is tagged with its brand, and the Videos page filters by brand. Run a multi-channel operation from one install.
- **Dialogue Mode** — AI generates a back-and-forth between two characters (label A / label B with optional personas, 3-10 exchanges, tone + content-filter axes). Speaker labels stay baked into the captions so viewers can follow the conversation. Renders through the existing Custom Script pipeline (one-click "Render now" or queue), inheriting the active brand's voice / captions / title-card / avatar settings.
- **Comment Replier** — pulls top-level YouTube comments from your tracked uploads via the API key, AI drafts replies in the active brand voice (skipping spam/hostile/low-quality automatically), you review + edit + post via OAuth — all from inside the suite. Closes the algorithm-engagement loop without leaving the dashboard.
- **Content Calendar** — schedule Generate-with-AI runs for specific datetimes per brand. A worker fires due slots, auto-switches the active brand, generates one variant, enqueues for render. Replaces the "what's posting tomorrow?" mental ledger when running multiple channels.
- **Smart Performance Diagnoses** — Performance page gets an LLM-powered "Diagnose" button that compares your top-5 vs bottom-5 vs by-brand averages and surfaces specific patterns (wins / losses / next-5 pitches) with evidence quotes from your actual titles.
- **Caption styles: karaoke fill + boxed word** — two new FFmpeg-engine-compatible animation modes. Karaoke fill cumulatively colours every word at-or-before the active one (karaoke prompter sweep). Boxed word renders every word inside a coloured pill background (active in highlight, inactive at configurable opacity). Both work on top of every existing caption knob (drop shadow, single-line, per-word highlight, etc).
- **Avatar Reels** ("PNG-tuber" mode) — upload a stack of character PNGs (idle / talking variants per emotion) and any rendered reel automatically composites the avatar overlaid above captions. Audio amplitude drives mouth swaps, the LLM tags emotional beats from the script for expression swaps, a sine-wave jiggle livens the talking pose, and a slower idle-breathing motion keeps the character feeling alive when quiet. One avatar per brand profile (snapshots with the rest of the brand). Works on top of any pipeline — Generate-with-AI, Custom Script, Reddit, Clip Maker.
- **Niche Finder** — answers "what channel should I start next?" with real data. Pulls live YouTube `mostPopular` chart for your region + per-keyword top-videos for any seed interests you supply, feeds both into the LLM, and returns ranked niche cards (name, description, channel-name suggestions, first-video pitches, audience, saturation estimate, "why this is trending right now" rationale grounded in specific videos from the trend block). One click turns any niche into a new brand profile.
- **Clip Maker** — long-form YouTube URL or uploaded mp4 → AI-picked Shorts-worthy clips. Event-driven mode detects in-game moments (gunshots, goals, HUD events) in footage without a transcript.
- **Text Posts** — generate tweets, Reddit comments, YouTube / TikTok / Instagram community posts, LinkedIn updates; with brand-voice presets and batch variants.
- **Custom Script** — paste your own narration text → runs through the same TTS + caption + render pipeline with no AI generation step. Single-shot or batch via the run queue.
- **Quote Cards** — single-image quote post for IG / X / Pinterest. Type your own quote OR paste any rendered post's id and the LLM extracts the 5 most-quotable lines for one-click reuse.
- **Performance Analytics** (`/performance`) — pulls live YouTube view / like / comment stats for every upload tracked in the suite. Aggregated totals, top performer, 30-day daily-views sparkline, per-video table.
- **Music Library** (`/music`) — upload royalty-free tracks, tag each with the same tone vocabulary as Generate-with-AI (dramatic / funny / heartfelt / shocking / cringe). Pipeline auto-picks a matching track per render and mixes it under the narration; voice stays at unity, music attenuates per the configured dB.
- **Carousel Posts** — multi-slide square or 4:5 portrait images for IG / TikTok / LinkedIn carousels. Paste a long story, AI splits it into hook + beat slides + CTA, edit per-slide, live-preview at exact output resolution, download all slides as a zip.
- **News Roundup** — pull RSS / Atom feeds (curated picks for tech / news / sports / entertainment / Reddit + custom URL), copy any headline + summary as a one-click prompt for Generate-with-AI.
- **Hashtag Lab** — paste any caption, get 12-20 ranked tag suggestions cross-referenced against top-performing videos in your niche (when a YouTube API key is set). Pick + copy a curated set in one click.
- **Social Copy** — per-video YouTube title/description + unified Reels/TikTok caption with a background batch queue; click "Social copy" on N videos and come back later.

All rendering is local (FFmpeg). Narration uses your choice of ElevenLabs / Streamlabs Polly / LazyPy TikTok / VibeVoice / Qwen3 TTS. Content generation uses your configured LLM (Gemini / OpenRouter / Ollama / Nvidia NIM).

This project is a fork of [FaheemAlvii/reddit-to-reels](https://github.com/FaheemAlvii/reddit-to-reels) — credit for the original Reddit-to-Reels codebase belongs there. See [Fork Additions](#fork-additions) below for the feature work that turned it into the Social Automation Suite.

> **Upstream Notice**
>
> The original repo is **not actively maintained** per its author. This fork has diverged with feature work; the credits and author info at the bottom still apply to the original codebase.

## Fork additions

### TTS

- **ElevenLabs provider** — live voice fetching from `/v2/voices` (no stale hardcoded IDs); stability / similarity / style / speaker-boost sliders; model selection (Multilingual v2 / Turbo v2.5 / Monolingual v1); configs that stored a name instead of a voice_id self-heal on next run. Includes a 21-voice ElevenLabs library preset list so common voices (Rachel, Adam, Bella, Brian, etc.) are always pickable even when the API hasn't been queried yet.
- **Native per-word timestamps from ElevenLabs** — synthesis goes through the `/v1/text-to-speech/{voice_id}/with-timestamps` endpoint, which returns the audio PLUS per-character start/end times. We aggregate those into per-word timings and attach them directly to each segment, **skipping the whisper re-alignment step entirely**. Eliminates the chronic caption-sync drift that whisper's listen-back approach produces on short articles, numbers, and unusual names. Prefers `normalized_alignment` over raw so "25M" read aloud as "twenty-five million" stays synced. ~15–30s faster per render on large-v3. Cached as a `<audio>.words.json` sidecar so Re-render / Resume reuse them without re-hitting the API. Graceful fallback to whisper if `/with-timestamps` ever errors on a segment. Toggle off via `tts.elevenlabs.use_native_timestamps: false`.
- **Gendered voice presets** — per-provider male/female defaults in the TTS tab. The Run dialog auto-detects narrator gender from the post title/body (regex on `(M32)` / `28f` / `as a 24F` / `my wife|husband`) and picks the matching preset. Can be overridden per-run.
- **Pre-TTS cleanup with local Ollama** — expands Reddit shorthand (`tho`→`though`, `cuz`→`because`) and fixes typos before sending to paid TTS. Cached per-post. Silently skipped if Ollama is offline.
- **Pre-TTS prefilter** (dedicated module, no LLM call) — expands age/gender tokens (`25M` → "twenty five male", only real ages so `M3` / `F1` don't get mangled), TL;DR → "too long; didn't read", and Reddit-subreddit acronyms (AITA/NTA/YTA/ESH/NAH, MIL/FIL/BIL/SIL/DH/DW). Smart-quotes are normalized to ASCII and `U+FFFD` is stripped so TTS engines don't choke.
- **Playback speed is actually applied now** — the speed slider was cosmetic upstream; I pipe each synthesized clip through FFmpeg `atempo` (handles 0.25×–4× via chaining). Whisper alignment runs on the **pre-stretch** audio and timestamps are scaled by `1/speed` afterwards, which keeps whisper's accuracy (atempo distorts formants enough to degrade alignment) while still matching the final stretched clip.
- **FFmpeg concat filter for clip joining** — replaces MoviePy's `concat_audioclips`, which introduced audible boundary clicks between segments.

### Captions

- **Fully configurable** — font (server-side font picker enumerating installed TTFs), size, color, stroke color/width, uppercase, background box, position (center/top/bottom), offset, max width %, words-per-chunk.
- **Color picker** — native swatch + hex input combo for text, stroke, BG, and highlight colors.
- **Animations** (MoviePy engine): fade, pop, fade+pop with tunable duration, overshoot, start-scale.
- **Whisper forced alignment** — optional local `faster-whisper` (GPU-aware: `cuda` + `float16` when available, else `cpu` + `int8`) produces word-level timestamps so captions snap to the actual spoken words. Cached per audio file (`.whisper_v8.json`). Model is unloaded + CUDA cache flushed before FFmpeg spawns so Windows doesn't hit `WinError 1455` (parent-process paging-file reservation).
- **Hybrid LCS + timing-consistency alignment** — whisper hallucinations (`Subtitled by the Amara.org community`, `CastingWords transcription service`, `Thanks for watching`) are filtered by a deny-list, then the remaining words are matched to the **expected** text via Longest-Common-Subsequence. A timing-consistency filter (speech-rate sanity check) drops outlier anchors so a misplaced word can't freeze a caption for 15 seconds. Captions always render the expected text — never the hallucinated text — even when whisper goes off the rails.
- **Per-word highlight** — current spoken word rendered in a configurable color, optionally scaled up 100–150% for a TikTok-style bounce. Requires alignment.
- **Per-word shrink-to-fit** — if one word would overflow the caption width, just that word is scaled down (baseline-aligned with its neighbors); the rest stay at normal size.
- **Runaway-caption cap** — `max_chunk_duration` prevents a single chunk from staying on screen for 15+ seconds when whisper leaves a gap. `lead_in_grace` covers brief TTS leading silence.
- **"Fit on one line" mode** — captions.single_line toggle. When a chunk doesn't fit at the base font, uniformly scales the whole chunk's font down until it does instead of wrapping. Fixes mid-word breaks like "CAPTION / S".
- **Drop shadow** — toggleable soft gaussian-blurred shadow behind captions (color / opacity / offset X & Y / blur radius). Rendered on a separate layer via `ImageFilter.GaussianBlur`, then alpha-composited under the real text but above the pill box — so offsets larger than the corner radius spill outside the pill for that true mobile-text-sticker look. Canvas auto-pads by `|offset| + 3·blur` so the blur never clips. Works with per-word highlight, stroke, single-line mode, and animations simultaneously. The live caption preview simulates it with a matching CSS `text-shadow` layer so WYSIWYG stays accurate.
- **Reddit vs Clip caption presets** — `captions` and `clip_captions` are independent config keys with their own full settings. A preset switcher at the top of Config → Captions flips which one you're editing; both save together. Clip Maker renders use `clip_captions` (falls back to `captions` when null).
- **Native-timing-aware highlight frames** — when segments carry ElevenLabs `/with-timestamps` data, each per-word highlight frame is anchored to the real `[word.start, next_word.start)` window instead of the char-weight estimate we use for jittery whisper timings. The pre-existing `MIN_FRAME`/`MIN_FINAL` guards were designed to swallow whisper's 40 ms flash frames and were silently deleting legit short-word highlights (a / the / I / to) — they're dropped on native runs so every word reliably highlights.
- **Title card over live background** — during the hook + title TTS segments, the Reddit-style card widget is overlaid on top of the running background video (transparent surrounds, so the background keeps moving). Captions start once the body begins.
- **Live caption preview** — 9:16 mock frame on the Captions tab that reflects every setting in real time, including cycling active-word highlight. Also live-simulates `single_line` mode with a CSS `transform: scale()` that matches what the backend will actually render.

### Post discovery

- **AI virality scorer** — a "Score with AI" button scores up to 40 visible posts 0–100 using your configured LLM (Ollama / Gemini / OpenRouter / NVIDIA NIM). Results cached per-post. New "AI" sort.
- **Virality (upvotes/hour), duration estimate (~155 wpm), per-subreddit cap**, and **fuzzy dedupe** of titles against previously-used posts.
- **Expanded filter bar** — exclude keywords, must-contain, deny-subreddit list, min upvotes, min comments, min viral/hr, max duration, min AI score, hide near-duplicates.
- **Filter presets** — save/load/delete named filter bundles (persisted per browser).

### Clip Maker — turn long-form media into Shorts

- **New top-level `Clip Maker` page** (`/clips`, keyboard `g l`). Paste a YouTube URL or upload an mp4; the app auto-downloads via yt-dlp (with a duration cap at `clipmaker.max_duration_s`, default 1 hour), and pulls English auto-captions when YouTube has them — skipping a whisper pass on the source entirely. Falls back to local faster-whisper transcription when captions are unavailable.
- **AI clip proposals** — the configured LLM reads the transcript with timecodes and returns its top N Shorts-worthy windows with `{start, end, hook_line, reason, score}`. Five modes in the dialog:
  - `ai_only` — transcript → LLM (default)
  - `ai_plus` — transcript + **audio-energy peaks** (RMS over 1s windows, FFmpeg-extracted, no numpy) so laughter / shouting / dramatic beats inform the LLM's picks
  - `ai_visual` — adds **scene cuts** (FFmpeg's `select='gt(scene,0.3)',showinfo` filter, no vision model needed) so the LLM prefers clips that start/end on natural visual cuts
  - `event_driven` — **no transcript, no LLM**. Fuses heuristic detectors (see below) into event peaks and builds pre-roll/post-roll windows around each. Designed for gameplay / sports / dashcam / any footage without narration.
  - `manual` — skip AI, curate yourself
- **Event-driven detection stack** (for `event_driven` mode). All signals fuse into 2 s buckets with per-kind weights; buckets with ≥2 kinds get a 1.3× multi-signal boost.
  - **Audio transients** — RMS spikes *above a rolling-median baseline* (not just the loudest windows). Catches gunshots, horns, hit stingers even on already-loud footage.
  - **Color flash** — 1×1 FFmpeg downscale + luma/chroma delta vs 3-frame median. Catches muzzle flashes, damage overlays (red tint), explosions (white-out), goal-celebration colour bursts.
  - **HUD delta** — scene-change filter restricted to a cropped region. Fires when the kill-feed adds an entry / the scoreboard ticks / the minimap pops — no false positives from in-world scene cuts. A **"Draw on video"** picker lets you drag a rectangle directly on the source player; the overlay auto-pauses the video, crosshair cursor, release commits the fractional `[x1,y1,x2,y2]` region.
  - **YAMNet audio tagger** (Layer 2) — Google's 521-class AudioSet model running in `tflite-runtime` or `tensorflow.lite` (whichever you have — fully optional). Model + label CSV auto-download to `models/` on first use (~15 MB). Preset class packs for `fps` / `sports` / `racing` / `general_action`, plus a custom-classes field for any AudioSet substring (e.g. `Gunshot, gunfire`, `Cheering`, `Whistling`, `Siren`).
  - **Reference-sound template matching** (Layer 3) — upload a short WAV of the *exact* sound you want to catch (goal horn, killstreak jingle, victory sting). Chunked FFT-based normalized cross-correlation at 4 kHz fires wherever NCC ≥ 0.5. Near-perfect recall on specific cues. Managed per-project via a new Upload/List/Delete UI, stored under `clips/<project_id>/refs/`.
  - **Windowing** — every detected event at time `T` becomes a clip window `[T - pre_roll, T + post_roll]` (defaults 15 s / 3 s, adjustable inline). Overlaps > 50 % are deduped keeping the highest-scoring window. Whisper alignment is automatically skipped for event-driven proposals so gameplay footage without narration doesn't get hallucinated "Thanks for watching" captions.
- **Review UI** — embedded source player with the HUD-region picker overlay, clickable transcript cues that seek the player (transcript-based modes), per-proposal cards with score badge + hook line + fired-detector list, inline edit for start/end/title, approve/reject toggle, "Add manual clip @ player time" button, and a **live inline preview** of each rendered clip without opening a tab.
- **Modular render pipeline** on the backend (`clip_pipeline.py`, composed from `pipeline_core`): `SliceSourceStep` (FFmpeg fast-seek + 9:16 crop) → `WhisperAlignClipStep` (word-level timings on the slice) → `RenderClipStep` (captions over original audio, no TTS) → `ClipThumbnailStep` → `PersistStep`. Each clip renders via the shared run queue — clips and Reddit posts drain through the same worker, with `kind: "clip"` discrimination so the Dashboard timeline + status bar show clip renders identically.
- **Independent caption config for clips** — `clip_captions` key mirrors `captions`. A preset switcher at the top of Config → Captions flips which one the controls edit; both save together.
- **Persistent projects** — everything lives under `clips/<project_id>/` (source mp4, `transcript.json`, `project.json`, `renders/`). Comes back exactly where you left it after a server restart.

### Video / backgrounds

- **Backgrounds library page** (new top-level nav entry, also reachable via `g b` or the command palette). A file-browser UI over the `backgrounds/` folder — upload multiple videos via picker or drag-and-drop anywhere on the card, with live per-file progress bars. Create nested folders (e.g. *minecraft-parkour*, *subway-surfers*, *GTA*) to organize footage by theme. Per-video autoplay preview on click, per-folder / per-video delete with a recursive-confirm for non-empty folders. Path-traversal guards on the backend reject anything escaping `backgrounds/`.
- **Default-background selector** (Config → Video). Dropdown lists every subfolder under `backgrounds/` with its video count plus a top-level *"🎲 All backgrounds — random"* option. The pipeline then resolves the `video.background_selector` to: specific file → random within folder (recursive) → random across everything, with safe fallback if a saved selector disappears from disk.
- **Fully customizable title card** with a live mini-preview next to the controls (same pattern as the captions preview). Config → Video → **Title Card** now exposes: circular profile-pic upload (masked onto the card), display handle, hide-stats toggle, 4 color pickers (card background / title text / username text / accent), and 4 dimension sliders (card width % / corner radius / title font size / username font size). Every tweak reflects instantly in the scaled 9:16 mockup, inner padding + avatar radius scale proportionally so the layout stays balanced at any font size, and the backend render reads every value from the `thumbnail` config block — no hard-coded colors or sizes left.

### Publishing / output

- **Social copy generator** — per-video "Social Copy" button generates (a) YouTube Shorts titles (3 variants) + description + tags, and (b) a **single Reels/TikTok caption** used verbatim on both platforms (they share the same descriptive-caption + hashtag-tail format for Reddit-story videos). The LLM picks one of three explicitly named style templates based on the content: **Format A** — run-on story summary with ALL-CAPS emphasis on payoffs; **Format B** — `"only part."` cliffhanger teaser + hook question; **Format C** — punchy single-line hot-take / quoted line. System prompt includes real top-performing examples for each format and enforces a Reddit-TikTok core hashtag tail (≥3 of `#reddit #redditstories #redditstorytime #redditreadings #reddit_tiktok #redd #askreddit`) plus the subreddit tag + algorithmic reach tags + 2-4 topic tags (8-14 total). Saved to `posts/<id>/social.json` with per-field copy buttons; legacy `tiktok`/`instagram` sections from pre-merge saves still render tagged `(legacy)` and prompt a regenerate.
- **Social copy batch queue** — select any number of videos on the Videos page and hit **Social copy** in the selection bar; instead of blocking the browser while each LLM call finishes, the backend enqueues them into a persistent `.cache/social_queue.json` and a dedicated worker drains them one at a time (serial so provider rate limits aren't tripped). A floating **Social Copy** chip in the lower-right corner shows live counts (queued / running / done / failed) and expands into a list with per-row cancel buttons and error text. Already-queued post_ids are deduped on re-submit. Survives server restart via a `running → queued` recovery pass on startup. Each video card shows a ✨ **Social** badge when `social.json` exists on disk, so you can tell at a glance what still needs copy.
- **YouTube benchmarks for social copy** — if a YouTube Data API v3 key is configured, the generator first pulls the top-performing short videos in the same niche (query: `r/<subreddit> reddit stories shorts`) and feeds their titles / descriptions / tags into the prompt as style references. The LLM is instructed to emulate hook phrasing, tag density, and tone **without copying verbatim**. Results cached 24h per query (~110 quota units per fresh fetch, ~90 generations/day on the free tier). The dialog shows the referenced videos with view counts so you can see what inspired the output. Graceful no-op if the key is missing or quota is exhausted.
- **Project registry — fully persistent** — `projects.json` at the repo root now stores every flavor of entry (published, audio-only, fetched, failed), not just successful renders. The in-memory `videos_db` is dumped to disk after **every** mutation (pipeline complete, resume, delete, Full Redo, Clear All). Audio + `timeline.json` are preserved under `videos/proj_<id>/` even when `auto_cleanup` nukes `posts/<id>/`, so the Videos page survives server restarts exactly as you left it — audio-only rows can still be resumed after a reboot.
- **Re-render** — re-runs just the video step using the persisted audio and aligned timeline, so caption/video settings can be tweaked without re-spending TTS credits. Preview URLs include `?v=<mtime>` + no-cache headers so the new render shows immediately.
- **Full Redo dialog** — re-runs the entire pipeline (fetch → TTS → render) for a post. Lets you force a male/female preset or override the voice for this one run without touching your global config. Deletes old audio/video/workspace first and re-marks the post as eligible for discovery. Explicit cost warning since this **does** spend TTS credits.
- **Delete dialog** — two options: "List only" (keeps files) and "Delete files too" (removes the .mp4s, thumbnail, and preserved workspace). Exact-path matching — deleting one video no longer wipes siblings with similar titles.
- **Confirmation popups** on Re-render, Full Redo, Delete, and Clear All — hard to accidentally nuke hours of rendering.
- **Run queue** — stage N posts from the Posts page (`Queue` button on each card), walk away, wake up to N rendered shorts. Background worker drains the queue the moment the pipeline goes idle. Dashboard panel shows current running item with live spinner + elapsed, queued items with up/down/remove, collapsible history with Retry for failures, Pause/Resume toggle. Recovery pass on server start demotes any `running` item that got orphaned by a crash.
- **Resume panel on dashboard** — every post that has preserved TTS audio but no rendered video surfaces in an amber-bordered card with one-click per-item **Resume** + **Resume all N** that sequences through them.
- **Render history chart** replaces the old flat stats cards — Today / Last Nd / Success rate / Avg render time plus a clickable 30-day stacked bar chart (blue=success, red=failure). 7/30/90-day toggle.
- **Cost tracker panel** — live ElevenLabs character balance via their `/v1/user` endpoint (tier badge + next-reset date + traffic-light bar), plus a local ledger tracking AI token usage per provider (gemini / openrouter / ollama / nvidia_nim, approx token in/out via chars÷4), plus a 30-day daily-character sparkline.
- **YouTube publishing + scheduling** — one-click upload to YouTube Shorts from any video card. Built-in scheduled release via YouTube's own `publishAt` field, so your server can be offline when the video actually goes live. Batch upload dialog on the Videos page can stage N videos at staggered release times in a single click (a week of Shorts in 30 seconds). Live quota widget on the Publishing tab shows units used today + "~N uploads left" + per-operation breakdown + 14-day sparkline + editable daily limit for users with a Google quota bump.

### Dev experience

- **Tabbed config page** — sidebar navigation (General / Formatting / TTS / Video / Captions / AI Hooks / Publishing / Output & Discord) with a collapse-to-icons toggle, plus URL-backed tab state so the command palette can deep-link into any section.
- **Command palette (⌘K / Ctrl+K)** — fuzzy-search pages, actions, Config sub-tabs, and the last eight rendered videos by title from anywhere in the app.
- **Persistent status bar** at the bottom of every page — live pipeline status (current step + detail), backend + Ollama health dots, YouTube quota chip, disk-free gauge with current `videos/` footprint. Clickable segments jump to the relevant page.
- **Keyboard shortcuts** — `g h` / `g p` / `g v` / `g c` to navigate, `/` focuses the first search/filter input on the page, `?` opens a cheatsheet modal.
- **Unsaved-changes detection** — the Config page builds a signature of every editable field and compares to the last saved snapshot. Surfaces as an "Unsaved changes" pill next to both save buttons, an amber callout row in the Subreddits section, and a `beforeunload` warning so refresh / tab close doesn't silently discard edits.
- **Videos page batch operations** — checkbox on every card; select any → floating action bar appears with **Select all published**, **Social copy** (batch generate-social), **YouTube (N)** (staggered-schedule dialog), **Delete** (one confirm).
- **Pipeline timeline shows per-step elapsed** that ticks live while running and freezes on done/error.
- **`start.ps1` dev loop** — wraps the server with Ctrl+C-restarts-server behavior (double-tap Ctrl+C within 2s to exit). Also checks whether Ollama is listening on `:11434` at startup and spawns `ollama serve` in a separate window if not — Ollama survives supervisor restarts so you don't reload a 14B model every time you Ctrl+C.
- **`dev_supervisor.py`** — Python supervisor that uses Windows `CREATE_NEW_PROCESS_GROUP` + `CTRL_BREAK_EVENT` so the child uvicorn process actually handles Ctrl+C (upstream's PowerShell loop was no-op on Windows).
- **`run_server.py`** — single-entry dev launcher that mounts the built frontend and runs uvicorn with the backend path correctly resolved.
- **Masked API-key inputs (`<SecretInput>`)** — every API key / webhook URL field (ElevenLabs, Gemini, OpenRouter, NVIDIA NIM, YouTube, Discord) uses CSS text-security + explicit `data-1p-ignore` / `data-lpignore` / `data-bwignore` / `data-form-type="other"` attributes. Chrome / Firefox / 1Password / LastPass / Bitwarden no longer try to save or autofill them as passwords. Each field has a show/hide eye toggle.
- **Origin-aware API base URL** — frontend uses `window.location.origin` so `localhost:8000`, `127.0.0.1:8000`, and LAN IPs all work without cross-origin CORS preflights. Override with `VITE_API_URL` for split-port dev setups.

### Upstream bug fixes shipped

- **`PROJECT_ROOT` off-by-one** — every module in `backend/src/` computed this one `dirname` short of the repo root, which made the stock server silently read a stale `backend/config.json`. Fixed across all 13 modules.
- **Caption overflow on wide fonts** — upstream used a `fontsize * 0.5` estimate for wrap width; display fonts like Gotham Ultra overflowed the frame. Rewrote with `font.getlength()` pixel-accurate wrapping and stroke-aware canvas sizing.
- **Title card appearing too late and then vanishing** — title/hook segments now carry a `segment_role: "title"` tag so the card shows for the whole hook block and captions only engage once the body begins.
- **Delete endpoint substring-match** — previously `if video_id in filename:` deleted all posts with overlapping characters. Replaced with exact-path matching.
- **Caption drift across segment boundaries** — the MP3 header duration reported a longer total than the actual FFmpeg-concatenated output by ~37 ms per segment. Fixed by rescaling per-segment durations to the measured concat duration (`effective_durs`).
- **Video duplicated 3× on Videos page** — `projects.json` + `posts/` scan + loose `videos/*.mp4` could each claim the same render. Scan passes now skip ids already in `videos_db`, and Full Redo deletes old mp4s before re-rendering.
- **Infinite recursion in TTS chunk splitter** — smart-join of orphan punctuation occasionally produced a segment just over `MAX_TEXT_LENGTH`, which re-entered the splitter on the same input. Added `HARD_SPLIT_OVER = MAX_TEXT_LENGTH * 1.5` and a progress guard.
- **Windows `WinError 1455` during render** — faster-whisper large-v3 leaves ~5 GB committed on CUDA. `CreateProcess` on Windows pre-reserves swap equal to parent committed pages, so FFmpeg's concat subprocess failed with "paging file too small". Fix: unload the whisper model + `torch.cuda.empty_cache()` before Step 4.

### Config changes

Copy `config.json.example` to `config.json` on first run. All new keys have defaults.

```jsonc
"reddit":   { "max_per_subreddit_per_run": 10 },
"tts": {
  "speed": 1.0,
  "pre_normalize": true,
  "elevenlabs_api_key": "",
  "elevenlabs_model_id": "eleven_turbo_v2_5",
  "elevenlabs": { "stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": true },
  "voice_presets": {
    "elevenlabs":       { "male": "<voice_id>", "female": "<voice_id>" },
    "streamlabs_polly": { "male": "Brian",      "female": "Joanna" }
  }
},
"captions": {
  "words_per_caption": 3, "uppercase": true, "position": "bottom",
  "animation": "none",
  "force_align": false, "align_model_size": "base",
  "highlight_word": false, "highlight_color": "#FFD93D", "highlight_scale": 1.1,
  "max_chunk_duration": 2.5, "lead_in_grace": 1.0
},
"youtube": { "api_key": "" },   // optional — enables YouTube-benchmark style refs
"video": {                      // new:
  "background_selector": ""     // "" = random across all, "folder/sub" = folder random, "folder/clip.mp4" = exact file
},
"thumbnail": {                  // title-card branding — fully live-previewable in Config → Video
  "profile_pic_path":   "",     // set via the uploader — masked into a circle in the render
  "username":           "",     // "@yourchannel" shown next to the avatar
  "hide_stats":         true,   // default true: drops the fake ♡ / ⤴ bottom bar
  "card_bg_color":      "#FFFFFF",
  "text_color":         "#141414",
  "username_color":     "#1E1E1E",
  "accent_color":       "#FF4500",   // fallback avatar fill + part badge
  "corner_radius":      30,
  "card_max_width_pct": 0.84,
  "title_font_size":    52,
  "username_font_size": 36
},
"publishing": {
  "youtube": {
    "client_id": "",            // OAuth 2.0 Desktop app from Google Cloud
    "client_secret": "",
    "refresh_token": ""         // populated by the panel after Connect
  }
}
```

**Posting to YouTube Shorts:**

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth 2.0 Client ID** → application type **Desktop app** (same project where you enabled the YouTube Data API v3).
2. Paste the `client_id` + `client_secret` into **Config → Publishing → YouTube Shorts**, click **Save credentials**, then **Connect YouTube** — a browser popup opens, you consent, it closes itself, and the panel shows "Connected as @yourchannel".
3. During testing / before Google app verification: add your Gmail address under **Google Auth Platform → Audience → Test users**. Refresh tokens in test mode expire after 7 days.
4. Upload: click the red **YouTube** button on any published video card, edit the title/description/tags (pre-filled from `social.json`), pick **Public / Unlisted / Private** or flip **Release later** and choose a time — scheduled releases fire entirely on YouTube's side, so your machine can be offline.

**How to run (Windows):**

```powershell
# One-time: create venv + install backend deps
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
pnpm install
pnpm build
Copy-Item config.json.example config.json

# Daily dev loop (Ctrl+C restarts, Ctrl+C x2 exits)
.\start.ps1
```

Open http://localhost:8000.

### Windows: pagefile note for `whisper large-v3`

If you use `faster-whisper` with the `large-v3` or `distil-large-v3` model on Windows and see `[WinError 1455] The paging file is too small for this operation to complete` when FFmpeg spawns, set your pagefile to system-managed (or at least 16–32 GB fixed) and reboot. Root cause: Windows' `CreateProcess` pre-commits swap equal to the parent process's committed pages, and the whisper CUDA arena bloats Python enough to trip tiny pagefiles. The code also proactively unloads the whisper model before the render step — the pagefile tweak is belt-and-suspenders.

```powershell
# Run elevated
wmic computersystem set AutomaticManagedPagefile=True
# Then reboot.
```

---

## Upstream documentation

> **Maintenance Notice**
>
> This repository is **not actively maintained**. It works at the time of writing and may receive occasional updates when time permits. Pull requests are welcome but reviews can be slow. For paid features or guaranteed support see the contact section below.

## What it does

Social Automation Suite fetches content from Reddit or generates original scripts with a configured LLM, converts the text to speech, and renders vertical 1080×1920 shorts with word-level captions over a background clip. Beyond the Reddit-reels pipeline, it ships a **Clip Maker** (long-form → Shorts with AI / heuristic / event-driven proposal modes), a **Text Posts** page (tweets / comments / community posts / LinkedIn, with brand-voice presets and variant batches), a **background Social Copy queue** (YouTube + unified Reels/TikTok caption generated for N videos at once), and auto-publishing to YouTube Shorts with scheduled release. It includes a web dashboard, a CLI for terminals (including A-Shell on iOS), and a desktop build for Windows.

## Features

Real, in code features. No filler.

* Fetch Reddit posts from configured subreddits with filters for length, score, and age.
* AI content generation in four styles: Story, Q&A, Interactive "put a finger down", and Hot Take. Each run is shaped by an orthogonal **content filter** (Safe / Normal / Edgy), **tone** (Dramatic / Funny / Heartfelt / Shocking / Cringe), and free-text **target audience** (e.g. "women 18-35", "teenagers").
* Save any style + niche + filter + tone + audience combo as a named **preset** for one-click reuse. Every Generate-with-AI run goes through a **Script Review** screen — you read the candidate(s), regenerate the ones you don't like (per-card 🔄 or "Regenerate all"), and approve before anything renders. Pick 1, 2, 3 or 5 candidates per click; if you approve a single one it fires the pipeline immediately, if you tick multiple it queues each as its own run on the existing run queue (drains serially through the same worker that handles Reddit posts).
* **Text Posts** page for generating tweets, X threads, Reddit comments/posts, YouTube community posts, LinkedIn/Facebook/Instagram/TikTok posts, and long-form openers — 11 built-in formats with platform-aware character limits. Same filter/tone/audience axes as the video pipeline. Ground posts in real sources by pasting text or fetching a URL. Save reusable **brand voices** (your persona, recurring bits, words to avoid) for one-click consistency across runs. Generate 3 variants at once, rewrite any draft with a feedback instruction ("punchier hook", "drop the hashtags"), and visualize X threads as individual tweet-shaped cards with per-post character counts.
* Multiple AI providers: Google Gemini, OpenRouter, Ollama (local and cloud), and Nvidia NIM.
* Handles Ollama reasoning models that return answers in the `thinking` field.
* TTS via Streamlabs Polly (cloud, free) or VibeVoice (local).
* Two video engines: FFmpeg (lightweight, works on iOS A-Shell) and MoviePy (full Python).
* Blank color background fallback when no background videos are present.
* Thumbnail generation for each video.
* Optional publishing to YouTube Shorts, TikTok, Instagram Reels, Snapchat Spotlight (implementation present, not end to end tested).
* Discord webhook notifications for run status.
* Web dashboard built with React, Vite, Tailwind, and shadcn/ui.
* CLI / TUI entry point for terminals and iOS A-Shell.
* Single file desktop EXE build using PyInstaller and PyWebView.
* Autonomous bot mode that rotates through channel configs.
* Resume from audio: re-render the video step from existing audio files when rendering fails.
* 7 step pipeline tracking in the UI: AI Generate, Fetch, Format, TTS, Video, Thumbnail, Notify.

## Publishing Status

| Platform                   | Status                                              |
| -------------------------- | --------------------------------------------------- |
| Local file output (MP4)    | Tested, works                                       |
| Discord webhook            | Tested, works                                       |
| YouTube Shorts             | Implemented, **not end to end tested by author**    |
| TikTok                     | Implemented, **not end to end tested by author**    |
| Instagram Reels            | Implemented, **not end to end tested by author**    |
| Snapchat Spotlight         | Implemented, **not end to end tested by author**    |

If you successfully use any publisher, a confirmation in an issue or PR is appreciated.

## Tech Stack

* Frontend: React 18, Vite 5, TypeScript 5, Tailwind CSS 3, shadcn/ui, TanStack Query.
* Backend: Python 3.11, FastAPI, Uvicorn.
* Media: FFmpeg, optional MoviePy and Pillow.
* AI: Google Gemini, OpenRouter, Ollama, Nvidia NIM.
* TTS: Streamlabs Polly, VibeVoice.

## Quick Start (Local Dev)

Install Node 20, pnpm, Python 3.11, and FFmpeg.

```bash
# Frontend
pnpm install
pnpm dev

# Backend (in a second terminal)
python3.11 -m venv .venv
source .venv/bin/activate            # Windows: .\.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn api_server:app --app-dir backend/src --reload --port 8000
```

Open `http://localhost:8080` for the dashboard. The API runs on `http://localhost:8000`.

## Self Hosting with Docker

The included `Dockerfile` builds the frontend, copies it into a Python 3.11 image with FFmpeg, and serves both from one container on port 8000.

```bash
# Optional: create config files first (copy from examples)
cp config.json.example config.json
cp channels.json.example channels.json

# Build and run
docker compose up -d --build
```

The dashboard is then available at `http://localhost:8000`.

### Volumes

`docker-compose.yml` mounts these directories so data survives container rebuilds:

| Host path           | Container path        | Purpose                                  |
| ------------------- | --------------------- | ---------------------------------------- |
| `./posts`           | `/app/posts`          | Generated posts, audio, summaries        |
| `./videos`          | `/app/videos`         | Final rendered MP4 files                 |
| `./backgrounds`     | `/app/backgrounds`    | Background MP4 clips for video rendering |
| `./audio`           | `/app/audio`          | Audio scratch space                      |
| `./config.json`     | `/app/config.json`    | AI providers, TTS, publishers           |
| `./channels.json`   | `/app/channels.json`  | Bot channel rotation config              |

## Self Hosting Manual (No Docker)

```bash
pnpm install
pnpm build
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Serve the built frontend and the API together
uvicorn api_server:app --app-dir backend/src --host 0.0.0.0 --port 8000
```

Place your `config.json` and `channels.json` at the project root and put background videos in `backgrounds/`.

## Configuration Guide

This section explains every important setting in plain English. Configure either through the web dashboard at `/config` or by editing `config.json` directly.

### Settings Quick Reference

| Setting                       | What it does                                        | Default            |
| ----------------------------- | --------------------------------------------------- | ------------------ |
| `ai_provider`                 | Which AI to use for content generation              | `gemini`           |
| `formatting.default_mode`     | Story style: `story`, `qa`, `interactive`, `hottake`| `story`            |
| `formatting.default_niche`    | Topic category for AI generation                    | `relationship_drama` |
| `tts_engine`                  | Voice synthesis backend                             | `streamlabs`       |
| `tts_voice`                   | Streamlabs Polly voice name                         | `Matthew`          |
| `video.engine`                | `ffmpeg` (light) or `moviepy` (full Python)         | `ffmpeg`           |
| `video.split_duration`        | Seconds per part when splitting long videos         | `60`               |
| `reddit.min_score`            | Minimum upvotes to consider a Reddit post           | `100`              |
| `bot.posting_interval_minutes`| Minutes between bot runs                            | `60`               |

### Content Modes

Set `formatting.default_mode` (or pick in the AI Generation dialog) to control the style of generated scripts.

**`story`** — A narrated first person Reddit style story. Best for r/AmITheAsshole, r/relationships, r/MaliciousCompliance type content.
> "So this happened last week. My sister in law showed up to my wedding wearing a white dress..."

**`qa`** — A short host question followed by a punchy answer. Best for r/AskReddit style hooks.
> "What is the most expensive mistake you ever made? Mine was clicking 'reply all' on a 12,000 person email chain..."

**`interactive`** — "Put a finger down" challenge format. Hooks viewers by asking them to play along.
> "Put a finger down if you have ever pretended to text someone to avoid a conversation. Put another finger down if..."

**`hottake`** — Opinionated short rant, controversial take, or unpopular opinion. High engagement bait.
> "Pineapple on pizza is not the problem. The problem is people who put it on with ham and call it Hawaiian when..."

### AI Providers

| Provider     | Type   | Cost                | Speed    | Recommended models                          |
| ------------ | ------ | ------------------- | -------- | ------------------------------------------- |
| Gemini       | Cloud  | Free tier generous  | Fast     | `gemini-2.0-flash`, `gemini-1.5-flash`      |
| OpenRouter   | Cloud  | Pay per token       | Fast     | `meta-llama/llama-3.3-70b-instruct`         |
| Ollama       | Local or cloud | Free local / paid cloud | Varies | `llama3.1:8b`, `kimi-k2.5:cloud`, `deepseek-r1` |
| Nvidia NIM   | Cloud  | Free tier available | Fast     | `meta/llama-3.3-70b-instruct`               |

Reasoning models like `deepseek-r1` and `kimi-k2.5` return answers in a separate `thinking` field. The engine handles this automatically.

### Niches

`formatting.default_niche` picks the topic the AI generates around. Built in options:

* `relationship_drama` — Couple fights, dating disasters, in law conflicts.
* `family_secrets` — Hidden adoptions, infidelity reveals, inheritance feuds.
* `workplace_chaos` — Bad bosses, coworker drama, malicious compliance.
* `childhood_nostalgia` — 90s and 2000s memories, school stories.
* `revenge_stories` — Petty and pro revenge tales.
* `wedding_disasters` — Bridezillas, wedding crashers, mother in law drama.
* `school_memories` — Teacher stories, prank wars, awkward moments.
* `roommate_horror` — Bad roommates, lease nightmares.
* `dating_apps` — Tinder fails, ghosting stories, first date disasters.
* `customer_service` — Karens, retail wars, restaurant horror.

### TTS Engines

**Streamlabs Polly (cloud, free)** — Default. No setup, no API key. Voices include:

`Matthew`, `Brian`, `Joanna`, `Salli`, `Joey`, `Justin`, `Kendra`, `Kimberly`, `Ivy`, `Amy`, `Emma`, `Russell`, `Nicole`.

**VibeVoice (local)** — Runs on your machine, no internet required, no per request cost. Heavier setup, requires GPU for reasonable speed. Does not work on iOS A-Shell.

Set `tts_engine` to `streamlabs` or `vibevoice` and `tts_voice` to your chosen voice.

### Video Settings

* `video.engine` — `ffmpeg` is fast, low memory, works on iOS A-Shell. `moviepy` is full Python, more flexible but heavier.
* `video.split_duration` — Long scripts are split into N second parts. Default 60 seconds matches Shorts and Reels.
* `video.mode` — `single` keeps everything in one file. `split` breaks it into parts.
* `video.branding` — Optional intro / outro overlay text or watermark.
* `video.auto_cleanup` — When true, removes intermediate audio and frames after rendering succeeds.

### Reddit Filters

Configured under `reddit` in `config.json`:

* `subreddits` — List of subreddit names to fetch from.
* `min_score` — Skip posts below this upvote count.
* `max_age_days` — Skip posts older than N days.
* `min_length` / `max_length` — Character limits on the post body.
* `nsfw` — Include or exclude NSFW posts.

### Publishing

All publishing modules are implemented but **not end to end tested by the author**. Expect to debug auth, scopes, or upload edge cases.

* **YouTube Shorts** — Requires Google Cloud OAuth 2.0 credentials. See `backend/src/youtube_publisher.py` and the [YouTube Data API v3 docs](https://developers.google.com/youtube/v3).
* **TikTok** — Requires a TikTok Developer App approved for the Content Posting API. See [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-get-started).
* **Instagram Reels** — Requires a Facebook App with `instagram_content_publish` permission and a Business or Creator account. See [Instagram Graph API](https://developers.facebook.com/docs/instagram-api).
* **Snapchat Spotlight** — Requires Snap Kit approval. See [Snap Marketing API](https://developers.snap.com/api/marketing-api/Spotlight).

Credentials for each platform go in `channels.json` per channel.

### Discord Notifications

Set `discord_webhook_url` to a webhook URL from any Discord channel (Server Settings, Integrations, Webhooks). The engine posts run start, success, and failure messages there.

### Bot Mode

The autonomous bot rotates through channels in `channels.json`.

* `bot.posting_interval_minutes` — How often the bot wakes up and tries to post.
* `bot.max_posts_per_day` — Hard daily cap across all channels.
* `bot.channels` — Each channel has its own subreddits, AI prompt, TTS voice, and publishing targets.

### Annotated example `config.json`

```jsonc
{
  // Pick one: gemini, openrouter, ollama, nvidia_nim
  "ai_provider": "gemini",
  "gemini_api_key": "AIza...",
  "openrouter_api_key": "",
  "nvidia_nim_api_key": "",

  // Ollama: local URL or https://ollama.com for cloud
  "ollama_url": "http://localhost:11434",
  "ollama_model": "llama3.1:8b",

  // TTS
  "tts_engine": "streamlabs",         // or "vibevoice"
  "tts_voice": "Matthew",

  // Video rendering
  "video": {
    "engine": "ffmpeg",               // or "moviepy"
    "mode": "split",                  // or "single"
    "split_duration": 60,             // seconds per part
    "auto_cleanup": true,
    "branding": ""
  },

  // Content style defaults
  "formatting": {
    "default_mode": "story",          // story | qa | interactive | hottake
    "default_niche": "relationship_drama"
  },

  // Reddit fetching
  "reddit": {
    "subreddits": ["AmItheAsshole", "relationships", "tifu"],
    "min_score": 500,
    "max_age_days": 30,
    "min_length": 500,
    "max_length": 4000,
    "nsfw": false
  },

  // Publishers (all untested, see Publishing Status)
  "publishers": {
    "youtube": { "enabled": false },
    "tiktok": { "enabled": false },
    "instagram": { "enabled": false },
    "snapchat": { "enabled": false }
  },

  // Notifications
  "discord_webhook_url": "",

  // Autonomous bot
  "bot": {
    "posting_interval_minutes": 60,
    "max_posts_per_day": 6
  }
}
```

## CLI Usage (A-Shell / iOS / Terminal)

The CLI works on A-Shell (iOS, Python 3.13) and any standard terminal.

```bash
pip install requests Pillow
# Optional pretty TUI
pip install rich

python backend/src/cli_app.py
```

What works on iOS:

| Feature                | Status                                |
| ---------------------- | ------------------------------------- |
| Fetch Reddit posts     | Yes (needs `requests`)                |
| Format / script gen    | Yes                                   |
| TTS (Streamlabs cloud) | Yes (needs network)                   |
| Video render (FFmpeg)  | Yes (A-Shell bundles FFmpeg)          |
| Thumbnails (Pillow)    | Yes if Pillow installed               |
| Video render (MoviePy) | No (moviepy/numpy not on iOS)         |
| Local TTS (VibeVoice)  | No                                    |

## Desktop Build (Single EXE for Windows)

```bash
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt pyinstaller pywebview
pnpm install
pnpm build
.\.venv\Scripts\python.exe -m PyInstaller backend\src\desktop_app.py --name reddit-reel-desktop --onefile --add-data=dist:dist --copy-metadata=imageio --copy-metadata=imageio-ffmpeg
```

Output: `dist\reddit-reel-desktop.exe`.

## Project Structure

```
backend/
  src/
    api_server.py         FastAPI server
    main.py               Pipeline orchestrator
    auto_bot.py           Autonomous bot
    ai_content_generator.py
    reddit_story_maker.py
    tts_engine.py
    video_generator.py
    cli_app.py            CLI / TUI entry point
    desktop_app.py        PyWebView desktop wrapper
  requirements.txt        All Python deps in one file
src/
  components/             React UI
  pages/                  Route pages
  hooks/
  lib/api.ts              API client
public/
Dockerfile
docker-compose.yml
LICENSE                   CC BY-NC 4.0
AUTHORS.md
README.md
```

## FAQ

### How do I run Social Automation Suite locally?

Install Node 20, pnpm, Python 3.11, and FFmpeg. Run `pnpm install && pnpm dev` for the frontend and `pip install -r backend/requirements.txt && uvicorn api_server:app --app-dir backend/src --reload` for the backend.

### Does it support local AI models?

Yes. Ollama is supported for local models. Reasoning models like `deepseek-r1` and `kimi-k2.5` are handled correctly by reading the `thinking` field returned by the Ollama API.

### Can I use this commercially?

No. The license is CC BY-NC 4.0 which prohibits commercial use. Contact the author at faheemalvi2000@gmail.com for a commercial license.

### Which TTS works on iOS A-Shell?

Streamlabs Polly works since it is a cloud HTTP API. VibeVoice (local TTS) does not run on iOS.

### What if I have no background videos?

The FFmpeg engine generates a solid color background automatically when the `backgrounds/` directory is empty, so rendering still succeeds.

### How do I deploy with Docker?

Run `docker compose up -d --build`. The dashboard and API are served on port 8000. Mount `config.json`, `channels.json`, `backgrounds/`, `posts/`, and `videos/` as volumes for persistence.

### Do the social media publishers actually work?

The code is implemented for YouTube Shorts, TikTok, Instagram Reels, and Snapchat Spotlight, but the author has not personally completed end to end uploads on a live account. Expect to debug platform credentials and edge cases. Local MP4 output and Discord notifications are tested and working.

### What content modes are available?

Four modes: `story` (first person Reddit narratives), `qa` (question and answer hooks), `interactive` ("put a finger down" challenges), and `hottake` (controversial opinions). Each is documented in the Configuration Guide above.

## License

Licensed under **CC BY-NC 4.0** (Creative Commons Attribution NonCommercial 4.0). You may use, modify, and share this project for personal, educational, and non-commercial purposes. Selling, reselling, or using this project as part of a commercial product or paid service is not permitted without a separate written agreement. See [LICENSE](LICENSE).

## Author and Contact

**Faheem Alvi**

* GitHub: [https://github.com/FaheemAlvii](https://github.com/FaheemAlvii)
* LinkedIn: [https://www.linkedin.com/in/faheem-alvi](https://www.linkedin.com/in/faheem-alvi)
* Email: [faheemalvi2000@gmail.com](mailto:faheemalvi2000@gmail.com)

Open to collaboration, freelance projects, and paid work in Python, FastAPI, React, FFmpeg pipelines, and AI integrations. Email is the fastest way to reach me.

## Disclaimer

This project is provided for educational and personal use. You are responsible for following the terms of service of any platform you publish to (YouTube, TikTok, Instagram, Snapchat, Reddit) and for the content you create with it.
