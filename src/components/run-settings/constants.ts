/**
 * Single source of truth for the per-render UI choices.
 *
 * IMPORTANT: keep these in sync with the backend's accepted values.
 *   - Tones: ai_content_generator.TONE_INSTRUCTIONS (dramatic / funny /
 *            heartfelt / shocking / cringe).
 *   - Content filters: ai_content_generator.CONTENT_FILTERS (safe /
 *            normal / edgy).
 *   - Video modes: api_server.py — short_reel / reel / long_reel
 *            (legacy "full_video" is auto-mapped to long_reel server-side).
 *
 * Adding a new option here updates every "generate" dialog at once.
 */

import {
  Drama, Laugh, Heart, AlertTriangle, Frown, Scissors, Film,
  Shield, ShieldAlert, ShieldOff, Zap,
} from "lucide-react";

import type {
  ContentFilterOption, ToneOption, VideoModeOption,
} from "./types";


// ── Tones (emotional register) ────────────────────────────────────────
// Note: AlertTriangle and Frown were the AI dialog's choices; we keep
// them so existing UI doesn't visibly change. The "shocking" icon was
// previously Zap in the AI dialog but AlertTriangle reads better.
export const TONES: ToneOption[] = [
  { id: "dramatic",  label: "Dramatic",  icon: Drama,         color: "text-red-400",
    desc: "High stakes, mounting tension, gut-punch endings" },
  { id: "funny",     label: "Funny",     icon: Laugh,         color: "text-yellow-400",
    desc: "Absurdity and comedic timing — readers laugh out loud" },
  { id: "heartfelt", label: "Heartfelt", icon: Heart,         color: "text-pink-400",
    desc: "Genuine emotion and vulnerability — moves people, doesn't shock" },
  { id: "shocking",  label: "Shocking",  icon: Zap,           color: "text-purple-400",
    desc: "Twists that make viewers say 'WHAT' out loud — withhold key info until reveal" },
  { id: "cringe",    label: "Cringe",    icon: Frown,         color: "text-orange-400",
    desc: "Secondhand embarrassment — readers physically wince at oblivious narrator moments" },
];


// ── Content filters (language + risky-topic scope) ────────────────────
export const CONTENT_FILTERS: ContentFilterOption[] = [
  { id: "safe",   label: "Safe",   short: "Brand-safe",
    icon: Shield,      color: "text-emerald-400",
    desc: "Zero brand risk — no profanity, no risky words, advertiser-friendly." },
  { id: "normal", label: "Normal", short: "Reddit-natural",
    icon: ShieldAlert, color: "text-amber-400",
    desc: "Mild language only when the moment demands it; no slurs, no gratuitous content." },
  { id: "edgy",   label: "Edgy",   short: "Unfiltered",
    icon: ShieldOff,   color: "text-rose-400",
    desc: "Reddit-authentic — full curse vocabulary, adult themes, no softening. No targeted slurs." },
];


// ── Video modes (output length) ───────────────────────────────────────
// Three vertical-only lengths. Removed the "Full Video" horizontal
// option — this app is a short-form (TikTok / Reels / Shorts) tool,
// horizontal long-form doesn't fit the value prop. Backend silently
// maps the legacy "full_video" id to "long_reel" so saved presets and
// queued items don't break.
export const VIDEO_MODES: VideoModeOption[] = [
  { id: "short_reel", label: "Short Reel", icon: Scissors, desc: "< 60s · the punchy default" },
  { id: "reel",       label: "Reel",       icon: Film,     desc: "60–90s · room for a real arc" },
  { id: "long_reel",  label: "Long Reel",  icon: Film,     desc: "90s+ · multi-beat stories" },
];
