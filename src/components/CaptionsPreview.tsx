import { useEffect, useMemo, useState } from "react";

export interface CaptionsPreviewProps {
  enabled: boolean;
  fontPath: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;        // 0..255
  padding: number;
  cornerRadius: number;
  maxWidthPct: number;      // 0..1
  position: "center" | "bottom" | "top";
  positionOffset: number;
  wordsPerCaption: number;
  uppercase: boolean;
  animation: "none" | "fade" | "pop" | "fade_pop";
  animationDuration: number;
  popOvershoot: number;
  popStartScale: number;
}

const SAMPLE =
  "This is exactly what your captions will look like on screen. Tweak any setting and it updates live.";

// Actual render resolution for reel mode.
const FRAME_W = 1080;
const FRAME_H = 1920;

// Preview viewport width in CSS pixels. Height follows 9:16.
const PREVIEW_W = 280;
const PREVIEW_H = Math.round((PREVIEW_W * FRAME_H) / FRAME_W);
const SCALE = PREVIEW_W / FRAME_W;

function chunkWords(text: string, n: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (n <= 0) return [text.trim()];
  const out: string[] = [];
  for (let i = 0; i < words.length; i += n) out.push(words.slice(i, i + n).join(" "));
  return out;
}

function colorToRgba(color: string, alpha: number): string {
  if (!color) return `rgba(0,0,0,${alpha})`;
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    gray: [128, 128, 128],
  };
  const lower = color.trim().toLowerCase();
  if (named[lower]) {
    const [r, g, b] = named[lower];
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith("#")) {
    const h = color.replace("#", "");
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  // Let CSS try to handle unknown tokens; apply opacity via wrapper.
  return color;
}

function fontFamilyFromPath(p: string): string {
  // "arial.ttf" -> "Arial, sans-serif"; absolute paths -> base name title-cased
  if (!p) return "sans-serif";
  const base = p.split(/[\\/]/).pop() ?? p;
  const name = base.replace(/\.(ttf|otf|woff2?|ttc)$/i, "");
  if (!name) return "sans-serif";
  const titled = name.charAt(0).toUpperCase() + name.slice(1);
  return `"${titled}", Arial, sans-serif`;
}

export function CaptionsPreview(props: CaptionsPreviewProps) {
  const chunks = useMemo(
    () => chunkWords(SAMPLE, props.wordsPerCaption),
    [props.wordsPerCaption]
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!props.enabled || chunks.length <= 1) return;
    const iv = setInterval(() => setIdx((i) => (i + 1) % chunks.length), 1400);
    return () => clearInterval(iv);
  }, [chunks.length, props.enabled]);

  // Reset index if chunk count drops.
  useEffect(() => {
    if (idx >= chunks.length) setIdx(0);
  }, [chunks.length, idx]);

  const displayText = chunks[idx] ?? "";
  const shownText = props.uppercase ? displayText.toUpperCase() : displayText;

  // Scale font size and stroke to preview.
  const scaledFont = Math.max(6, Math.round(props.fontSize * SCALE));
  const scaledStroke = Math.max(0, props.strokeWidth * SCALE);
  const scaledPadding = Math.max(0, props.padding * SCALE);
  const scaledRadius = Math.max(0, props.cornerRadius * SCALE);
  const scaledOffset = props.positionOffset * SCALE;
  const maxWidthPx = Math.round(PREVIEW_W * Math.min(1, Math.max(0.2, props.maxWidthPct)));

  const positionStyle: React.CSSProperties = (() => {
    if (props.position === "bottom") {
      return { top: `${0.78 * PREVIEW_H + scaledOffset}px`, transform: "translate(-50%, -50%)" };
    }
    if (props.position === "top") {
      return { top: `${0.18 * PREVIEW_H + scaledOffset}px`, transform: "translate(-50%, -50%)" };
    }
    return { top: `${0.5 * PREVIEW_H + scaledOffset}px`, transform: "translate(-50%, -50%)" };
  })();

  const bgAlpha = Math.min(1, Math.max(0, props.bgOpacity / 255));
  const bgCss = props.bgEnabled ? colorToRgba(props.bgColor, bgAlpha) : "transparent";

  // Multi-layer text-shadow emulates PIL's stroke_width.
  const strokeShadow = useMemo(() => {
    if (scaledStroke <= 0) return "none";
    const steps: string[] = [];
    const s = Math.max(1, Math.round(scaledStroke));
    for (let dx = -s; dx <= s; dx++) {
      for (let dy = -s; dy <= s; dy++) {
        if (dx === 0 && dy === 0) continue;
        steps.push(`${dx}px ${dy}px 0 ${props.strokeColor}`);
      }
    }
    return steps.join(", ");
  }, [scaledStroke, props.strokeColor]);

  const animKey = `${idx}-${props.animation}-${props.animationDuration}-${props.popOvershoot}-${props.popStartScale}`;
  const animDurMs = Math.max(20, Math.round(props.animationDuration * 1000));
  const animName =
    props.animation === "fade" ? "cp-fade" :
    props.animation === "pop" ? "cp-pop" :
    props.animation === "fade_pop" ? "cp-fadepop" :
    "";

  const cssVars = {
    "--cp-pop-start": props.popStartScale.toString(),
    "--cp-pop-over":  props.popOvershoot.toString(),
  } as React.CSSProperties;

  return (
    <div className="space-y-2 w-[280px] max-w-full">
      {/* local keyframes */}
      <style>{`
        @keyframes cp-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
        @keyframes cp-pop {
          0%   { transform: scale(var(--cp-pop-start)); }
          70%  { transform: scale(var(--cp-pop-over)); }
          100% { transform: scale(1); }
        }
        @keyframes cp-fadepop {
          0%   { opacity: 0; transform: scale(var(--cp-pop-start)); }
          70%  { opacity: 1; transform: scale(var(--cp-pop-over)); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Live Preview</div>

      <div
        className="relative overflow-hidden rounded-lg border border-border shadow-inner"
        style={{
          width: PREVIEW_W,
          height: PREVIEW_H,
          background:
            "repeating-linear-gradient(45deg, #1a1a2a 0 12px, #15151f 12px 24px)",
        }}
      >
        {/* gradient tint so the scene feels like a real video frame */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "radial-gradient(circle at 50% 40%, rgba(80,80,120,0.35), rgba(0,0,0,0.75) 75%)" }}
        />

        {props.enabled && shownText && (
          <div
            className="absolute left-1/2"
            style={positionStyle}
          >
            {/* Inner wrapper owns the animation transform so it doesn't
                fight the outer translate(-50%, -50%) used for centering. */}
            <div
              key={animKey}
              style={{
                ...cssVars,
                maxWidth: maxWidthPx,
                padding: scaledPadding,
                background: bgCss,
                borderRadius: scaledRadius,
                transformOrigin: "center center",
                animation: animName ? `${animName} ${animDurMs}ms ease-out both` : undefined,
              }}
            >
              <div
                style={{
                  fontFamily: fontFamilyFromPath(props.fontPath),
                  fontSize: scaledFont,
                  lineHeight: 1.15,
                  color: props.color,
                  textAlign: "center",
                  textShadow: strokeShadow,
                  wordBreak: "break-word",
                  fontWeight: 700,
                }}
              >
                {shownText}
              </div>
            </div>
          </div>
        )}

        {!props.enabled && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Captions disabled</span>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Preview scales a 1080×1920 reel frame. Font matching depends on what's installed on your machine.
        Chunk cycling runs at ~1.4s per chunk — the real render syncs to TTS audio.
      </p>
    </div>
  );
}
