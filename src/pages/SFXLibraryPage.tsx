/**
 * Sound-effects library — upload, tag, preview, and delete short
 * audio stings (whooshes, dings, booms, etc) used to punctuate the
 * narration in renders.
 *
 * Mirrors the MusicLibraryPage shape closely on purpose — same
 * upload flow, same in-row edit pattern, same preview behaviour —
 * because users will think of these together ("audio assets") and
 * the muscle memory should carry over.
 *
 * Pipeline-level auto-placement (drop a `whoosh` at every scene cut,
 * `boom` at the climax) is a separate future feature. For now this
 * page is "manage your library" only.
 */
import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Upload, Trash2, Play, Pause, Save, Check, X } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { MyinstantsBrowser } from "@/components/MyinstantsBrowser";

type Clip = { filename: string; name: string; tags: string[]; added_at: string; size: number };

export default function SFXLibraryPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [vocab, setVocab] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playingFn, setPlayingFn] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [editingFn, setEditingFn] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState<Set<string>>(new Set());

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.listSfxClips();
      setClips(r.clips);
      setVocab(r.vocab);
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
      await api.uploadSfxClip(file, file.name.replace(/\.[^.]+$/, ""), []);
      toast({ title: "Clip uploaded" });
      refresh();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (c: Clip) => {
    setEditingFn(c.filename);
    setEditName(c.name);
    setEditTags(new Set(c.tags));
  };
  const cancelEdit = () => { setEditingFn(null); setEditName(""); setEditTags(new Set()); };
  const saveEdit = async () => {
    if (!editingFn) return;
    try {
      await api.updateSfxClip(editingFn, { name: editName, tags: [...editTags] });
      cancelEdit();
      refresh();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  const onDelete = async (filename: string) => {
    if (!confirm("Delete this clip?")) return;
    try {
      await api.deleteSfxClip(filename);
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const togglePlay = (filename: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingFn === filename) {
      setPlayingFn(null);
      return;
    }
    const audio = new Audio(api.sfxPreviewUrl(filename));
    audio.addEventListener("ended", () => { setPlayingFn(null); audioRef.current = null; });
    audio.play().catch((e) => toast({ title: "Playback failed", description: String(e), variant: "destructive" }));
    audioRef.current = audio;
    setPlayingFn(filename);
  };

  const fmtSize = (b: number) =>
    b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` :
    b > 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        icon={Volume2}
        title="Sound effects"
        subtitle="Short stingers (whooshes, dings, booms) for punctuating narration. Pipeline-level auto-placement is a future feature; this page is library management."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1.5"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload clip
            </Button>
          </>
        }
      />

      {/* Myinstants browse + import — embedded above the local
          library so users see it as the first option for "where do
          I get sounds." Refreshing the local list when an import
          completes keeps the two views in sync. */}
      <MyinstantsBrowser vocab={vocab} onImported={refresh} />

      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </CardContent>
        </Card>
      ) : clips.length === 0 ? (
        <Card className="border-dashed border-border bg-card">
          <CardContent className="py-12 text-center text-muted-foreground space-y-1">
            <p className="text-sm">No clips uploaded yet.</p>
            <p className="text-xs">Drop royalty-free SFX (mp3 / wav / m4a) and tag them with one or more shape categories.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clips.map((c) => {
            const isEditing = editingFn === c.filename;
            return (
              <Card key={c.filename} className="border-border bg-card">
                <CardContent className="p-3 space-y-2">
                  {isEditing ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Label className="text-[10px] text-muted-foreground w-10">Name</Label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-xs flex-1 bg-secondary border-border"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {vocab.map((tag) => {
                          const active = editTags.has(tag);
                          return (
                            <button
                              key={tag}
                              onClick={() => setEditTags((s) => {
                                const next = new Set(s);
                                if (next.has(tag)) next.delete(tag); else next.add(tag);
                                return next;
                              })}
                              className={cn(
                                "text-[10px] rounded px-1.5 py-0.5 border capitalize",
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
                      <div className="flex justify-end gap-2 pt-1">
                        <Button size="sm" variant="outline" onClick={cancelEdit} className="h-7 gap-1 text-[11px]">
                          <X className="h-3 w-3" /> Cancel
                        </Button>
                        <Button size="sm" onClick={saveEdit} className="h-7 gap-1 text-[11px]">
                          <Save className="h-3 w-3" /> Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => togglePlay(c.filename)}
                        title={playingFn === c.filename ? "Stop" : "Play"}
                      >
                        {playingFn === c.filename ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-tight truncate">{c.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {c.tags.length === 0 && (
                            <span className="text-[9px] text-muted-foreground italic">untagged</span>
                          )}
                          {c.tags.map((t) => (
                            <Badge key={t} variant="outline" className="text-[9px] capitalize">{t}</Badge>
                          ))}
                          <span className="text-[9px] text-muted-foreground ml-auto font-mono">{fmtSize(c.size)}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => startEdit(c)}>
                        Edit
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => onDelete(c.filename)}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
