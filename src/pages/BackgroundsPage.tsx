import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Folder, FolderPlus, Upload, Trash2, ChevronRight, Film, Loader2,
  PlayCircle, Home, AlertTriangle, FolderOpen, Move, ArrowUp,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Listing = Awaited<ReturnType<typeof api.listBackgrounds>>;

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * File-browser-style management for the `backgrounds/` folder.
 *
 * The pipeline picks a background per render; this page is where the user
 * curates the pool. Folders let you organize by theme (Minecraft parkour,
 * subway surfers, GTA, etc.) and the Config → Video 'Default background'
 * dropdown points at any folder — or the root for random-across-everything.
 */
export default function BackgroundsPage() {
  const { toast } = useToast();
  const [cwd, setCwd] = useState<string>("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);

  // Uploads
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; pct: number }[]>([]);

  // Dialogs
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [previewVideo, setPreviewVideo] = useState<{ name: string; path: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "file" | "folder"; name: string; path: string; recursive: boolean } | null>(null);

  // Move dialog (manual picker, alternative to drag-and-drop)
  const [movePrompt, setMovePrompt] = useState<{ src_path: string; name: string } | null>(null);
  const [moveDest, setMoveDest] = useState<string>("");
  const [allFolders, setAllFolders] = useState<{ path: string; name: string; video_count: number }[]>([]);
  const refreshFolders = async () => {
    try {
      const r = await api.listBackgroundFolders();
      setAllFolders(r.folders);
    } catch {}
  };

  // Drag state for visual drop highlights
  const [dragSrc, setDragSrc] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder rel path being hovered

  const moveFile = async (src_path: string, dest_folder: string) => {
    try {
      await api.moveBackground(src_path, dest_folder);
      toast({
        title: "Moved",
        description: dest_folder ? `→ ${dest_folder}` : "→ backgrounds root",
      });
      refresh();
      refreshFolders();
    } catch (e: any) {
      toast({ title: "Move failed", description: e.message, variant: "destructive" });
    }
  };

  const refresh = async (path = cwd) => {
    setLoading(true);
    try {
      const r = await api.listBackgrounds(path);
      setListing(r);
      setCwd(r.path);
    } catch (e: any) {
      toast({ title: "Couldn't list backgrounds", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refresh(""); refreshFolders(); }, []);

  // Breadcrumb segments
  const crumbs = cwd ? cwd.split("/") : [];

  // ── Upload handling ─────────────────────────────────────────────────
  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const queue = Array.from(files);
    for (const f of queue) {
      setUploading((cur) => [...cur, { name: f.name, pct: 0 }]);
      try {
        await api.uploadBackground(f, cwd, (pct) => {
          setUploading((cur) =>
            cur.map((u) => (u.name === f.name ? { ...u, pct: pct * 100 } : u))
          );
        });
      } catch (e: any) {
        toast({ title: `Upload failed: ${f.name}`, description: e.message, variant: "destructive" });
      }
      setUploading((cur) => cur.filter((u) => u.name !== f.name));
    }
    toast({ title: `Uploaded ${queue.length} file${queue.length === 1 ? "" : "s"}` });
    refresh();
  };

  // Drag-and-drop — anywhere on the card
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // ── Folder ops ──────────────────────────────────────────────────────
  const createFolder = async () => {
    const name = mkdirName.trim();
    if (!name) return;
    if (/[\\/]/.test(name)) {
      toast({ title: "Folder name can't contain slashes", variant: "destructive" });
      return;
    }
    const target = cwd ? `${cwd}/${name}` : name;
    try {
      await api.createBackgroundFolder(target);
      toast({ title: "Folder created" });
      setMkdirName("");
      setMkdirOpen(false);
      refresh();
    } catch (e: any) {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.kind === "file") {
        await api.deleteBackground(confirmDelete.path);
      } else {
        await api.deleteBackgroundFolder(confirmDelete.path, confirmDelete.recursive);
      }
      toast({ title: `Deleted "${confirmDelete.name}"` });
      setConfirmDelete(null);
      refresh();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold">Backgrounds</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Upload and organize the footage the pipeline picks from. Each render
            uses one clip; set a default folder in <strong>Config → Video</strong>, or
            leave it on "All backgrounds — random".
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMkdirOpen(true)} className="gap-1">
            <FolderPlus className="h-3.5 w-3.5" /> New folder
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1">
            <Upload className="h-3.5 w-3.5" /> Upload videos
          </Button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
        <button
          onClick={() => refresh("")}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-secondary/60 ${!cwd ? "text-primary" : ""}`}
        >
          <Home className="h-3 w-3" /> backgrounds
        </button>
        {crumbs.map((seg, i) => {
          const p = crumbs.slice(0, i + 1).join("/");
          const isLast = i === crumbs.length - 1;
          return (
            <span key={p} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => !isLast && refresh(p)}
                className={`px-1.5 py-0.5 rounded hover:bg-secondary/60 ${isLast ? "text-foreground" : ""}`}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>

      {/* Drop zone / file grid */}
      <Card
        className={`border-border bg-card transition-colors ${dragOver ? "border-primary bg-primary/5" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <CardContent className="p-4 space-y-3">
          {loading && !listing ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : listing && (listing.folders.length === 0 && listing.videos.length === 0) ? (
            <div
              className="py-16 text-center text-muted-foreground space-y-2 cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderOpen className="h-10 w-10 mx-auto opacity-30" />
              <p className="text-sm font-medium">Empty folder</p>
              <p className="text-xs">Drag videos here or click <strong>Upload</strong>.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Parent-folder drop target — appears when we're not at the root,
                  so dragging a video onto it moves it one level up. */}
              {cwd && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget("__parent__"); }}
                  onDragLeave={() => setDropTarget((cur) => cur === "__parent__" ? null : cur)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const src = e.dataTransfer.getData("text/reels-bg");
                    if (src) {
                      const parent = listing?.parent ?? "";
                      moveFile(src, parent);
                    }
                  }}
                  className={`relative rounded-md border border-dashed p-3 transition-all cursor-pointer
                    ${dropTarget === "__parent__" ? "border-primary bg-primary/10 scale-[1.02]" : "border-border bg-secondary/10 hover:border-primary/40"}`}
                  onClick={() => refresh(listing?.parent ?? "")}
                  title="Drop here to move up, or click to navigate"
                >
                  <div className="flex items-center gap-2">
                    <ArrowUp className="h-6 w-6 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">..</p>
                      <p className="text-[10px] text-muted-foreground">
                        up to {listing?.parent ? `/${listing.parent}` : "backgrounds root"}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Folders — drop target for videos in current directory */}
              {listing?.folders.map((f) => {
                const isTarget = dropTarget === f.path;
                return (
                <motion.div
                  key={`d-${f.path}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onDragOver={(e) => { e.preventDefault(); setDropTarget(f.path); }}
                  onDragLeave={() => setDropTarget((cur) => cur === f.path ? null : cur)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const src = e.dataTransfer.getData("text/reels-bg");
                    if (src && !src.startsWith(f.path + "/") && src !== f.path) {
                      moveFile(src, f.path);
                    }
                  }}
                  className={`group relative rounded-md border p-3 transition-all
                    ${isTarget
                      ? "border-primary bg-primary/10 scale-[1.02]"
                      : "border-border bg-secondary/30 hover:border-primary/40"}`}
                >
                  <button
                    onClick={() => refresh(f.path)}
                    className="w-full flex items-center gap-2 text-left"
                  >
                    <Folder className={`h-6 w-6 shrink-0 ${isTarget ? "text-primary" : "text-primary/80"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{f.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {isTarget ? "drop to move here" : `${f.video_count} video${f.video_count === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ kind: "folder", name: f.name, path: f.path, recursive: f.video_count > 0 });
                    }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded hover:bg-destructive/20 text-destructive"
                    title="Delete folder"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </motion.div>
              );})}

              {/* Videos — draggable */}
              {listing?.videos.map((v) => {
                const isDragging = dragSrc === v.path;
                return (
                <motion.div
                  key={`v-${v.path}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: isDragging ? 0.4 : 1, y: 0 }}
                  draggable
                  onDragStart={(e) => {
                    const ev = e as unknown as React.DragEvent;
                    ev.dataTransfer.setData("text/reels-bg", v.path);
                    ev.dataTransfer.effectAllowed = "move";
                    setDragSrc(v.path);
                  }}
                  onDragEnd={() => { setDragSrc(null); setDropTarget(null); }}
                  className="group relative rounded-md border border-border bg-secondary/30 overflow-hidden hover:border-primary/40 transition-all cursor-grab active:cursor-grabbing"
                >
                  <button
                    onClick={() => setPreviewVideo(v)}
                    className="w-full"
                  >
                    <div className="aspect-video bg-black flex items-center justify-center relative">
                      <video
                        src={api.backgroundPreviewUrl(v.path)}
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                        preload="metadata"
                        muted
                      />
                      <PlayCircle className="h-8 w-8 text-white/80 drop-shadow z-10 group-hover:scale-110 transition-transform pointer-events-none" />
                    </div>
                    <div className="px-2 py-1.5 text-left">
                      <p className="text-[11px] font-medium truncate">{v.name}</p>
                      <p className="text-[9px] text-muted-foreground font-mono">{fmtSize(v.size)}</p>
                    </div>
                  </button>
                  {/* Move button — fallback for when drag is inconvenient */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      refreshFolders();
                      setMoveDest("");
                      setMovePrompt({ src_path: v.path, name: v.name });
                    }}
                    className="absolute top-1 right-8 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded bg-background/80 hover:bg-primary/20 text-primary"
                    title="Move to another folder…"
                  >
                    <Move className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ kind: "file", name: v.name, path: v.path, recursive: false });
                    }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 flex items-center justify-center rounded bg-background/80 hover:bg-destructive/20 text-destructive"
                    title="Delete video"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </motion.div>
              );})}
            </div>
          )}

          {/* Upload progress */}
          {uploading.length > 0 && (
            <div className="space-y-1.5 pt-3 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground">Uploading…</p>
              {uploading.map((u) => (
                <div key={u.name} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="truncate">{u.name}</span>
                    <span className="font-mono text-muted-foreground">{Math.round(u.pct)}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${u.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {listing && (listing.videos.length + listing.folders.length) > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Tip: drag a video onto a folder to move it there, or hover a video and click the
          <Move className="h-2.5 w-2.5 inline mx-0.5" /> icon for a folder picker. Drop multiple
          files anywhere on this card to upload in batches.
          {cwd && <> · Currently inside <code>backgrounds/{cwd}</code>.</>}
        </p>
      )}

      {/* New folder dialog */}
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription className="text-xs">
              Creates a folder inside <code>backgrounds/{cwd || ""}</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFolder()}
              placeholder="minecraft-parkour"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>Cancel</Button>
            <Button onClick={createFolder} disabled={!mkdirName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video preview dialog */}
      <Dialog open={!!previewVideo} onOpenChange={(o) => !o && setPreviewVideo(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Film className="h-4 w-4" /> {previewVideo?.name}
            </DialogTitle>
            <DialogDescription className="text-xs font-mono">
              {previewVideo?.path}
            </DialogDescription>
          </DialogHeader>
          {previewVideo && (
            <video
              src={api.backgroundPreviewUrl(previewVideo.path)}
              controls
              autoPlay
              className="w-full rounded-md bg-black max-h-[60vh]"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Move dialog (fallback for when drag-and-drop isn't convenient) */}
      <Dialog open={!!movePrompt} onOpenChange={(o) => !o && setMovePrompt(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Move className="h-4 w-4 text-primary" />
              Move "{movePrompt?.name}"
            </DialogTitle>
            <DialogDescription className="text-xs">
              Pick the destination folder. Leave on "root" to move to the top level.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Destination folder</Label>
            <Select value={moveDest || "__root__"} onValueChange={(v) => setMoveDest(v === "__root__" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="__root__">📂 backgrounds (root)</SelectItem>
                {allFolders.filter((f) => f.path).map((f) => (
                  <SelectItem key={f.path} value={f.path}>
                    📁 {f.name} <span className="text-muted-foreground">({f.video_count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovePrompt(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!movePrompt) return;
                await moveFile(movePrompt.src_path, moveDest);
                setMovePrompt(null);
              }}
            >
              Move here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={
          confirmDelete?.kind === "folder"
            ? `Delete folder "${confirmDelete.name}"?`
            : `Delete "${confirmDelete?.name}"?`
        }
        icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        description={
          confirmDelete?.kind === "folder"
            ? confirmDelete.recursive
              ? <>This folder contains videos. <strong>All of them will be deleted</strong> along with the folder. Cannot be undone.</>
              : <>Remove this empty folder. Cannot be undone.</>
            : <>Permanently deletes <code>backgrounds/{confirmDelete?.path}</code> from disk.</>
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={doDelete}
      />
    </motion.div>
  );
}
