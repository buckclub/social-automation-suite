/**
 * StoryboardProjectPage — editor for a single storyboard.
 *
 * Top-level orchestration:
 *   - Fetches the project via /api/storyboard/projects/:id
 *   - Wraps the scene list in @dnd-kit's DndContext + SortableContext
 *   - Owns the auto-save flow: edits flow into local state, debounced
 *     PATCH writes back narration/fit/voice/order. Clip uploads are
 *     synchronous (multipart) and the response is the canonical new
 *     project, so we replace state from the server.
 *   - Triggers renders via the global pipeline mutex (same lock the
 *     Reddit pipeline uses); the live render-progress UI lives on the
 *     dashboard PipelinePanel.
 *
 * Save model: a 600 ms debounce on narration/fit/voice changes is a
 * good middle ground — operators expect their typing to feel free, but
 * also expect to be able to close the tab without losing work. Order
 * changes (drag-drop) save immediately because they're discrete events
 * with a clear "I'm done" signal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Plus, Save, Loader2, Play, AlertTriangle, Film, Clock,
  Layers, RefreshCw, Download,
} from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api, type StoryboardProject, type StoryboardScene } from "@/lib/api";
import { StoryboardSceneRow } from "@/components/StoryboardSceneRow";
import { usePipelineStatus } from "@/hooks/use-api";

// New scenes get an "s<n+1>" id where n is the highest existing number.
// Mirrors the backend's _next_scene_id so the IDs stay consistent across
// adds/removes/reorders without a round-trip to the server first.
function nextSceneId(scenes: StoryboardScene[]): string {
  let max = 0;
  for (const s of scenes) {
    const n = parseInt(s.id.replace(/^s/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `s${max + 1}`;
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

export default function StoryboardProjectPage() {
  const { id = "" } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const projQ = useQuery({
    queryKey: ["storyboard-project", id],
    queryFn: () => api.getStoryboardProject(id),
    enabled: Boolean(id),
  });

  const pipelineQ = usePipelineStatus();
  const isRendering = pipelineQ.data?.is_running &&
                      pipelineQ.data?.current_post?.id === id;

  // ── Local state — mirrors server, edits debounce-write back ───
  const [name, setName] = useState("");
  const [scenes, setScenes] = useState<StoryboardScene[]>([]);
  const [dirty, setDirty] = useState(false);
  const initialized = useRef(false);

  // Re-hydrate on first load AND whenever the server project changes
  // out from under us (e.g. clip upload returned the new project, or
  // a render finished updating render_history).
  useEffect(() => {
    if (!projQ.data) return;
    setName(projQ.data.name);
    setScenes(projQ.data.scenes);
    initialized.current = true;
    // We don't reset dirty here — if the user typed, then the server
    // refetched a newer copy, that's a conflict. Practically these
    // come from our own writes so dirty is already false. Edge case
    // where a second tab edits would race; not worrying about it for v1.
  }, [projQ.data]);

  // ── Save mutation (debounced for text edits, immediate for order) ─
  const saveMut = useMutation({
    mutationFn: (patch: Partial<Pick<StoryboardProject, "name" | "scenes">>) =>
      api.patchStoryboardProject(id, patch),
    onSuccess: (proj) => {
      // Reflect server state (which may have normalized things) but
      // don't clobber an in-flight edit the user just made.
      qc.setQueryData(["storyboard-project", id], proj);
      setDirty(false);
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // Debounce text edits. Fires the latest snapshot 600ms after the last
  // change. Order/clip changes call saveMut.mutate directly so they
  // skip the debounce.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !initialized.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      saveMut.mutate({ name, scenes });
    }, 600);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scenes, dirty]);

  // ── Render trigger ────────────────────────────────────────────
  const renderMut = useMutation({
    mutationFn: () => api.renderStoryboard(id),
    onSuccess: () => {
      toast({
        title: "Render started",
        description: "Watch progress on the dashboard pipeline panel.",
      });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
    onError: (e: Error) =>
      toast({ title: "Render failed", description: e.message, variant: "destructive" }),
  });

  // ── Scene operations ──────────────────────────────────────────
  const updateScene = (idx: number, next: StoryboardScene) => {
    setScenes((prev) => prev.map((s, i) => (i === idx ? next : s)));
    setDirty(true);
  };
  const deleteScene = (idx: number) => {
    setScenes((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const addScene = () => {
    setScenes((prev) => [
      ...prev,
      {
        id: nextSceneId(prev),
        narration: "",
        clip_path: null,
        clip_filename: null,
        clip_duration_s: null,
        voice_override: null,
        fit_policy: "auto",
      },
    ]);
    setDirty(true);
  };

  // ── DnD ───────────────────────────────────────────────────────
  // Pointer sensor with a small activation distance so click-on-handle
  // doesn't accidentally start a drag when the operator just wanted to
  // grab focus. Keyboard sensor for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setScenes((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      // Order changes are discrete — save immediately rather than
      // debouncing, so a tab close right after a drag persists.
      saveMut.mutate({ scenes: next });
      return next;
    });
    // setDirty stays false — the immediate save above handles it.
  };

  // ── Estimated total duration (best-effort, narration + clip) ──
  const totalDuration = useMemo(() => {
    return scenes.reduce((sum, s) => {
      // We use the clip duration as the lower bound for a scene's time
      // on screen, but if narration is longer than the clip, the loop/
      // hold/stretch policies will extend to narration length. Without
      // the actual TTS duration we estimate via word count.
      const wordCount = s.narration.split(/\s+/).filter(Boolean).length;
      const narrationEst = wordCount / 2.5;
      const clipDur = s.clip_duration_s || 0;
      // 'trim' policy never extends past narration; others might. Be
      // conservative — show the operator the longer of the two.
      return sum + Math.max(narrationEst, clipDur);
    }, 0);
  }, [scenes]);

  if (!id) return <p className="text-sm text-destructive">Missing project id.</p>;
  if (projQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (projQ.isError) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          <div className="text-xs">
            <p className="font-semibold text-destructive">Couldn't load storyboard</p>
            <p className="text-muted-foreground mt-0.5">
              {(projQ.error as Error).message}
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link to="/storyboard">Back to list</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  const project = projQ.data!;
  const renderHistory = project.render_history ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button asChild size="sm" variant="ghost" className="gap-1 shrink-0">
            <Link to="/storyboard"><ArrowLeft className="h-3.5 w-3.5" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
              placeholder="Untitled storyboard"
              className="text-lg font-bold bg-transparent border-transparent hover:border-border focus:border-border h-auto py-1 px-2 -ml-2"
            />
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span>{project.template}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />{scenes.length} scene{scenes.length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />~{fmtDuration(totalDuration)} estimated
              </span>
              {dirty && <Badge variant="outline" className="text-[9px] gap-1 ml-1">
                <Save className="h-2.5 w-2.5" /> saving…
              </Badge>}
              {!dirty && saveMut.isSuccess && (
                <span className="text-success/80">saved</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => projQ.refetch()}
            disabled={projQ.isFetching}
            className="gap-1"
          >
            {projQ.isFetching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button
            onClick={() => renderMut.mutate()}
            disabled={renderMut.isPending || isRendering || scenes.every((s) => !s.clip_path)}
            className="gap-1 glow-primary"
            title={scenes.every((s) => !s.clip_path) ? "Attach at least one clip first" : ""}
          >
            {renderMut.isPending || isRendering
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Play className="h-4 w-4" />}
            {isRendering ? "Rendering…" : "Render"}
          </Button>
        </div>
      </div>

      {/* Scene list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={scenes.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {scenes.map((scene, idx) => (
              <StoryboardSceneRow
                key={scene.id}
                projectId={id}
                index={idx}
                scene={scene}
                onChange={(next) => updateScene(idx, next)}
                onClipUploaded={(updated) => {
                  setScenes(updated.scenes);
                  qc.setQueryData(["storyboard-project", id],
                    (prev: StoryboardProject | undefined) =>
                      prev ? { ...prev, scenes: updated.scenes } : prev);
                }}
                onClipDetached={(updated) => {
                  setScenes(updated.scenes);
                  qc.setQueryData(["storyboard-project", id],
                    (prev: StoryboardProject | undefined) =>
                      prev ? { ...prev, scenes: updated.scenes } : prev);
                }}
                onDelete={() => deleteScene(idx)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button onClick={addScene} variant="outline" className="w-full gap-1 border-dashed">
        <Plus className="h-4 w-4" /> Add scene
      </Button>

      {/* Render history */}
      {renderHistory.length > 0 && (
        <Card className="border-border bg-card mt-6">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Film className="h-4 w-4 text-primary" />
              Renders ({renderHistory.length})
            </h3>
            <div className="space-y-2">
              {renderHistory.map((r) => (
                <div key={r.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/20 p-2">
                  <video
                    src={api.storyboardRenderUrl(id, r.id)}
                    controls
                    className="w-32 aspect-[9/16] object-cover rounded bg-black"
                  />
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="font-mono text-[10px] text-muted-foreground">{r.id}</p>
                    <p>{r.scene_count} scene{r.scene_count === 1 ? "" : "s"} · {fmtDuration(r.duration_s)}</p>
                    <p className="text-muted-foreground text-[10px]">
                      Rendered in {r.render_time_s.toFixed(1)}s · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="gap-1"
                  >
                    <a href={api.storyboardRenderUrl(id, r.id)} download={`${project.name.replace(/[^\w]+/g, "_")}_${r.id}.mp4`}>
                      <Download className="h-3 w-3" /> Download
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
