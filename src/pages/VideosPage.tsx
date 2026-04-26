import { useState } from "react";
import { motion } from "framer-motion";
import {
  Play, Clock, CheckCircle2, XCircle, Loader2, Film, Trash2,
  Download, Eye, HardDrive, Layers, RefreshCw, Share2, AlertTriangle, Youtube, Tag,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useBrand } from "@/contexts/BrandContext";
import { useQueryClient } from "@tanstack/react-query";
import { SocialCopyDialog } from "@/components/SocialCopyDialog";
import { YouTubeUploadDialog } from "@/components/YouTubeUploadDialog";
import { VideoBatchActionBar } from "@/components/VideoBatchActionBar";
import { FullRedoDialog } from "@/components/FullRedoDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { useVideos, useUsedPosts, useDeleteVideo, useResumeVideo } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatDistanceToNow } from "@/lib/format-time";
import { useToast } from "@/hooks/use-toast";
import type { VideoRecord } from "@/lib/api";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:8000");

function formatFileSize(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function VideoCard({ video, index, onPreview, onDelete, onSetApproval, selected, onSelectChange }: {
  video: VideoRecord; index: number;
  onPreview: (video: VideoRecord, part: number) => void;
  onDelete: (video: VideoRecord) => void;
  onSetApproval?: (id: string, status: "pending" | "approved" | "rejected") => void;
  selected?: boolean;
  onSelectChange?: (checked: boolean) => void;
}) {
  const approval = ((video as any).approval || "pending") as "pending" | "approved" | "rejected";
  const partCount = video.part_files?.length || (video.parts ?? (video.has_video ? 1 : 0));
  const resumeMutation = useResumeVideo();
  const { toast } = useToast();
  const [socialOpen, setSocialOpen] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [rerenderConfirmOpen, setRerenderConfirmOpen] = useState(false);
  const handleRerender = () => {
    resumeMutation.mutate(video.id, {
      onSuccess: () => toast({
        title: "Re-rendering video",
        description: "Using existing audio — new captions/video settings only. No TTS charges.",
      }),
      onError: (err) => toast({ title: "Re-render failed", description: err.message, variant: "destructive" }),
    });
  };

  // Extract display label and sort number from filename e.g. "xxx_part1.mp4" → "Part 1"
  const getPartLabel = (idx: number) => {
    const filename = video.part_files?.[idx];
    if (filename) {
      const match = filename.match(/_part(\d+)\.mp4$/i);
      if (match) return `Part ${match[1]}`;
    }
    return `Part ${idx + 1}`;
  };

  const getPartNum = (idx: number) => {
    const filename = video.part_files?.[idx];
    const match = filename?.match(/_part(\d+)\.mp4$/i);
    return match ? parseInt(match[1], 10) : idx + 1;
  };

  // Sorted indices by part number
  const sortedIndices = Array.from({ length: partCount }, (_, i) => i)
    .sort((a, b) => getPartNum(a) - getPartNum(b));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
    >
      <Card className={`border-border bg-card hover:border-primary/30 transition-all overflow-hidden ${selected ? "ring-2 ring-primary border-primary/60" : ""}`}>
        <div className="relative h-36 bg-secondary flex items-center justify-center overflow-hidden">
          {onSelectChange && (
            <label
              className={`absolute top-2 left-2 z-10 flex items-center justify-center h-5 w-5 rounded border cursor-pointer bg-background/80 backdrop-blur ${selected ? "border-primary bg-primary/20" : "border-border"}`}
              onClick={(e) => e.stopPropagation()}
              title={selected ? "Deselect" : "Select for batch actions"}
            >
              <input
                type="checkbox"
                checked={selected || false}
                onChange={(e) => onSelectChange(e.target.checked)}
                className="h-3 w-3 accent-primary"
              />
            </label>
          )}
          {video.has_thumbnails ? (
            <img
              src={`${API_BASE}/api/videos/${video.id}/thumbnail?part=0&v=${encodeURIComponent(video.created_at || "")}`}
              alt={video.title}
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10" />
              <Play className="h-10 w-10 text-foreground/30" />
            </>
          )}
          <Badge
            variant={video.status === "published" ? "default" : "destructive"}
            className="absolute top-2 right-2 text-[10px] gap-1"
          >
            {video.status === "published" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {video.status}
          </Badge>

          {/* Approval badge — left-aligned, below the select checkbox.
              Color-coded: amber=pending, green=approved, red=rejected. */}
          {video.has_video && (
            <Badge
              variant="outline"
              className={`absolute top-2 left-9 text-[9px] gap-1 ${
                approval === "approved" ? "border-success/50 text-success bg-success/10" :
                approval === "rejected" ? "border-destructive/50 text-destructive bg-destructive/10" :
                "border-warning/50 text-warning bg-warning/10"
              }`}
              title={`Approval: ${approval}`}
            >
              {approval === "approved" ? "✓ Approved" :
               approval === "rejected" ? "✗ Rejected" : "Pending review"}
            </Badge>
          )}
          {video.render_time_s && (
            <span className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono">
              {video.render_time_s}s render
            </span>
          )}
        </div>

        <CardContent className="p-4 space-y-2">
          <h3 className="text-xs font-semibold line-clamp-2 leading-snug">{video.title}</h3>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">r/{video.subreddit}</span>
            <span>▲ {video.score.toLocaleString()}</span>
            <span>💬 {video.num_comments}</span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {partCount > 1 && (
              <span className="flex items-center gap-0.5">
                <Layers className="h-3 w-3" /> {partCount} parts
              </span>
            )}
            {video.file_size_bytes && (
              <span className="flex items-center gap-0.5">
                <HardDrive className="h-3 w-3" /> {formatFileSize(video.file_size_bytes)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {video.created_at
              ? formatDistanceToNow(new Date(video.created_at), { addSuffix: true })
              : "—"}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {video.has_audio && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Audio</Badge>}
            {video.has_video && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Video</Badge>}
            {video.has_social && (
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 border-primary/40 text-primary"
                title="Social copy already generated and saved to disk"
              >
                ✨ Social
              </Badge>
            )}
            {video.brand_name && (
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 gap-1"
                style={{
                  borderColor: video.brand_color ? `${video.brand_color}60` : undefined,
                  color: video.brand_color || undefined,
                }}
                title={`Rendered with brand: ${video.brand_name}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full inline-block"
                  style={{ backgroundColor: video.brand_color || "#888" }}
                />
                {video.brand_name}
              </Badge>
            )}
          </div>

          {/* Per-part buttons */}
          {video.has_video && (
            <div className="space-y-1.5 pt-2 border-t border-border mt-2">
              {partCount > 1 ? (
                sortedIndices.map((i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <span className="text-[10px] text-muted-foreground w-12 shrink-0">{getPartLabel(i)}</span>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 flex-1"
                      onClick={() => onPreview(video, i)}>
                      <Eye className="h-3 w-3" /> Preview
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 flex-1"
                      onClick={() => window.open(`${API_BASE}/api/videos/${video.id}/download?part=${i}`, "_blank")}>
                      <Download className="h-3 w-3" /> Download
                    </Button>
                  </div>
                ))
              ) : (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
                    onClick={() => onPreview(video, 0)}>
                    <Eye className="h-3 w-3" /> Preview
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
                    onClick={() => window.open(`${API_BASE}/api/videos/${video.id}/download?part=0`, "_blank")}>
                    <Download className="h-3 w-3" /> Download
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1 gap-1">
            <div className="flex items-center gap-1">
              {video.has_audio ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 px-2 border-accent/40 text-accent hover:bg-accent/10"
                  onClick={() => setRerenderConfirmOpen(true)}
                  disabled={resumeMutation.isPending}
                  title="Re-render this video using current caption & video settings. Reuses existing audio — no TTS charges."
                >
                  <RefreshCw className="h-3 w-3" />
                  {resumeMutation.isPending ? "Re-rendering..." : "Re-render"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled
                  className="h-7 text-[10px] gap-1 px-2 opacity-50 cursor-not-allowed"
                  title="Audio from this render wasn't preserved (legacy video made before the project registry). Run a fresh pipeline to produce a re-renderable copy."
                >
                  <RefreshCw className="h-3 w-3" />
                  No audio
                </Button>
              )}
              {/* Full Redo only makes sense for real Reddit post IDs (alphanumeric,
                  ≤12 chars). Loose legacy mp4s have filename-shaped ids that
                  the pipeline can't re-fetch from Reddit. */}
              {video.id && /^[a-z0-9]{1,12}$/i.test(video.id) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 px-2 border-warning/40 text-warning hover:bg-warning/10"
                  onClick={() => setRedoOpen(true)}
                  title="Re-run the entire pipeline for this post from scratch (uses TTS credits). Lets you change voice and narrator gender."
                >
                  <RefreshCw className="h-3 w-3" />
                  Full Redo
                </Button>
              )}
              {video.has_video && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 px-2 border-primary/40 text-primary hover:bg-primary/10"
                  onClick={() => setSocialOpen(true)}
                  title="Generate YouTube / TikTok / Instagram captions & hashtags"
                >
                  <Share2 className="h-3 w-3" />
                  Social Copy
                </Button>
              )}
              {video.has_video && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] gap-1 px-2 border-[#ff0000]/40 text-[#ff0000] hover:bg-[#ff0000]/10"
                  onClick={() => setYtOpen(true)}
                  title="Upload to YouTube Shorts — supports scheduled release on YouTube's side"
                >
                  <Youtube className="h-3 w-3" />
                  YouTube
                </Button>
              )}
            </div>
            {/* Approval buttons — only useful when there's a video
                to approve. The current state's button is hidden so
                clicking can only TOGGLE or move forward. */}
            {video.has_video && onSetApproval && (
              <div className="flex items-center gap-1 ml-1">
                {approval !== "approved" && (
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-success hover:text-success hover:bg-success/10"
                    title="Approve for publish"
                    onClick={() => onSetApproval(video.id, "approved")}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                  </Button>
                )}
                {approval !== "rejected" && (
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Reject (hide from default view)"
                    onClick={() => onSetApproval(video.id, "rejected")}
                  >
                    <XCircle className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive"
              onClick={() => onDelete(video)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <SocialCopyDialog
            postId={video.id}
            title={video.title}
            open={socialOpen}
            onOpenChange={setSocialOpen}
          />
          <YouTubeUploadDialog
            videoId={video.id}
            videoTitle={video.title}
            open={ytOpen}
            onOpenChange={setYtOpen}
          />
          <FullRedoDialog
            postId={video.id}
            title={video.title}
            open={redoOpen}
            onOpenChange={setRedoOpen}
          />
          <ConfirmDialog
            open={rerenderConfirmOpen}
            onOpenChange={setRerenderConfirmOpen}
            title="Re-render this video?"
            icon={<RefreshCw className="h-4 w-4 text-accent" />}
            description={
              <>
                Re-runs <strong>just the video step</strong> on "<strong>{video.title}</strong>" using
                the existing TTS audio. Your current caption / video / font / animation settings will
                apply. This <strong>does not</strong> spend TTS credits. Takes ~30-60s on GPU.
              </>
            }
            confirmLabel="Re-render"
            onConfirm={() => {
              setRerenderConfirmOpen(false);
              handleRerender();
            }}
            isLoading={resumeMutation.isPending}
          />
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function VideosPage() {
  const { data, isLoading } = useVideos();
  const { data: usedData } = useUsedPosts();
  const deleteMutation = useDeleteVideo();
  const { toast } = useToast();
  const videos = data?.videos ?? [];
  const usedPosts = usedData?.used_posts ?? [];

  const [preview, setPreview] = useState<{ video: VideoRecord; part: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoRecord | null>(null);

  // Batch selection — drives the floating action bar.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelection = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  // "Clear all data" dialog state
  const qc = useQueryClient();
  const [clearOpen, setClearOpen]       = useState(false);
  const [clearPosts, setClearPosts]     = useState(true);
  const [clearVideos, setClearVideos]   = useState(true);
  const [clearHistory, setClearHistory] = useState(true);
  const [clearRegistry, setClearRegistry] = useState(true);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [clearing, setClearing]         = useState(false);
  const clearReady = clearConfirmText === "DELETE" &&
    (clearPosts || clearVideos || clearHistory || clearRegistry);

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const r = await api.clearAllData({
        posts: clearPosts, videos: clearVideos,
        history: clearHistory, registry: clearRegistry,
        confirm: "DELETE",
      });
      toast({
        title: "Data cleared",
        description: r.errors?.length
          ? `${r.removed_paths.length} path(s) removed, ${r.errors.length} error(s). Check server log.`
          : `${r.removed_paths.length} path(s) removed.`,
        variant: r.errors?.length ? "destructive" : "default",
      });
      setClearOpen(false);
      setClearConfirmText("");
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["used-posts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e: any) {
      toast({ title: "Clear failed", description: e.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const published = videos.filter((v) => v.status === "published").length;
  const failed = videos.filter((v) => v.status === "failed").length;

  // ── Brand filter ──────────────────────────────────────────────
  // "__all__" = no filter, "__none__" = legacy/untagged rows only,
  // anything else = a brand_id. Persisted in component state only —
  // intentionally not URL-shared so different tabs can filter separately.
  const { brands } = useBrand();
  const [brandFilter, setBrandFilter] = useState<string>("__all__");
  // Approval filter: review-mode workflow. "pending" surfaces only
  // videos that haven't been reviewed yet — useful for batch review
  // after an overnight render run.
  const [approvalFilter, setApprovalFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const filteredVideos = videos.filter((v) => {
    if (brandFilter === "__none__" && v.brand_id) return false;
    if (brandFilter !== "__all__" && brandFilter !== "__none__" && v.brand_id !== brandFilter) return false;
    if (approvalFilter !== "all") {
      const a = (v as any).approval || "pending";
      if (a !== approvalFilter) return false;
    }
    return true;
  });

  const setApproval = async (id: string, status: "pending" | "approved" | "rejected") => {
    try {
      await api.setVideoApproval(id, status);
      // Optimistic update on the cached query data — videos are owned
      // by React Query, not local component state.
      qc.setQueryData(["videos"], (old: any) => {
        if (!old?.videos) return old;
        return {
          ...old,
          videos: old.videos.map((v: any) =>
            v.id === id ? { ...v, approval: status, approval_at: new Date().toISOString() } : v,
          ),
        };
      });
      toast({
        title: status === "approved" ? "Approved ✓" : status === "rejected" ? "Rejected" : "Marked pending",
        description: status === "approved"
          ? "Ready to publish."
          : status === "rejected"
            ? "Hidden from default view."
            : undefined,
      });
    } catch (e: any) {
      toast({ title: "Couldn't update approval", description: e?.message, variant: "destructive" });
    }
  };

  const handleDelete = (keepFiles: boolean) => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ id: deleteTarget.id, keep_files: keepFiles }, {
      onSuccess: (r) => {
        toast({
          title: keepFiles ? "Removed from list" : "Deleted",
          description: keepFiles
            ? "Files kept on disk."
            : r.files_deleted ? `${r.files_deleted} path(s) removed.` : "No files found on disk.",
        });
        setDeleteTarget(null);
      },
      onError: (e) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Video History</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {brandFilter === "__all__" ? videos.length : filteredVideos.length} {brandFilter !== "__all__" && `of ${videos.length}`} videos
            {" · "}{published} published · {failed} failed
            {usedPosts.length > 0 && ` · ${usedPosts.length} posts used`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Brand filter — visible only when at least one brand exists.
              Two pseudo-options bookend the real list: "All brands" and
              "No brand (legacy)". */}
          {/* Approval filter — surfaces pending-review backlog. */}
          <Select value={approvalFilter} onValueChange={(v) => setApprovalFilter(v as typeof approvalFilter)}>
            <SelectTrigger className="h-8 text-xs bg-secondary border-border w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All approvals</SelectItem>
              <SelectItem value="pending">Pending review</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          {brands.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Tag className="h-3 w-3 text-muted-foreground" />
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All brands</SelectItem>
                  <SelectItem value="__none__">No brand / legacy</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full inline-block"
                          style={{ backgroundColor: b.color }}
                        />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={() => setClearOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear data…
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Film className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">No videos generated yet</p>
            <p className="text-xs mt-1">Run the pipeline from the Dashboard to create your first video</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredVideos.map((video, i) => (
          <VideoCard
            key={video.id} video={video} index={i}
            onPreview={(v, part) => setPreview({ video: v, part })}
            onDelete={setDeleteTarget}
            onSetApproval={setApproval}
            selected={selectedIds.has(video.id)}
            onSelectChange={(checked) => toggleSelection(video.id, checked)}
          />
        ))}
      </div>

      <VideoBatchActionBar
        videos={videos}
        selectedIds={selectedIds}
        onClear={() => setSelectedIds(new Set())}
        onAllSelected={() => setSelectedIds(new Set(videos.filter((v) => v.has_video).map((v) => v.id)))}
      />

      {usedPosts.length > 0 && (
        <div className="space-y-3 pt-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Used Post IDs</h3>
          <div className="flex flex-wrap gap-1.5">
            {usedPosts.map((id) => (
              <Badge key={id} variant="secondary" className="font-mono text-[10px]">{id}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">{preview?.video.title}</DialogTitle>
            <DialogDescription className="text-xs">
              r/{preview?.video.subreddit} · {preview?.video.status}
              {(preview?.video.part_files?.length ?? 0) > 1 &&
                (() => {
                  const f = preview?.video.part_files?.[preview?.part ?? 0];
                  const m = f?.match(/_part(\d+)\.mp4$/i);
                  const label = m ? `Part ${m[1]}` : `Part ${(preview?.part ?? 0) + 1}`;
                  return ` · ${label} of ${preview?.video.part_files?.length}`;
                })()}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <video
                key={`${preview.video.id}-${preview.part}`}
                controls autoPlay
                className="w-full rounded-lg bg-secondary max-h-[50vh]"
                src={`${API_BASE}/api/videos/${preview.video.id}/stream?part=${preview.part}&v=${encodeURIComponent(preview.video.created_at || "")}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                {(preview.video.part_files?.length ?? 0) > 1 && (
                  <div className="flex flex-wrap gap-1 mr-auto">
                    {Array.from({ length: preview.video.part_files!.length }, (_, i) => {
                      const f = preview.video.part_files![i];
                      const m = f?.match(/_part(\d+)\.mp4$/i);
                      const num = m ? parseInt(m[1], 10) : i + 1;
                      const label = m ? `Part ${m[1]}` : `Part ${i + 1}`;
                      return { idx: i, num, label };
                    })
                      .sort((a, b) => a.num - b.num)
                      .map(({ idx, label }) => (
                        <Button key={idx} size="sm"
                          variant={idx === preview.part ? "default" : "outline"}
                          className="h-7 text-xs px-2.5"
                          onClick={() => setPreview({ ...preview, part: idx })}
                        >
                          {label}
                        </Button>
                      ))}
                  </div>
                )}
                <Button size="sm" variant="outline" className="gap-1"
                  onClick={() => window.open(`${API_BASE}/api/videos/${preview.video.id}/download?part=${preview.part}`, "_blank")}>
                  <Download className="h-3 w-3" /> Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.title}"</DialogTitle>
            <DialogDescription className="text-xs">
              Choose what to remove. This only affects this single entry — sibling videos with
              similar titles are not touched.
            </DialogDescription>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground space-y-1 pb-1">
            <p><strong className="text-foreground">Remove from list</strong> — leaves every file on disk (useful if you're reshuffling the list).</p>
            <p><strong className="text-foreground">Delete files too</strong> — removes the .mp4(s), thumbnail, and <code>posts/&lt;id&gt;/</code> workspace. Irreversible.</p>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="outline"
              className="border-warning text-warning hover:bg-warning/10"
              onClick={() => handleDelete(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> List only
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDelete(false)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete files too
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear-all / Nuke confirmation */}
      <Dialog open={clearOpen} onOpenChange={(v) => { if (!clearing) setClearOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Clear data
            </DialogTitle>
            <DialogDescription className="text-xs">
              Wipes selected data from disk and memory. This is irreversible — consider backing up
              <code className="mx-1">videos/</code>first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-1">
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium">Rendered videos & preserved audio</div>
                <div className="text-[10px] text-muted-foreground">
                  Deletes <code>videos/</code> — all .mp4 files and <code>videos/proj_*</code> (audio + timeline needed for Re-render).
                </div>
              </div>
              <Switch checked={clearVideos} onCheckedChange={setClearVideos} />
            </label>

            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium">Post workspace</div>
                <div className="text-[10px] text-muted-foreground">
                  Deletes <code>posts/</code> — raw Reddit fetches, TTS audio waits, timelines, whisper caches, social copy, viral scores.
                </div>
              </div>
              <Switch checked={clearPosts} onCheckedChange={setClearPosts} />
            </label>

            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium">Project registry</div>
                <div className="text-[10px] text-muted-foreground">
                  Deletes <code>projects.json</code>. The Videos page will rebuild from whatever mp4s remain on disk.
                </div>
              </div>
              <Switch checked={clearRegistry} onCheckedChange={setClearRegistry} />
            </label>

            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-xs font-medium">Post history</div>
                <div className="text-[10px] text-muted-foreground">
                  Resets <code>used_posts.json</code> so the pipeline can re-pick posts it already used. Also zeroes dashboard counters.
                </div>
              </div>
              <Switch checked={clearHistory} onCheckedChange={setClearHistory} />
            </label>
          </div>

          <div className="pt-1 space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-destructive">
              Type DELETE to confirm
            </Label>
            <Input
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-8 text-xs font-mono bg-secondary border-border"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClearOpen(false)} disabled={clearing}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleClearAll}
              disabled={!clearReady || clearing}
            >
              {clearing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Clear selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
