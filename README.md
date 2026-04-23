# Reddit Video Engine — ReelsAutomation Fork

Open source tool to generate vertical short videos from Reddit posts or AI generated scripts. Renders with FFmpeg, narrates with TTS, and can publish to YouTube Shorts, TikTok, Instagram Reels, and Snapchat Spotlight.

This is a fork of [FaheemAlvii/reddit-to-reels](https://github.com/FaheemAlvii/reddit-to-reels) with a bunch of quality-of-life and feature additions — see [Fork Additions](#fork-additions) below.

> **Upstream Notice**
>
> The original repo is **not actively maintained** per its author. This fork has diverged with feature work; the credits and author info at the bottom still apply to the original codebase.

## Fork additions

### TTS

- **ElevenLabs provider** — live voice fetching from `/v2/voices` (no stale hardcoded IDs); stability / similarity / style / speaker-boost sliders; model selection (Multilingual v2 / Turbo v2.5 / Monolingual v1); configs that stored a name instead of a voice_id self-heal on next run.
- **Gendered voice presets** — per-provider male/female defaults in the TTS tab. The Run dialog auto-detects narrator gender from the post title/body (regex on `(M32)` / `28f` / `as a 24F` / `my wife|husband`) and picks the matching preset. Can be overridden per-run.
- **Pre-TTS cleanup with local Ollama** — expands Reddit shorthand (`tho`→`though`, `cuz`→`because`) and fixes typos before sending to paid TTS. Cached per-post. Silently skipped if Ollama is offline.
- **Playback speed is actually applied now** — the speed slider was cosmetic upstream; I pipe each synthesized clip through FFmpeg `atempo` (handles 0.25×–4× via chaining). Whisper alignment then runs on the stretched audio so captions stay in sync.

### Captions

- **Fully configurable** — font (server-side font picker enumerating installed TTFs), size, color, stroke color/width, uppercase, background box, position (center/top/bottom), offset, max width %, words-per-chunk.
- **Color picker** — native swatch + hex input combo for text, stroke, BG, and highlight colors.
- **Animations** (MoviePy engine): fade, pop, fade+pop with tunable duration, overshoot, start-scale.
- **Whisper forced alignment** — optional local `faster-whisper` (GPU-aware: `cuda` + `float16` when available, else `cpu` + `int8`) produces word-level timestamps so captions snap to the actual spoken words. Cached per audio file.
- **Per-word highlight** — current spoken word rendered in a configurable color, optionally scaled up 100–150% for a TikTok-style bounce. Requires alignment.
- **Per-word shrink-to-fit** — if one word would overflow the caption width, just that word is scaled down (baseline-aligned with its neighbors); the rest stay at normal size.
- **Runaway-caption cap** — `max_chunk_duration` prevents a single chunk from staying on screen for 15+ seconds when whisper leaves a gap. `lead_in_grace` covers brief TTS leading silence.
- **Title card over live background** — during the hook + title TTS segments, the Reddit-style card widget is overlaid on top of the running background video (transparent surrounds, so the background keeps moving). Captions start once the body begins.
- **Live caption preview** — 9:16 mock frame on the Captions tab that reflects every setting in real time, including cycling active-word highlight.

### Post discovery

- **AI virality scorer** — a "Score with AI" button scores up to 40 visible posts 0–100 using your configured LLM (Ollama / Gemini / OpenRouter / NVIDIA NIM). Results cached per-post. New "AI" sort.
- **Virality (upvotes/hour), duration estimate (~155 wpm), per-subreddit cap**, and **fuzzy dedupe** of titles against previously-used posts.
- **Expanded filter bar** — exclude keywords, must-contain, deny-subreddit list, min upvotes, min comments, min viral/hr, max duration, min AI score, hide near-duplicates.
- **Filter presets** — save/load/delete named filter bundles (persisted per browser).

### Publishing / output

- **Social copy generator** — per-video "Social Copy" button generates YouTube Shorts titles (3 variants) + description + tags, TikTok caption + hashtags, Instagram caption + hashtags, via your configured AI provider. Saved to `posts/<id>/social.json` with per-field copy buttons.
- **Project registry** — every rendered video is tracked in `projects.json` at the repo root. Audio + `timeline.json` are preserved under `videos/proj_<id>/` even when `auto_cleanup` nukes `posts/<id>/`, so the Videos page survives server restarts and Re-render keeps working indefinitely.
- **Re-render** — re-runs just the video step using the persisted audio and aligned timeline, so caption/video settings can be tweaked without re-spending TTS credits. Preview URLs include `?v=<mtime>` + no-cache headers so the new render shows immediately.
- **Delete dialog** — two options: "List only" (keeps files) and "Delete files too" (removes the .mp4s, thumbnail, and preserved workspace). Exact-path matching — deleting one video no longer wipes siblings with similar titles.

### Dev experience

- **Tabbed config page** — sidebar navigation (General / Formatting / TTS / Video / Captions / AI Hooks / Output & Discord) instead of one long scrolling page.
- **`start.ps1` dev loop** — wraps the server with Ctrl+C-restarts-server behavior (double-tap Ctrl+C within 2s to exit).
- **`run_server.py`** — single-entry dev launcher that mounts the built frontend and runs uvicorn with the backend path correctly resolved.

### Upstream bug fixes shipped

- **`PROJECT_ROOT` off-by-one** — every module in `backend/src/` computed this one `dirname` short of the repo root, which made the stock server silently read a stale `backend/config.json`. Fixed across all 13 modules.
- **Caption overflow on wide fonts** — upstream used a `fontsize * 0.5` estimate for wrap width; display fonts like Gotham Ultra overflowed the frame. Rewrote with `font.getlength()` pixel-accurate wrapping and stroke-aware canvas sizing.
- **Title card appearing too late and then vanishing** — title/hook segments now carry a `segment_role: "title"` tag so the card shows for the whole hook block and captions only engage once the body begins.
- **Delete endpoint substring-match** — previously `if video_id in filename:` deleted all posts with overlapping characters. Replaced with exact-path matching.

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
}
```

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

---

## Upstream documentation

> **Maintenance Notice**
>
> This repository is **not actively maintained**. It works at the time of writing and may receive occasional updates when time permits. Pull requests are welcome but reviews can be slow. For paid features or guaranteed support see the contact section below.

## What it does

Reddit Video Engine fetches content from Reddit or generates original scripts using a configured AI provider, converts the text to speech, and renders a vertical 1080x1920 short video with synchronized subtitles and a background clip. It includes a web dashboard, a CLI for terminals (including A-Shell on iOS), and a desktop build for Windows.

## Features

Real, in code features. No filler.

* Fetch Reddit posts from configured subreddits with filters for length, score, and age.
* AI content generation in four styles: Story, Q&A, Interactive "put a finger down", and Hot Take.
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

### How do I run Reddit Video Engine locally?

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
