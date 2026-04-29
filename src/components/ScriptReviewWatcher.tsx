/**
 * ScriptReviewWatcher — global mount point for the script-review modal.
 *
 * Lives in AppLayout (wraps every page) so the review dialog opens
 * regardless of which route the operator is on when the pipeline
 * pauses. Originally the auto-open lived inside PipelinePanel, but
 * that component only mounts on the dashboard — clicking "Use This
 * Post" from /posts left the user on /posts after the toast, with no
 * mounted PipelinePanel to detect the awaiting-review state, so the
 * dialog silently never opened and the pipeline appeared to skip the
 * pause.
 *
 * The dashboard's PipelinePanel still shows the inline "Open editor"
 * banner for the on-page case; this component handles the auto-open
 * everywhere else.
 *
 * Auto-open guard: keyed by post_id so re-running the same post after
 * a previous review (file cleaned up by the backend) re-opens cleanly.
 */
import { useEffect, useState } from "react";
import { usePipelineStatus } from "@/hooks/use-api";
import { ScriptReviewDialog } from "@/components/ScriptReviewDialog";

/** Custom event the dashboard banner dispatches to ask the watcher to
 *  re-open the modal. Kept as a constant string export so any other UI
 *  surface (e.g. notification center) can request reopen too. */
export const OPEN_REVIEW_EVENT = "rtr:open-script-review";

export function ScriptReviewWatcher() {
  const { data: pipeline } = usePipelineStatus();
  const steps = pipeline?.steps ?? [];
  const reviewStep = steps.find((s) => s.id === "script_review");
  const awaitingReview = reviewStep?.status === "running";
  const currentPostId = pipeline?.current_post?.id ?? null;

  const [open, setOpen] = useState(false);
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);

  useEffect(() => {
    if (awaitingReview && currentPostId && autoOpenedFor !== currentPostId) {
      setOpen(true);
      setAutoOpenedFor(currentPostId);
    }
    if (!awaitingReview && autoOpenedFor) {
      // Reset so a future run for the same post re-opens.
      setAutoOpenedFor(null);
    }
  }, [awaitingReview, currentPostId, autoOpenedFor]);

  // Manual reopen — dashboard banner dispatches this when the user
  // dismissed the modal and wants it back. Cheap window event so we
  // don't have to thread a setter through React context.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_REVIEW_EVENT, handler);
    return () => window.removeEventListener(OPEN_REVIEW_EVENT, handler);
  }, []);

  return (
    <ScriptReviewDialog
      postId={currentPostId}
      open={open && awaitingReview}
      onClose={() => setOpen(false)}
    />
  );
}
