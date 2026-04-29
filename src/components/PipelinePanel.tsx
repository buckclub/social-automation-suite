import { useEffect, useState } from "react";
import { Search, FileText, Mic, Film, Send, XCircle, Sparkles, Image, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PipelineStep } from "./PipelineStep";
import { usePipelineStatus, useRunPipeline, useResetPipeline, useCancelPipeline } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import type { StepStatus } from "./PipelineStep";
import { ScriptReviewDialog } from "./ScriptReviewDialog";

const STEP_ICONS: Record<string, React.ReactNode> = {
  ai_generate: <Sparkles className="h-5 w-5" />,
  fetch: <Search className="h-5 w-5" />,
  format: <FileText className="h-5 w-5" />,
  script_review: <Pencil className="h-5 w-5" />,
  tts: <Mic className="h-5 w-5" />,
  video: <Film className="h-5 w-5" />,
  thumbnail: <Image className="h-5 w-5" />,
  notify: <Send className="h-5 w-5" />,
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  ai_generate: "Generate content using AI provider",
  fetch: "Scan subreddits and find a post matching filters",
  format: "Clean and structure the story for narration",
  script_review: "Manual edit pass before paid TTS runs",
  tts: "Convert story text to speech with chosen voice",
  video: "Compose video with captions over background footage",
  thumbnail: "Generate Reddit-style thumbnails for each part",
  notify: "Send Discord notification and upload output",
};

export function PipelinePanel() {
  const { data: pipeline } = usePipelineStatus();
  const runMutation = useRunPipeline();
  const resetMutation = useResetPipeline();
  const cancelMutation = useCancelPipeline();
  const { toast } = useToast();

  const steps = pipeline?.steps ?? [];
  const isRunning = pipeline?.is_running ?? false;
  const allDone = steps.length > 0 && steps.every((s) => s.status === "done");
  const hasError = pipeline?.error != null;

  // Awaiting-review detection — when the script_review step flips to
  // 'running' the backend is blocked on an asyncio.Event waiting for
  // the operator to approve. Auto-open the dialog the first time we
  // see it; the operator can close + reopen via the button below if
  // they need to glance at something else first.
  const reviewStep = steps.find((s) => s.id === "script_review");
  const awaitingReview = reviewStep?.status === "running";
  const currentPostId = pipeline?.current_post?.id ?? null;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);
  useEffect(() => {
    if (awaitingReview && currentPostId && autoOpenedFor !== currentPostId) {
      setReviewOpen(true);
      setAutoOpenedFor(currentPostId);
    }
    if (!awaitingReview) {
      // Reset the auto-open guard once the pipeline moves past review
      // so a second run for the same post (after the file is cleaned
      // up) re-opens correctly.
      if (autoOpenedFor) setAutoOpenedFor(null);
    }
  }, [awaitingReview, currentPostId, autoOpenedFor]);

  const handleCancel = () => {
    cancelMutation.mutate(undefined, {
      onSuccess: () => toast({ title: "Pipeline cancelled", description: "The current run has been aborted." }),
      onError: (e) => toast({ title: "Cancel failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Pipeline</CardTitle>
          {(allDone || hasError) && !isRunning && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => resetMutation.mutate()}
              className="text-xs"
            >
              Reset
            </Button>
          )}
        </div>
        {pipeline?.current_post && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            ▸ {pipeline.current_post.title}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {steps.map((step, i) => (
            <PipelineStep
              key={step.id}
              title={step.title}
              description={step.detail || STEP_DESCRIPTIONS[step.id] || ""}
              icon={STEP_ICONS[step.id] || <Search className="h-5 w-5" />}
              status={step.status as StepStatus}
              index={i}
              isLast={i === steps.length - 1}
              subSteps={step.sub_steps}
              startedAt={step.started_at}
              finishedAt={step.finished_at}
            />
          ))}
        </div>

        {pipeline?.error && (
          <p className="text-xs text-destructive mt-2 mb-2 font-mono">{pipeline.error}</p>
        )}

        {/* Review-awaiting banner — gives the operator a way back into
            the dialog if they dismissed it without deciding. */}
        {awaitingReview && currentPostId && !reviewOpen && (
          <div className="mt-2 mb-2 rounded-md border border-primary/40 bg-primary/5 p-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Pencil className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px] truncate">
                Script awaiting review — pipeline paused before TTS
              </span>
            </div>
            <Button
              size="sm"
              variant="default"
              className="h-7 px-2 text-[11px] gap-1"
              onClick={() => setReviewOpen(true)}
            >
              Open editor
            </Button>
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <Button
            onClick={() => runMutation.mutate(undefined)}
            disabled={isRunning || runMutation.isPending}
            className="flex-1 glow-primary font-semibold"
          >
            {isRunning ? "Running Pipeline..." : allDone ? "Run Again" : "Start Pipeline"}
          </Button>
          {isRunning && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              className="gap-1 px-3"
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>

        {/* Generate-with-AI lives in the global header now (visible from
            every page). Removed from this panel to avoid duplication;
            this card is for the Reddit-fetch + render pipeline only. */}
      </CardContent>
      <ScriptReviewDialog
        postId={currentPostId}
        open={reviewOpen && awaitingReview}
        onClose={() => setReviewOpen(false)}
      />
    </Card>
  );
}
