import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { api } from "@/lib/api";

export interface TitleCardPreviewProps {
  username: string;
  profilePicPath: string;     // patched by TitleCardSettings on upload/clear
  cardBgColor: string;
  textColor: string;
  usernameColor: string;
  accentColor: string;
  cornerRadius: number;       // px in the real render; scaled down for preview
  cardMaxWidthPct: number;    // 0..1 — relative to a 9:16 frame
  titleFontSize: number;      // px in the real render; scaled here
  usernameFontSize: number;   // px in the real render; scaled here
  hideStats: boolean;
  // Optional example title and subreddit so the preview can reflect real
  // content. Defaults to a sample AITA title.
  sampleTitle?: string;
  sampleSubreddit?: string;
}

const SAMPLE_TITLE = "AITA for telling my mother-in-law to stop buying my kids candy?";
const SAMPLE_SUBREDDIT = "AmItheAsshole";

/**
 * Miniature live preview of the title card. Mirrors what PIL actually draws
 * in generate_thumbnail — Reddit-style card floating on a dim background
 * strip, circular avatar + handle + wrapped title. Every prop matches a
 * config field and updates instantly, exactly like CaptionsPreview.
 *
 * The preview canvas is a 9:16 frame at a fixed display width; all sizes
 * are scaled down by `scale = preview_width / 1080` (the real render is
 * always 1080 wide).
 */
export function TitleCardPreview(props: TitleCardPreviewProps) {
  const W = 300;                  // preview width in CSS px
  const scale = W / 1080;         // real frame is 1080w
  const H = Math.round(W * (16 / 9));

  // Fetch the avatar URL lazily — re-fetch when the path changes so uploads
  // show up immediately.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (props.profilePicPath) {
      // Append a cache-buster so the <img> reloads after a replace.
      setAvatarUrl(`${api.profilePicUrl()}&k=${encodeURIComponent(props.profilePicPath)}`);
    } else {
      setAvatarUrl(null);
    }
  }, [props.profilePicPath]);

  // Match server-side sizing: inner_pad ~ uname_px * 0.85, icon_r ~ uname_px * 0.67
  const unameSize = props.usernameFontSize * scale;
  const titleSize = props.titleFontSize * scale;
  const innerPad  = Math.max(10, unameSize * 0.85);
  const iconR     = Math.max(12, unameSize * 0.67);

  const cardWidthPct = Math.max(0.3, Math.min(1.0, props.cardMaxWidthPct));
  const cardWidth    = W * cardWidthPct;

  const handleText = (() => {
    const u = (props.username || "").trim();
    if (!u) return `r/${props.sampleSubreddit || SAMPLE_SUBREDDIT}`;
    if (u.startsWith("@") || u.startsWith("u/") || u.startsWith("r/")) return u;
    return "@" + u;
  })();

  return (
    <div className="rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Preview</span>
        <span className="text-[9px] text-muted-foreground font-mono">9:16 @ {W}×{H}</span>
      </div>
      <div
        className="relative mx-auto rounded-md overflow-hidden"
        style={{
          width:  W,
          height: H,
          // Dimmed faux-background so the card pops (mirrors the 80-alpha
          // overlay the real render paints over a blurred background frame).
          backgroundImage: "linear-gradient(135deg, #1c1c28, #2a2338)",
        }}
      >
        {/* Card — vertically centered */}
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            top: "50%",
            transform: "translate(-50%, -50%)",
            width:  cardWidth,
            background: props.cardBgColor,
            borderRadius: props.cornerRadius * scale,
            padding: innerPad,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          {/* Header: avatar + handle */}
          <div className="flex items-center" style={{ gap: 10 * scale }}>
            <div
              className="rounded-full flex items-center justify-center overflow-hidden shrink-0"
              style={{
                width:  iconR * 2,
                height: iconR * 2,
                background: avatarUrl ? "transparent" : props.accentColor,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  className="w-full h-full object-cover"
                  alt=""
                  onError={() => setAvatarUrl(null)}
                />
              ) : (
                <User className="text-white" style={{ width: iconR * 1.1, height: iconR * 1.1 }} />
              )}
            </div>
            <span
              style={{
                color: props.usernameColor,
                fontSize: unameSize,
                fontFamily: "'Arial', sans-serif",
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              {handleText}
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              color: props.textColor,
              fontSize: titleSize,
              fontFamily: "'Arial', sans-serif",
              fontWeight: 700,
              lineHeight: 1.1,
              marginTop: 20 * scale,
              wordBreak: "break-word",
            }}
          >
            {(props.sampleTitle || SAMPLE_TITLE).slice(0, 180)}
          </div>

          {/* Bottom stats — only when hide_stats is false */}
          {!props.hideStats && (
            <div
              className="flex justify-between items-center"
              style={{
                marginTop: 14 * scale,
                paddingTop: 8 * scale,
                borderTop: `1px solid ${props.textColor}20`,
                color: `${props.usernameColor}80`,
                fontSize: Math.max(9, unameSize * 0.72),
                fontFamily: "'Arial', sans-serif",
              }}
            >
              <span>♡ 999+</span>
              <span>⤴ 999+</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
