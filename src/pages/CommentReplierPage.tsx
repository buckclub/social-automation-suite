import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppEvent } from "@/lib/eventBus";
import { useNavigate } from "react-router-dom";
import {
  MessageCircle, Loader2, RefreshCw, Send, Trash2, Check, X,
  ExternalLink, AlertTriangle, Pencil, Filter,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBrand } from "@/contexts/BrandContext";
import { api, type CommentDraft } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<CommentDraft["status"], string> = {
  draft:    "border-primary/40 text-primary",
  posted:   "border-success/40 text-success",
  rejected: "border-muted-foreground/30 text-muted-foreground",
  failed:   "border-destructive/40 text-destructive",
};

/**
 * Comment Replier — pulls top-level comments from your tracked YouTube
 * uploads, drafts replies in the active brand voice, and (with OAuth)
 * posts the approved replies via the YouTube Data API.
 */
export default function CommentReplierPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { brands } = useBrand();
  const [drafts, setDrafts] = useState<CommentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "posted" | "rejected" | "failed">("draft");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listCommentDrafts();
      setDrafts(r.drafts || []);
    } catch (e: any) {
      toast({ title: "Couldn't load drafts", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { refresh(); }, [refresh]);
  // Live updates whenever the worker mutates drafts (sync, post, reject).
  useAppEvent("comment_drafts.update", refresh);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncCommentDrafts({ max_videos: 5, max_per_video: 15 });
      toast({
        title: r.added ? `+${r.added} new draft${r.added === 1 ? "" : "s"}` : "All caught up",
        description: r.message || `Scanned ${r.videos_scanned ?? 0} most-recent uploads.`,
      });
      refresh();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    return drafts.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (brandFilter !== "all" && d.brand_id !== brandFilter) return false;
      return true;
    });
  }, [drafts, statusFilter, brandFilter]);

  const startEdit = (d: CommentDraft) => {
    setEditingId(d.id);
    setEditText(d.edited_reply ?? d.draft_reply ?? "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };
  const saveEdit = async (d: CommentDraft) => {
    try {
      await api.updateCommentDraft(d.id, { edited_reply: editText.trim() || null });
      cancelEdit();
      refresh();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };
  const reject = async (d: CommentDraft) => {
    try {
      await api.rejectCommentDraft(d.id);
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };
  const remove = async (d: CommentDraft) => {
    if (!confirm("Delete this draft?")) return;
    try {
      await api.deleteCommentDraft(d.id);
      refresh();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };
  const post = async (d: CommentDraft) => {
    setPostingId(d.id);
    try {
      await api.postCommentDraft(d.id);
      toast({ title: "Posted to YouTube", description: `Reply to ${d.comment_author || "viewer"} sent.` });
      refresh();
    } catch (e: any) {
      toast({ title: "Post failed", description: e.message, variant: "destructive" });
    } finally {
      setPostingId(null);
    }
  };

  const counts = {
    draft:    drafts.filter((d) => d.status === "draft").length,
    posted:   drafts.filter((d) => d.status === "posted").length,
    rejected: drafts.filter((d) => d.status === "rejected").length,
    failed:   drafts.filter((d) => d.status === "failed").length,
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <PageHeader
        icon={MessageCircle}
        title="Replies"
        subtitle="AI drafts replies to your YouTube comments in the active brand voice. Approve, edit, post — engagement closes the algorithm loop."
        actions={
          <Button size="sm" onClick={sync} disabled={syncing} className="gap-1">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync
          </Button>
        }
      />

      {/* Stat row + filters */}
      <Card className="border-border bg-card">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11px]">
            <Badge variant="outline" className="border-primary/40 text-primary">Drafts {counts.draft}</Badge>
            <Badge variant="outline" className="border-success/40 text-success">Posted {counts.posted}</Badge>
            <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">Rejected {counts.rejected}</Badge>
            {counts.failed > 0 && <Badge variant="outline" className="border-destructive/40 text-destructive">Failed {counts.failed}</Badge>}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="h-7 text-[11px] bg-secondary border-border w-[110px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="posted">Posted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            {brands.length > 0 && (
              <Select value={brandFilter} onValueChange={setBrandFilter}>
                <SelectTrigger className="h-7 text-[11px] bg-secondary border-border w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground space-y-1">
            <MessageCircle className="h-6 w-6 mx-auto mb-1 opacity-40" />
            {drafts.length === 0
              ? <><p>No comment drafts yet.</p><p>Click <b>Sync</b> to pull comments from your latest uploads.</p></>
              : <p>Nothing matches the current filters.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => {
            const brand = brands.find((b) => b.id === d.brand_id);
            const replyText = d.edited_reply ?? d.draft_reply ?? "";
            const isEditing = editingId === d.id;
            return (
              <Card key={d.id} className={cn(
                "transition-colors",
                d.status === "draft" ? "border-primary/30 bg-card" : "border-border bg-card opacity-90",
              )}>
                <CardContent className="p-3 space-y-2">
                  {/* Original comment */}
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-medium">{d.comment_author || "anon"}</span>
                        <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 capitalize", STATUS_TONE[d.status])}>
                          {d.status}
                        </Badge>
                        {brand && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1"
                            style={{ borderColor: `${brand.color}60`, color: brand.color }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: brand.color }} />
                            {brand.name}
                          </Badge>
                        )}
                        {d.comment_url && (
                          <a href={d.comment_url} target="_blank" rel="noreferrer"
                            className="text-[9px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">
                            <ExternalLink className="h-2.5 w-2.5" /> on YouTube
                          </a>
                        )}
                      </div>
                      <p className="text-[12px] leading-snug">{d.comment_text}</p>
                    </div>
                  </div>

                  {/* Reply editor / display */}
                  <div className="rounded border border-primary/20 bg-primary/5 p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Reply (your voice)</span>
                      {!isEditing && d.status === "draft" && (
                        <button
                          onClick={() => startEdit(d)}
                          className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                        >
                          <Pencil className="h-2.5 w-2.5" /> edit
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <>
                        <Textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="bg-background/60 border-border text-[11px] min-h-[60px]"
                          maxLength={500}
                          autoFocus
                        />
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-6 text-[10px] gap-1">
                            <X className="h-3 w-3" /> Cancel
                          </Button>
                          <Button size="sm" onClick={() => saveEdit(d)} className="h-6 text-[10px] gap-1">
                            <Check className="h-3 w-3" /> Save
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-[12px] leading-snug">{replyText || <span className="text-muted-foreground italic">no draft</span>}</p>
                    )}
                  </div>

                  {/* Actions */}
                  {d.status === "draft" && !isEditing && (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => reject(d)} className="h-7 text-[10px] gap-1">
                        <X className="h-3 w-3" /> Reject
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(d)} className="h-7 text-[10px] gap-1">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button size="sm" onClick={() => post(d)} disabled={postingId === d.id || !replyText.trim()}
                        className="h-7 text-[10px] gap-1 glow-accent">
                        {postingId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Post to YouTube
                      </Button>
                    </div>
                  )}
                  {d.error && (
                    <div className="text-[10px] text-destructive flex items-start gap-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="leading-snug">{d.error}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardContent className="p-3 text-[10px] text-muted-foreground leading-relaxed space-y-1">
          <p><b>How it works:</b></p>
          <p>1. <b>Sync</b> hits the YT Data API (your existing API key) and pulls the 15 latest top-level comments from your 5 most-recent uploads.</p>
          <p>2. The LLM drafts a reply per comment in the brand's voice (skipping spam / low-quality automatically).</p>
          <p>3. You review, optionally edit, then <b>Post to YouTube</b> sends via OAuth.</p>
          <p className="text-amber-400/90 mt-1.5">
            Posting requires <code>youtube.force-ssl</code> scope. If you connected YouTube before this feature shipped, hit
            <b> Disconnect → Connect</b> on Config → Publishing once to upgrade the scope. Cost: ~50 quota units per posted reply.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
