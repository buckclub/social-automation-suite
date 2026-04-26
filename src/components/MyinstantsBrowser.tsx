/**
 * Myinstants browse panel — embedded on the SFX Library page so the
 * user can preview + import trending / searched sounds without
 * leaving the app.
 *
 * Behavior:
 *  - Mode toggle: Trending / Search.
 *  - Trending mode picks a region (US / UK / BR / MX / DE / FR / IN —
 *    the most active myinstants regions). Backend caches each
 *    region's HTML for 1h.
 *  - Search mode debounces input by 350 ms.
 *  - Each sound card has Play (streams the mp3 directly from
 *    myinstants — no proxy through our backend), Import (downloads
 *    via backend + adds to local SFX library), and an external-link
 *    icon to the source page.
 *  - Import button shows a tag-picker popover so the user can
 *    classify the sound at import time. Defaults to no tags; user
 *    can re-tag via the library row's Edit button afterwards.
 *  - One-line copyright disclaimer below the controls — many
 *    myinstants sounds are clips of copyrighted media, so the user
 *    bears responsibility for verifying usage rights before publish.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, Download, ExternalLink, Search, Flame, Check } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Sound = { title: string; mp3_url: string; page_url: string };

const REGIONS: { code: string; label: string }[] = [
  { code: "us", label: "United States" },
  { code: "gb", label: "United Kingdom" },
  { code: "br", label: "Brazil" },
  { code: "mx", label: "Mexico" },
  { code: "de", label: "Germany" },
  { code: "fr", label: "France" },
  { code: "in", label: "India" },
  { code: "es", label: "Spain" },
];

interface Props {
  /** Tag vocabulary from the parent — passed in so we don't have to
   *  re-fetch the SFX list endpoint just for the tag picker. */
  vocab: string[];
  /** Called after a successful import so the parent can refresh its
   *  list of clips. */
  onImported?: () => void;
}

