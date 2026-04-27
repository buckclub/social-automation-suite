/**
 * HelpHint — a small "(?)" icon that opens a popover with explanatory
 * text. Sprinkled next to confusing form fields so users can self-serve
 * a one-paragraph explanation instead of bouncing to the README.
 *
 * Usage:
 *   <Label className="flex items-center gap-1">
 *     Min viral (▲/hr)
 *     <HelpHint>
 *       Upvotes per hour since the post was created. Better than raw
 *       score for catching posts that are blowing up *right now* —
 *       a 6-month-old post with 50k upvotes scores low here.
 *     </HelpHint>
 *   </Label>
 *
 * Keep the body short — one paragraph, plain prose. If it needs a
 * heading or a bullet list, it belongs in the /guide page instead.
 */
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  children: React.ReactNode;
  /** Slightly bigger icon for places where the default 12px feels lost. */
  size?: "sm" | "md";
  className?: string;
}

export function HelpHint({ children, size = "sm", className }: Props) {
  const px = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Stop click bubbling so a HelpHint inside a clickable label
          // doesn't accidentally toggle the parent control.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground transition-colors",
            className,
          )}
          aria-label="Help"
        >
          <HelpCircle className={px} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="text-[11px] leading-relaxed max-w-xs p-3 bg-popover border-border"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
