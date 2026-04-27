import { useEffect, useState, useRef } from "react";
import { Upload, Trash2, User, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorInput } from "@/components/ColorInput";
import { TitleCardPreview } from "@/components/TitleCardPreview";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props {
  // Core
  username: string;
  onUsernameChange: (v: string) => void;
  hideStats: boolean;
  onHideStatsChange: (v: boolean) => void;
  profilePicPath: string;
  onProfilePicChange: (v: string) => void;

  // Visual knobs
  cardBgColor: string;
  onCardBgColorChange: (v: string) => void;
  textColor: string;
  onTextColorChange: (v: string) => void;
  usernameColor: string;
  onUsernameColorChange: (v: string) => void;
  accentColor: string;
  onAccentColorChange: (v: string) => void;
  cornerRadius: number;
  onCornerRadiusChange: (v: number) => void;
  cardMaxWidthPct: number;
  onCardMaxWidthPctChange: (v: number) => void;
  titleFontSize: number;
  onTitleFontSizeChange: (v: number) => void;
  usernameFontSize: number;
  onUsernameFontSizeChange: (v: number) => void;

  // Border (0 width = no border). Falls back to accent in the renderer
  // so a fresh project gets a usable default the moment width > 0.
  borderColor: string;
  onBorderColorChange: (v: string) => void;
  borderWidth: number;
  onBorderWidthChange: (v: number) => void;

  // Entry / exit animations. Both default to 'fade' to match the
  // captions experience — set to 'none' to disable.
  entryAnimation: string;
  onEntryAnimationChange: (v: string) => void;
  entryDuration: number;
  onEntryDurationChange: (v: number) => void;
  exitAnimation: string;
  onExitAnimationChange: (v: string) => void;
  exitDuration: number;
  onExitDurationChange: (v: number) => void;
}

// Animation options shared by entry/exit. Slide directions are named from
// the user's POV: "slide up" enters from below moving up. "Zoom" is
// implemented as fade-only here (full PIL reframe would need a smaller
// canvas) — we omit it from the menu rather than ship a misleading name.
const ENTRY_ANIMATIONS = [
  { v: "none",            label: "None" },
  { v: "fade",            label: "Fade in" },
  { v: "slide_up",        label: "Slide up (from below)" },
  { v: "slide_down",      label: "Slide down (from above)" },
  { v: "slide_left",      label: "Slide in from right" },
  { v: "slide_right",     label: "Slide in from left" },
  { v: "fade_slide_up",   label: "Fade + slide up" },
  { v: "fade_slide_down", label: "Fade + slide down" },
];
const EXIT_ANIMATIONS = [
  { v: "none",            label: "None" },
  { v: "fade",            label: "Fade out" },
  { v: "slide_up",        label: "Slide up (off-top)" },
  { v: "slide_down",      label: "Slide down (off-bottom)" },
  { v: "slide_left",      label: "Slide off left" },
  { v: "slide_right",     label: "Slide off right" },
  { v: "fade_slide_up",   label: "Fade + slide up" },
  { v: "fade_slide_down", label: "Fade + slide down" },
];

/**
 * Title-card customization panel with a live mini-preview (à la CaptionsPreview).
 *
 * Upload avatar → the server saves it to `branding/avatar.*` and patches
 * config.thumbnail.profile_pic_path directly — the upload doesn't wait
 * for Save All. Other knobs (colors, sizes) still respect the global
 * unsaved-changes flow.
 */