export function MyinstantsBrowser({ vocab, onImported }: Props) {
  const { toast } = useToast();

  const [mode, setMode] = useState<"trending" | "search">("trending");
  const [region, setRegion] = useState("us");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [sounds, setSounds] = useState<Sound[]>([]);
  const [loading, setLoading] = useState(false);

  // Track per-card playback + import state by mp3_url so cards
  // remount/reorder cleanly without losing state.
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);
  const [importedUrls, setImportedUrls] = useState<Set<string>>(new Set());

  // Debounce the search input — 350 ms feels responsive without
  // burning a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Stop playback before a refresh so the user doesn't end up
      // hearing a sound from a stale list.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
        setPlayingUrl(null);
      }
      setLoading(true);
      try {
        const r = mode === "trending"
          ? await api.myinstantsTrending(region, 30)
          : debouncedQuery
            ? await api.myinstantsSearch(debouncedQuery, 30)
            : { sounds: [] };
        if (!cancelled) setSounds(r.sounds);
      } catch (e: any) {
        if (!cancelled) {
          setSounds([]);
          toast({
            title: "Couldn't load sounds",
            description: e?.message || "Network error.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [mode, region, debouncedQuery, toast]);

  const togglePlay = (url: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingUrl === url) {
      setPlayingUrl(null);
      return;
    }
    // Stream directly from myinstants — no backend proxy needed for
    // playback (only the import path goes through our server, since
    // that's where we want the file ending up).
    const audio = new Audio(url);
    audio.addEventListener("ended", () => {
      setPlayingUrl(null);
      audioRef.current = null;
    });
    audio.addEventListener("error", () => {
      setPlayingUrl(null);
      audioRef.current = null;
      toast({
        title: "Preview failed",
        description: "Browser couldn't play this clip. Try Import instead.",
        variant: "destructive",
      });
    });
    audio.play().catch(() => {/* error handler above will fire */});
    audioRef.current = audio;
    setPlayingUrl(url);
  };

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 space-y-3">
        {/* Mode + region/search controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              size="sm"
              variant={mode === "trending" ? "default" : "ghost"}
              onClick={() => setMode("trending")}
              className="h-7 gap-1 text-[11px]"
            >
              <Flame className="h-3 w-3" /> Trending
            </Button>
            <Button
              size="sm"
              variant={mode === "search" ? "default" : "ghost"}
              onClick={() => setMode("search")}
              className="h-7 gap-1 text-[11px]"
            >
              <Search className="h-3 w-3" /> Search
            </Button>
          </div>

          {mode === "trending" ? (
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="h-7 text-xs bg-secondary border-border w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search myinstants…"
              className="h-7 text-xs bg-secondary border-border flex-1 max-w-md"
              autoFocus
            />
          )}

          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Disclaimer — kept small but always visible. The user is
            responsible for verifying their right to use a clip in
            monetized content; we just facilitate browsing. */}
        <p className="text-[10px] text-muted-foreground/80 leading-snug border-l-2 border-warning/40 pl-2">
          Many sounds on myinstants are clips of copyrighted media (movie quotes, song
          snippets, game audio). Verify usage rights before using in monetized content.
        </p>

        {/* Sound grid */}
        {sounds.length === 0 && !loading && (
          <p className="text-[11px] text-muted-foreground italic py-4 text-center">
            {mode === "search" && !debouncedQuery
              ? "Type a query to search."
              : "No sounds found."}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
          {sounds.map((s) => {
            const playing = playingUrl === s.mp3_url;
            const importing = importingUrl === s.mp3_url;
            const imported = importedUrls.has(s.mp3_url);
            return (
              <div
                key={s.mp3_url}
                className="rounded-md border border-border bg-secondary/30 p-2 flex items-center gap-2"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => togglePlay(s.mp3_url)}
                  title={playing ? "Stop" : "Preview"}
                >
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <p className="text-[11px] font-medium leading-tight truncate flex-1" title={s.title}>
                  {s.title}
                </p>
                <a
                  href={s.page_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Open source page on myinstants"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
                <ImportButton
                  sound={s}
                  vocab={vocab}
                  importing={importing}
                  imported={imported}
                  onImport={async (tags) => {
                    setImportingUrl(s.mp3_url);
                    try {
                      await api.myinstantsImport({
                        mp3_url: s.mp3_url,
                        name: s.title,
                        tags,
                      });
                      setImportedUrls((cur) => {
                        const next = new Set(cur);
                        next.add(s.mp3_url);
                        return next;
                      });
                      toast({ title: `Imported "${s.title.slice(0, 60)}"` });
                      onImported?.();
                    } catch (e: any) {
                      toast({
                        title: "Import failed",
                        description: e?.message,
                        variant: "destructive",
                      });
                    } finally {
                      setImportingUrl(null);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}


/**
 * Import button with a tag-picker popover. The user can pick zero or
 * more tags from the SFX vocabulary at import time so their library
 * is classified as it grows. Defaults to no tags — the user can
 * re-tag any clip later from its row's Edit button.
 */
function ImportButton({
  sound, vocab, importing, imported, onImport,
}: {
  sound: Sound;
  vocab: string[];
  importing: boolean;
  imported: boolean;
  onImport: (tags: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  if (imported) {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        className="h-7 px-2 gap-1 text-[10px] text-success"
        title="Already imported this session"
      >
        <Check className="h-3 w-3" /> Imported
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={importing}
          className="h-7 px-2 gap-1 text-[10px]"
          title="Pick tags + import to your SFX library"
        >
          {importing
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Download className="h-3 w-3" />}
          Import
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 space-y-2">
        <p className="text-[11px] font-medium leading-tight">Tag this clip (optional)</p>
        <div className="flex flex-wrap gap-1">
          {vocab.map((tag) => {
            const active = picked.has(tag);
            return (
              <button
                key={tag}
                onClick={() => setPicked((s) => {
                  const next = new Set(s);
                  if (next.has(tag)) next.delete(tag); else next.add(tag);
                  return next;
                })}
                className={cn(
                  "text-[10px] rounded px-1.5 py-0.5 border capitalize transition-colors",
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/30",
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          className="w-full gap-1 h-7 text-[11px]"
          onClick={async () => {
            await onImport([...picked]);
            setOpen(false);
            setPicked(new Set());
          }}
        >
          {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Import {picked.size > 0 && <Badge variant="outline" className="text-[9px] ml-1">{picked.size} tags</Badge>}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
