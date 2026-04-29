/**
 * ScriptReviewDialog — manual edit gate between Format and TTS.
 *
 * Surfaces when the pipeline pauses on the script_review step. The
 * operator gets editable textareas for the post title, body, and each
 * comment (Q&A mode); on Approve the edits ship to the backend and the
 * pipeline continues into TTS. Cancel aborts the pipeline cleanly.
 *
 * Contracts:
 *   - The dialog is fully controlled by the parent (PipelinePanel).
 *     The parent decides when to open / close based on the running
 *     pipeline's step state.
 *   - The fetch is cheap (~few KB) and one-shot per open. We re-fetch
 *     only on (postId change) to avoid stomping the operator's
 *     in-progress edits.
 *   - Approve disables itself while the request is in flight so a
 *     double-click doesn't fire two PUTs.
 */
import { useEffect, useState } from "react";
import { Loader2, Check, XCircle, AlertTriangle, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Comment {
  author: string;
  body: string;
}

interface Props {
  postId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ScriptReviewDialog({ postId, open, onClose }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);

  // Fetch only on (postId change while open). Closing + reopening for
  // the same post should NOT clobber edits — operators sometimes scroll
  // away to reference something else.
  useEffect(() => {
    let cancelled = false;
    if (!open || !postId) return;
    setLoading(true);
    setError(null);
    api.getScriptReview(postId)
      .then((data) => {
        if (cancelled) return;
        setTitle(data.title || "");
        setPostBody(data.post_body || "");
        setComments(Array.isArray(data.comments) ? data.comments : []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Failed to load script");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, open]);

  const updateComment = (i: number, body: string) =>
    setComments((cs) => cs.map((c, idx) => (idx === i ? { ...c, body } : c)));

  const approve = async () => {
    if (!postId || submitting) return;
    setSubmitting(true);
    try {
      await api.approveScriptReview(postId, {
        title, post_body: postBody, comments,
      });
      toast({ title: "Script approved", description: "Pipeline resuming into TTS." });
      onClose();
    } catch (e: any) {
      toast({
        title: "Approve failed",
        description: e?.message || "See server log",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!postId || submitting) return;
    if (!window.confirm("Cancel this render? The pipeline will abort here — TTS won't run.")) {
      return;
    }
    setSubmitting(true);
    try {
      await api.cancelScriptReview(postId);
      toast({ title: "Render cancelled", description: "Pipeline aborted at script review." });
      onClose();
    } catch (e: any) {
      toast({
        title: "Cancel failed",
        description: e?.message || "See server log",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Char counters — TTS cost scales linearly with characters on most
  // providers, so showing the running total helps operators decide
  // whether to trim before approving.
  const totalChars =
    title.length +
    postBody.length +
    comments.reduce((sum, c) => sum + c.body.length, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Script Review
          </DialogTitle>
          <DialogDescription className="text-xs">
            Final pass before paid TTS runs — fix typos, tighten phrasing, or
            drop awkward bits. Edits apply only to this render. Empty fields
            fall back to the original text on the backend.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading script…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold text-destructive">Couldn't load script</p>
              <p className="text-muted-foreground mt-0.5">{error}</p>
              <p className="text-muted-foreground mt-1">
                The pipeline may have moved on or the review window expired
                (30 min). Closing this dialog is safe.
              </p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Editing post {postId}</span>
              <span className="font-mono">{totalChars.toLocaleString()} chars</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Title</Label>
              <Textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                rows={2}
                className="text-sm bg-secondary border-border resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Body</Label>
              <Textarea
                value={postBody}
                onChange={(e) => setPostBody(e.target.value)}
                rows={Math.min(20, Math.max(8, Math.ceil(postBody.length / 80)))}
                className="text-sm bg-secondary border-border resize-y font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                {postBody.length.toLocaleString()} chars · roughly{" "}
                {Math.round(postBody.split(/\s+/).filter(Boolean).length / 150)} min spoken
              </p>
            </div>

            {comments.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs">Comments ({comments.length})</Label>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Q&A mode reads each comment after the post. Set a comment to
                  empty to drop it from the render.
                </p>
                {comments.map((c, i) => (
                  <div key={i} className="space-y-1 rounded-md border border-border/60 p-2 bg-secondary/20">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        u/{c.author || "Anonymous"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.body.length.toLocaleString()} chars
                      </span>
                    </div>
                    <Textarea
                      value={c.body}
                      onChange={(e) => updateComment(i, e.target.value)}
                      rows={Math.min(8, Math.max(2, Math.ceil(c.body.length / 80)))}
                      className="text-xs bg-background border-border resize-y"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={submitting}
                className="text-destructive hover:text-destructive gap-1"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel render
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
                  Close (keep paused)
                </Button>
                <Button
                  size="sm"
                  onClick={approve}
                  disabled={submitting}
                  className="gap-1 glow-primary"
                >
                  {submitting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Approve & continue
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
