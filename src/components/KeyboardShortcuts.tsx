import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useCommandPalette } from "@/components/CommandPalette";

/**
 * Global keyboard shortcut handler.
 *
 *   g h  → Dashboard
 *   g p  → Posts
 *   g v  → Videos
 *   g c  → Config
 *   /    → Focus the page's main search input
 *   ?    → Open shortcut cheatsheet
 *   ⌘K   → Command palette (handled in CommandPalette.tsx)
 *
 * Shortcuts are ignored while the user is typing in an input / textarea
 * / contenteditable so we never steal text input from them.
 */
export function KeyboardShortcuts() {
  const nav = useNavigate();
  const { toggle: toggleCommandPalette } = useCommandPalette();
  const [helpOpen, setHelpOpen] = useState(false);
  // Tracks if user recently pressed `g` — the 2nd key of the pair resolves
  // within 1.2s; otherwise treated as a normal keypress.
  const gPendingUntil = useRef<number>(0);

  useEffect(() => {
    const isTyping = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const now = Date.now();
      const pending = gPendingUntil.current > now;

      if (pending) {
        gPendingUntil.current = 0;
        switch (e.key.toLowerCase()) {
          case "h": nav("/");            e.preventDefault(); return;
          case "p": nav("/posts");       e.preventDefault(); return;
          case "v": nav("/videos");      e.preventDefault(); return;
          case "l": nav("/clips");       e.preventDefault(); return;
          case "b": nav("/backgrounds"); e.preventDefault(); return;
          case "c": nav("/config");      e.preventDefault(); return;
          default: return;
        }
      }

      switch (e.key) {
        case "g":
          gPendingUntil.current = now + 1200;
          e.preventDefault();
          return;
        case "?":
          setHelpOpen(true);
          e.preventDefault();
          return;
        case "/":
          // Focus the first visible input that looks like a search.
          const candidate = document.querySelector<HTMLInputElement>(
            'input[placeholder*="earch" i], input[placeholder*="ilter" i], input[type="search"]'
          );
          if (candidate) {
            candidate.focus();
            e.preventDefault();
          }
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  // Expose the toggle so `?` and ⌘K can both work even after dismissing.
  useEffect(() => {
    // Re-export nothing — the palette hotkey already lives in CommandPaletteProvider.
  }, [toggleCommandPalette]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Most anywhere in the app — ignored while typing in an input.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 text-xs">
          <Row keys={["⌘", "K"]} alt={["Ctrl", "K"]} label="Command palette (jump to anywhere)" />
          <Row keys={["g", "h"]} label="Go to Dashboard" />
          <Row keys={["g", "p"]} label="Go to Posts" />
          <Row keys={["g", "v"]} label="Go to Videos" />
          <Row keys={["g", "l"]} label="Go to Clip Maker" />
          <Row keys={["g", "b"]} label="Go to Backgrounds" />
          <Row keys={["g", "c"]} label="Go to Config" />
          <Row keys={["/"]} label="Focus search / filter input" />
          <Row keys={["?"]} label="This cheatsheet" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ keys, alt, label }: { keys: string[]; alt?: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-foreground">{label}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {keys.map((k, i) => (
          <kbd
            key={i}
            className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-secondary px-1.5 text-[10px] font-mono"
          >
            {k}
          </kbd>
        ))}
        {alt && (
          <>
            <span className="text-[10px]">/</span>
            {alt.map((k, i) => (
              <kbd
                key={`alt-${i}`}
                className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-secondary px-1.5 text-[10px] font-mono"
              >
                {k}
              </kbd>
            ))}
          </>
        )}
      </span>
    </div>
  );
}
