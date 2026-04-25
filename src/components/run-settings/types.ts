/**
 * Type definitions shared across the run-settings constants and
 * controls. Kept here (instead of inline in each dialog) so the union
 * types can't drift between dialogs — the previous pattern had each
 * dialog re-declaring `type Tone = "dramatic" | "funny" | …` and
 * adding a new tone meant updating ~5 string-literal unions plus a
 * matching constant array.
 */

import type { LucideIcon } from "lucide-react";

export type ContentFilter = "safe" | "normal" | "edgy";
export type Tone = "dramatic" | "funny" | "heartfelt" | "shocking" | "cringe";
export type NarratorGender = "auto" | "male" | "female";
export type VideoMode = "short_reel" | "reel" | "long_reel";

export interface ContentFilterOption {
  id: ContentFilter;
  label: string;
  short: string;       // 2-3 word summary used in compact pills
  icon: LucideIcon;    // shield variants
  color: string;       // tailwind class for the icon
  desc: string;        // 1-line tooltip / helper text
}

export interface ToneOption {
  id: Tone;
  label: string;
  icon: LucideIcon;
  color: string;     // tailwind class for the icon
  desc: string;
}

export interface VideoModeOption {
  id: VideoMode;
  label: string;
  icon: LucideIcon;
  desc: string;
}