export function TitleCardSettings(props: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Too big", description: "Keep it under 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadProfilePic(file);
      props.onProfilePicChange(r.path);
      toast({ title: "Profile picture saved" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleClear = async () => {
    try {
      await api.clearProfilePic();
      props.onProfilePicChange("");
      toast({ title: "Profile picture removed" });
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    }
  };

  const hasPic = Boolean(props.profilePicPath);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
      {/* Left column: controls */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
          <input
            ref={fileRef}
            type="file"
            accept="image/png, image/jpeg, image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="gap-1"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {hasPic ? "Replace" : "Upload"} image
            </Button>
            {hasPic && (
              <Button
                size="sm" variant="outline"
                onClick={handleClear}
                className="gap-1 text-destructive hover:text-destructive"
                disabled={uploading}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Display username</Label>
            <Input
              value={props.username}
              onChange={(e) => props.onUsernameChange(e.target.value)}
              placeholder="@relationshipstories"
              className="h-8 text-xs bg-secondary border-border font-mono"
            />
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/20 p-2.5">
          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground leading-snug">
            PNGs with transparency work best — the avatar is masked into a circle.
            Square aspect ratio recommended (e.g. 512×512).
          </p>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-3">
          <ColorInput label="Card background" value={props.cardBgColor}     onChange={props.onCardBgColorChange} />
          <ColorInput label="Title text"      value={props.textColor}       onChange={props.onTextColorChange} />
          <ColorInput label="Username text"   value={props.usernameColor}   onChange={props.onUsernameColorChange} />
          <ColorInput label="Accent (icon/badge)" value={props.accentColor} onChange={props.onAccentColorChange} />
        </div>

        {/* Dimensions */}
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Label>Card width</Label>
              <span className="font-mono text-[10px] text-muted-foreground">
                {Math.round(props.cardMaxWidthPct * 100)}%
              </span>
            </div>
            <Slider
              value={[Math.round(props.cardMaxWidthPct * 100)]}
              onValueChange={([v]) => props.onCardMaxWidthPctChange(v / 100)}
              min={40} max={100} step={2}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Label>Corner radius</Label>
              <span className="font-mono text-[10px] text-muted-foreground">{props.cornerRadius}px</span>
            </div>
            <Slider
              value={[props.cornerRadius]}
              onValueChange={([v]) => props.onCornerRadiusChange(v)}
              min={0} max={80} step={2}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Label>Title font size</Label>
              <span className="font-mono text-[10px] text-muted-foreground">{props.titleFontSize}px</span>
            </div>
            <Slider
              value={[props.titleFontSize]}
              onValueChange={([v]) => props.onTitleFontSizeChange(v)}
              min={28} max={96} step={2}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Label>Username font size</Label>
              <span className="font-mono text-[10px] text-muted-foreground">{props.usernameFontSize}px</span>
            </div>
            <Slider
              value={[props.usernameFontSize]}
              onValueChange={([v]) => props.onUsernameFontSizeChange(v)}
              min={20} max={64} step={2}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border">
          <div>
            <Label className="text-xs">Hide fake stats bar</Label>
            <p className="text-[10px] text-muted-foreground">
              Hides the ♡ upvotes / ⤴ share numbers at the bottom. Usually a good idea.
            </p>
          </div>
          <Switch checked={props.hideStats} onCheckedChange={props.onHideStatsChange} />
        </div>

        {/* Border — 0 width hides it. Color falls back to accent on the
            backend if the user never picks one. */}
        <div className="space-y-2 pt-2 border-t border-border">
          <Label className="text-xs">Border</Label>
          <div className="grid grid-cols-2 gap-3">
            <ColorInput
              label="Border color"
              value={props.borderColor}
              onChange={props.onBorderColorChange}
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <Label className="text-[11px]">Border width</Label>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {props.borderWidth}px {props.borderWidth === 0 && "(off)"}
                </span>
              </div>
              <Slider
                value={[props.borderWidth]}
                onValueChange={([v]) => props.onBorderWidthChange(v)}
                min={0} max={16} step={1}
              />
            </div>
          </div>
        </div>

        {/* Entry + exit animations. Two parallel rows so the user can
            mix-and-match (e.g. slide in, fade out). */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Entry animation</Label>
            <span className="font-mono text-[10px] text-muted-foreground">
              {props.entryDuration.toFixed(2)}s
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <Select value={props.entryAnimation} onValueChange={props.onEntryAnimationChange}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTRY_ANIMATIONS.map((a) => (
                  <SelectItem key={a.v} value={a.v}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-32">
              <Slider
                value={[Math.round(props.entryDuration * 100)]}
                onValueChange={([v]) => props.onEntryDurationChange(v / 100)}
                min={0} max={150} step={5}
                disabled={props.entryAnimation === "none"}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs">Exit animation</Label>
            <span className="font-mono text-[10px] text-muted-foreground">
              {props.exitDuration.toFixed(2)}s
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <Select value={props.exitAnimation} onValueChange={props.onExitAnimationChange}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXIT_ANIMATIONS.map((a) => (
                  <SelectItem key={a.v} value={a.v}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-32">
              <Slider
                value={[Math.round(props.exitDuration * 100)]}
                onValueChange={([v]) => props.onExitDurationChange(v / 100)}
                min={0} max={150} step={5}
                disabled={props.exitAnimation === "none"}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Both phases are auto-capped at 40% of the title segment so a
            short title still gets the full animation, just proportionally
            faster.
          </p>
        </div>
      </div>

      {/* Right column: live preview */}
      <div className="lg:sticky lg:top-2 lg:self-start">
        <TitleCardPreview
          username={props.username}
          profilePicPath={props.profilePicPath}
          cardBgColor={props.cardBgColor}
          textColor={props.textColor}
          usernameColor={props.usernameColor}
          accentColor={props.accentColor}
          cornerRadius={props.cornerRadius}
          cardMaxWidthPct={props.cardMaxWidthPct}
          titleFontSize={props.titleFontSize}
          usernameFontSize={props.usernameFontSize}
          hideStats={props.hideStats}
          borderColor={props.borderColor}
          borderWidth={props.borderWidth}
          entryAnimation={props.entryAnimation}
          entryDuration={props.entryDuration}
          exitAnimation={props.exitAnimation}
          exitDuration={props.exitDuration}
        />
      </div>
    </div>
  );
}
