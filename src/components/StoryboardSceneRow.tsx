/**
 * StoryboardSceneRow — one editable scene inside a Storyboard project.
 *
 * Renders the clip preview, narration textarea, fit-policy selector,
 * voice override, and a drag handle wired to @dnd-kit/sortable. Pulled
 * out of StoryboardProjectPage so the parent can stay focused on
 * orchestration (DnD context, mutations, render trigger).
 *
 * State model: this component is fully controlled. The parent owns the
 * scenes array; this one calls onChange() with a new scene dict on
 * every edit. Debounced auto-save lives at the parent level.
 */
import { useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Upload, Trash2, Loader2, Video, AlertTriangle, Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, type StoryboardScene, type StoryboardFitPolicy } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props {
  projectId: string;
  index: number;
  scene: StoryboardScene;
  onChange: (next: StoryboardScene) => void;
  onClipUploaded: (next: { scenes: StoryboardScene[] }) => void;  // refresh from server
  onClipDetached: (next: { scenes: StoryboardScene[] }) => void;
  onDelete: () => void;
}

const FIT_POLICIES: { v: StoryboardFitPolicy; label: string; hint: string }[] = [
  { v: "auto",    label: "Auto",            hint: "Trim if clip > narration; loop if shorter." },
  { v: "trim",    label: "Trim to narration", hint: "Cut clip end to match narration length." },
  { v: "loop",    label: "Loop with crossfade", hint: "Repeat clip until narration ends." },
  { v: "hold",    label: "Hold last frame",   hint: "Freeze final frame to extend." },
  { v: "stretch", label: "Time-stretch",     hint: "Speed-warp clip to match narration." },
];

export function StoryboardSceneRow(props: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // @dnd-kit/sortable wiring. The whole row uses { setNodeRef, transform,
  // transition }; only the handle gets { attributes, listeners } so the
  // textarea remains text-selectable and the trash button still clicks.
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: props.scene.id });
  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      toast({ title: "Too big", description: "Keep clips under 200 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const updated = await api.uploadStoryboardClip(props.projectId, props.scene.id, file);
      props.onClipUploaded(updated);
      toast({ title: "Clip attached", description: file.name });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Try a smaller mp4.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDetach = async () => {
    if (!props.scene.clip_path) return;
    if (!window.confirm("Remove this clip? The narration line stays.")) return;
    try {
      const updated = await api.detachStoryboardClip(props.projectId, props.scene.id);
      props.onClipDetached(updated);
    } catch (err: any) {
      toast({ title: "Failed to remove clip", description: err?.message, variant: "destructive" });
    }
  };

  const clipUrl = props.scene.clip_path
    ? `${api.storyboardClipUrl(props.projectId, props.scene.id)}?v=${props.scene.clip_filename || ""}`
    : null;

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      className="rounded-lg border border-border bg-card hover:border-border/80 transition-colors"
    >
      <div className="flex gap-3 p-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="self-stretch flex flex-col items-center justify-center px-1 -ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
          <span className="text-[9px] font-mono mt-1 opacity-70">{props.index + 1}</span>
        </button>

        {/* Clip preview / drop target */}
        <div className="w-40 shrink-0">
          {clipUrl ? (
            <div className="relative group">
              <video
                src={clipUrl}
                className="w-full aspect-[9/16] object-cover rounded-md bg-black"
                muted
                loop
                playsInline
                onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                onMouseLeave={(e) => {
                  const v = e.target as HTMLVideoElement;
                  v.pause();
                  v.currentTime = 0;
                }}
              />
              <button
                onClick={handleDetach}
                title="Remove clip"
                className="absolute top-1 right-1 h-6 w-6 rounded-md bg-background/80 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-destructive hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <div className="absolute bottom-1 left-1 right-1 bg-background/80 backdrop-blur rounded px-1 py-0.5 text-[9px] truncate">
                {props.scene.clip_filename || "clip.mp4"}
                {props.scene.clip_duration_s
                  ? ` · ${props.scene.clip_duration_s.toFixed(1)}s`
                  : ""}
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full aspect-[9/16] rounded-md border-2 border-dashed border-border hover:border-primary/40 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors bg-secondary/20"
            >
              {uploading
                ? <Loader2 className="h-5 w-5 animate-spin" />
                : <Upload className="h-5 w-5" />}
              <span className="text-[10px]">
                {uploading ? "Uploading…" : "Drop clip"}
              </span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo"
            className="hidden"
            onChange={handleFile}
          />
          {clipUrl && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              className="w-full mt-1.5 h-6 text-[10px] gap-1"
              disabled={uploading}
            >
              <Upload className="h-3 w-3" />
              Replace
            </Button>
          )}
        </div>

        {/* Narration + options */}
        <div className="flex-1 min-w-0 space-y-2">
          <Textarea
            value={props.scene.narration}
            onChange={(e) => props.onChange({ ...props.scene, narration: e.target.value })}
            placeholder="Type the line the narrator should speak over this clip… (leave empty for a silent scene)"
            rows={3}
            className="text-sm bg-secondary border-border resize-y"
          />
          <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="font-mono">
              {props.scene.narration.length.toLocaleString()} chars · ~{Math.max(1, Math.round(props.scene.narration.split(/\s+/).filter(Boolean).length / 2.5))}s spoken
            </span>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              {advancedOpen ? "Hide options" : "Scene options ▾"}
            </button>
          </div>

          {advancedOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/50">
              <div className="space-y-1">
                <Label className="text-[10px] flex items-center gap-1">
                  <Video className="h-3 w-3" /> Fit policy
                </Label>
                <Select
                  value={props.scene.fit_policy}
                  onValueChange={(v: StoryboardFitPolicy) =>
                    props.onChange({ ...props.scene, fit_policy: v })
                  }
                >
                  <SelectTrigger className="h-7 text-[11px] bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIT_POLICIES.map((p) => (
                      <SelectItem key={p.v} value={p.v}>
                        <div>
                          <div className="text-xs">{p.label}</div>
                          <div className="text-[10px] text-muted-foreground">{p.hint}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] flex items-center gap-1">
                  <Mic className="h-3 w-3" /> Voice override
                </Label>
                <Input
                  value={props.scene.voice_override || ""}
                  onChange={(e) =>
                    props.onChange({ ...props.scene, voice_override: e.target.value || null })
                  }
                  placeholder="Use config default"
                  className="h-7 text-[11px] bg-secondary border-border font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {/* Delete scene */}
        <div className="flex items-start">
          <button
            onClick={props.onDelete}
            title="Delete scene"
            className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
