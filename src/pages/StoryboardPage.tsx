/**
 * StoryboardPage — list view for the operator-driven scene composer.
 *
 * Each row is a saved storyboard project. New projects are created from
 * a template (Blank, Pet Adventure, Stoic Wisdom, etc.) — picker lives
 * in the New-project dialog, NOT a separate page, because the only
 * thing a template does is seed the scene list. After creation the
 * editor at /storyboard/:id is identical regardless of template.
 *
 * Polling: the page refetches the project list every 6s while a render
 * is in flight (status === 'rendering'); otherwise stays idle. The
 * pipeline panel on /home shows the actual progress; this page just
 * needs to know "still rendering vs done" for the row badge.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Plus, Loader2, Film, Trash2, Clock, Layers, RefreshCw,
  AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { api, type StoryboardSummary } from "@/lib/api";

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function fmtRelative(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function StoryboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const projectsQ = useQuery({
    queryKey: ["storyboard-projects"],
    queryFn: () => api.listStoryboardProjects(),
    refetchInterval: (q) => {
      const data = q.state.data as { projects: StoryboardSummary[] } | undefined;
      const anyRendering = (data?.projects ?? []).some((p) => p.status === "rendering");
      return anyRendering ? 6_000 : false;
    },
  });

  const templatesQ = useQuery({
    queryKey: ["storyboard-templates"],
    queryFn: () => api.listStoryboardTemplates(),
    staleTime: Infinity, // templates are baked in — won't change at runtime
  });

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("blank");

  const createMut = useMutation({
    mutationFn: () => api.createStoryboardProject({
      name: newName.trim(),
      template: newTemplate,
    }),
    onSuccess: (proj) => {
      toast({ title: "Storyboard created", description: proj.name });
      qc.invalidateQueries({ queryKey: ["storyboard-projects"] });
      setNewOpen(false);
      setNewName("");
      setNewTemplate("blank");
      // Navigate into the editor automatically so the operator can
      // start dropping clips immediately.
      window.location.hash = `#/storyboard/${proj.id}`;
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteStoryboardProject(id),
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["storyboard-projects"] });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const projects = projectsQ.data?.projects ?? [];
  const templates = templatesQ.data?.templates ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" /> Storyboard
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Drop your AI-generated clips, write narration per scene, render — no per-clip
            provider integration. Bring clips from Grok Imagine, Sora, Pika, or anywhere.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => projectsQ.refetch()}
            className="gap-1"
            disabled={projectsQ.isFetching}
          >
            {projectsQ.isFetching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button onClick={() => setNewOpen(true)} className="gap-1 glow-primary">
            <Plus className="h-4 w-4" />
            New storyboard
          </Button>
        </div>
      </div>

      {projectsQ.isLoading && (
        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </CardContent>
        </Card>
      )}

      {!projectsQ.isLoading && projects.length === 0 && (
        <Card className="border-border bg-card">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Layers className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm font-medium">No storyboards yet</p>
            <p className="text-xs mt-1">Create one to start composing scenes from your clips.</p>
            <Button onClick={() => setNewOpen(true)} className="mt-4 gap-1">
              <Plus className="h-4 w-4" /> New storyboard
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            templateName={templates.find((t) => t.id === p.template)?.name}
            onDelete={() => {
              if (window.confirm(`Delete "${p.name}"? This removes all clips and renders for this storyboard.`)) {
                deleteMut.mutate(p.id);
              }
            }}
          />
        ))}
      </div>

      {/* New-project dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New storyboard</DialogTitle>
            <DialogDescription className="text-xs">
              Pick a template to seed the scene list, or start blank.
              You can edit, add, or remove scenes after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Whiskers the Detective"
                className="bg-secondary border-border h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Template</Label>
              <div className="grid grid-cols-1 gap-1.5 max-h-72 overflow-y-auto pr-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setNewTemplate(t.id)}
                    className={`text-left rounded-md border p-2.5 transition-colors ${
                      newTemplate === t.id
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-secondary/30 hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t.name}</span>
                      {newTemplate === t.id && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="gap-1"
            >
              {createMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function ProjectCard({ project, templateName, onDelete }: {
  project: StoryboardSummary;
  templateName?: string;
  onDelete: () => void;
}) {
  // Status badge color depends on the project's status.
  const statusUI = useMemo(() => {
    switch (project.status) {
      case "rendering":
        return { color: "border-primary/40 bg-primary/10 text-primary",
                 icon: <Loader2 className="h-3 w-3 animate-spin" />, label: "Rendering" };
      case "ready":
        return { color: "border-success/40 bg-success/10 text-success",
                 icon: <CheckCircle2 className="h-3 w-3" />, label: "Ready" };
      case "failed":
        return { color: "border-destructive/40 bg-destructive/10 text-destructive",
                 icon: <AlertTriangle className="h-3 w-3" />, label: "Failed" };
      default:
        return { color: "border-border bg-secondary/40 text-muted-foreground",
                 icon: <Film className="h-3 w-3" />, label: "Draft" };
    }
  }, [project.status]);

  return (
    <Card className="border-border bg-card hover:border-primary/40 transition-colors group">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/storyboard/${project.id}`} className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
              {project.name}
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {templateName || project.template} · updated {fmtRelative(project.updated_at)}
            </p>
          </Link>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete storyboard"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${statusUI.color}`}>
          {statusUI.icon}
          <span>{statusUI.label}</span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {project.scene_count} scene{project.scene_count === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {fmtDuration(project.approx_duration_s)}
          </span>
          {project.render_count > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {project.render_count} render{project.render_count === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {project.status === "failed" && project.status_detail && (
          <p className="text-[10px] text-destructive/90 line-clamp-2">{project.status_detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
