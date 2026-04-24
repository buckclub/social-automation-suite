import { useEffect, useState, useMemo, createContext, useContext, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard, Newspaper, Film, Settings2, Youtube, Sparkles,
  Play, PlayCircle, Search, Mic, Type, Image as ImageIcon, RotateCcw, Images, Scissors,
} from "lucide-react";
import { useVideos } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ── Context so any component can open/close the palette ─────────────
interface PaletteContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}
const PaletteContext = createContext<PaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within <CommandPaletteProvider>");
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Global ⌘K / Ctrl+K hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <PaletteContext.Provider value={{ open, setOpen, toggle }}>
      {children}
      <CommandPalette />
    </PaletteContext.Provider>
  );
}

// ── The palette itself ──────────────────────────────────────────────
function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const nav = useNavigate();
  const { toast } = useToast();
  const { data: videosData } = useVideos();

  const go = (path: string) => {
    setOpen(false);
    nav(path);
  };

  const videos = (videosData?.videos ?? []).slice(0, 8);

  // Actions — small imperative commands.
  const actions = useMemo(() => [
    {
      id: "scan",
      label: "Scan subreddits for posts",
      icon: <Search className="h-4 w-4" />,
      run: () => { setOpen(false); nav("/posts"); toast({ title: "Opened Posts — click Scan Subreddits" }); },
    },
    {
      id: "connect-yt",
      label: "Connect YouTube",
      icon: <Youtube className="h-4 w-4 text-[#ff0000]" />,
      run: () => go("/config"),
    },
    {
      id: "reset-pipeline",
      label: "Reset pipeline state",
      icon: <RotateCcw className="h-4 w-4" />,
      run: async () => {
        setOpen(false);
        try {
          await api.resetPipeline();
          toast({ title: "Pipeline state reset" });
        } catch (e: any) {
          toast({ title: "Reset failed", description: e.message, variant: "destructive" });
        }
      },
    },
  ], [nav, toast]);

  // Config sub-tabs — deep jump via ?tab=... (ConfigPage reads this).
  const configTabs = useMemo(() => [
    { id: "general",    label: "General",         icon: <Settings2 className="h-4 w-4" /> },
    { id: "formatting", label: "Formatting",      icon: <Newspaper className="h-4 w-4" /> },
    { id: "tts",        label: "TTS",             icon: <Mic className="h-4 w-4" /> },
    { id: "video",      label: "Video",           icon: <Film className="h-4 w-4" /> },
    { id: "captions",   label: "Captions",        icon: <Type className="h-4 w-4" /> },
    { id: "ai",         label: "AI Hooks",        icon: <Sparkles className="h-4 w-4" /> },
    { id: "publishing", label: "Publishing",      icon: <Youtube className="h-4 w-4" /> },
    { id: "output",     label: "Output & Discord", icon: <ImageIcon className="h-4 w-4" /> },
  ], []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump anywhere — pages, videos, actions, config…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard className="h-4 w-4" /> Dashboard
            <CommandShortcut>g h</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/posts")}>
            <Newspaper className="h-4 w-4" /> Posts
            <CommandShortcut>g p</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/videos")}>
            <Film className="h-4 w-4" /> Videos
            <CommandShortcut>g v</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/clips")}>
            <Scissors className="h-4 w-4" /> Clip Maker
            <CommandShortcut>g l</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/backgrounds")}>
            <Images className="h-4 w-4" /> Backgrounds
            <CommandShortcut>g b</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/config")}>
            <Settings2 className="h-4 w-4" /> Configuration
            <CommandShortcut>g c</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {actions.map((a) => (
            <CommandItem key={a.id} onSelect={a.run}>
              {a.icon} {a.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Config → section">
          {configTabs.map((t) => (
            <CommandItem
              key={t.id}
              onSelect={() => go(`/config?tab=${t.id}`)}
            >
              {t.icon} {t.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {videos.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent videos">
              {videos.map((v) => (
                <CommandItem
                  key={v.id}
                  value={`video ${v.title} ${v.subreddit}`}
                  onSelect={() => go(`/videos?preview=${encodeURIComponent(v.id)}`)}
                >
                  {v.has_video ? <PlayCircle className="h-4 w-4 text-success" /> : <Play className="h-4 w-4 text-warning" />}
                  <span className="truncate max-w-[380px]">{v.title}</span>
                  <CommandShortcut className="text-[10px]">r/{v.subreddit}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
