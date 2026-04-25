import { useEffect, useRef, useState } from "react";
import {
  Music, Loader2, Upload, Trash2, Play, Pause, Save, Check, X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const TONES = ["dramatic", "funny", "heartfelt", "shocking", "cringe"] as const;
type Tone = typeof TONES[number];

type Track = { filename: string; name: string; moods: string[]; added_at: string; size_bytes: number };

/**
 * Music Library — upload, tag, preview, and delete background music
 * tracks. Tagging a track with one or more tones makes it eligible for
 * auto-pick during render: when Generate-with-AI emits a story with
 * tone="dramatic", the pipeline picks a random track tagged "dramatic"
 * and mixes it under the narration at the configured volume.
 */
export default function MusicLibraryPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playingFilename, setPlayingFilename] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Inline edit state — when non-null we show an editor row instead of the read row.
  const [editingFn, setEditingFn] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMoods, setEditMoods] = useState<Set<Tone>>(new Set());

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.listMusicTracks();
      setTracks(r.tracks);
    } catch (e: any) {
      toast({ title: "Couldn't load library", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(); }, []);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.uploadMusicTrack(file, file.name.replace(/\.[^.]+$/, ""), []);
      toast({ title: "Track uploaded" });
      refresh();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (t: Track) => {
    setEditingFn(t.filename);
    setEditName(t.name);
    setEditMoods(new Set(t.moods.filter((m): m is Tone => (TONES as readonly string[]).includes(m))));
  };
  const cancelEdit = () => {
    setEditingFn(null);
    setEditName("");
    setEditMoods(new Set());
  };
  const saveEdit = async (t: Track) => {
    try {
      await api.updateMusicTrack(t.filename, { name: editName, moods: Array.from(editMoods) });
      toast({ title: "Saved" });
      cancelEdit();
      refresh();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };
  const toggleMood = (m: Tone) => {
    setEditMoods((s) => {
      const next = new Set(s);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  const deleteTrack = async (t: Track) => {
    if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    try {
      await api.deleteMusicTrack(t.filename);
      toast({ title: "Deleted" });
      if (playingFilename === t.filename) {
        audioRef.current?.pause();
        setPlayingFilename(null);
      }
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const togglePlay = (t: Track) => {
    if (!audioRef.current) return;
    if (playingFilename === t.filename) {
      audioRef.current.pause();
      setPlayingFilename(null);
    } else {
      audioRef.current.src = api.musicPreviewUrl(t.filename);
      audioRef.current.play().catch(() => {});
      setPlayingFilename(t.filename);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        icon={Music}
        title="Music Library"
        subtitle="Upload royalty-free tracks, tag them by mood, and the render pipeline auto-picks a matching track per generated story."
      />

      {/* Upload bar */}
      <Card className="border-border bg-card">
        <CardContent className="p-3 flex items-center gap-3">
          <Music className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium">Upload a track</p>
            <p className="text-[10px] text-muted-foreground">
              MP3, WAV, M4A, AAC, FLAC, or OGG. Tag the mood after uploading.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
        </CardContent>
      </Card>

      {/* Library */}
      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </CardContent>
        </Card>
      ) : tracks.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground">
            <Music className="h-6 w-6 mx-auto mb-2 opacity-40" />
            Library is empty. Upload your first royalty-free track above.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border bg-card">
          <CardContent className="p-2 space-y-1">
            {tracks.map((t) => (
              <div
                key={t.filename}
                className={cn(
                  "rounded-md border p-2 transition-colors",
                  editingFn === t.filename ? "border-primary bg-primary/5" : "border-border bg-secondary/40",
                )}
              >
                {editingFn === t.filename ? (
                  // Editor row
                  <div className="space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-secondary border-border h-8 text-xs"
                      placeholder="Track name"
                    />
                    <div className="flex flex-wrap gap-1">
                      {TONES.map((m) => (
                        <Button
                          key={m}
                          size="sm"
                          variant={editMoods.has(m) ? "default" : "outline"}
                          className="h-6 text-[10px] capitalize"
                          onClick={() => toggleMood(m)}
                        >
                          {editMoods.has(m) && <Check className="h-2.5 w-2.5 mr-0.5" />}
                          {m}
                        </Button>
                      ))}
                    </div>
                    <div className="flex gap-1.5 justify-end">
                      <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-[10px] gap-1">
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(t)} className="h-7 text-[10px] gap-1">
                        <Save className="h-3 w-3" /> Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  // Read row
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => togglePlay(t)}
                      title={playingFilename === t.filename ? "Pause preview" : "Play preview"}
                    >
                      {playingFilename === t.filename
                        ? <Pause className="h-3.5 w-3.5 text-primary" />
                        : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <button
                      onClick={() => startEdit(t)}
                      className="flex-1 text-left min-w-0 hover:bg-background/40 rounded px-1.5 py-0.5"
                    >
                      <div className="text-xs font-medium truncate">{t.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {t.moods.length === 0 ? (
                          <span className="text-[9px] text-muted-foreground italic">untagged</span>
                        ) : (
                          t.moods.map((m) => (
                            <Badge key={m} variant="secondary" className="text-[9px] capitalize px-1.5 py-0">{m}</Badge>
                          ))
                        )}
                        <span className="text-[9px] text-muted-foreground ml-auto pr-2 font-mono">
                          {(t.size_bytes / 1_000_000).toFixed(1)} MB
                        </span>
                      </div>
                    </button>
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => deleteTrack(t)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground text-center">
        Mood tags map to the same five tones as Generate-with-AI: <b>dramatic / funny / heartfelt / shocking / cringe</b>.
        Enable auto-pick + set the mix volume in <code>Config → TTS → Background Music</code>.
      </p>

      {/* Hidden preview player */}
      <audio
        ref={audioRef}
        onEnded={() => setPlayingFilename(null)}
        hidden
      />
    </div>
  );
}
