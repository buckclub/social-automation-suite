import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppEvent, isLiveConnected } from "@/lib/eventBus";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { useNavigate } from "react-router-dom";
import {
  Calendar as CalendarIcon, Loader2, Plus, Trash2, Play,
  CheckCircle2, XCircle, Clock, Tag, Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useBrand } from "@/contexts/BrandContext";
import { api, type CalendarSlot } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NICHES = [
  "relationship_drama", "childhood_nostalgia", "workplace_horror",
  "dating_disasters", "family_secrets", "school_memories",
  "paranormal_encounters", "neighbor_stories", "travel_nightmares", "food_culture",
];
const STYLES = ["story", "qa", "interactive", "hot_take"] as const;
const TONES = ["dramatic", "funny", "heartfelt", "shocking", "cringe"] as const;
const FILTERS = ["safe", "normal", "edgy"] as const;

type Style = typeof STYLES[number];
type Tone = typeof TONES[number];
type Filter = typeof FILTERS[number];

const STATUS_TONE: Record<CalendarSlot["status"], string> = {
  planned:    "border-muted-foreground/30 text-muted-foreground",
  due:        "border-primary/40 text-primary",
  generating: "border-primary/40 text-primary",
  queued:     "border-amber-400/40 text-amber-400",
  rendered:   "border-success/40 text-success",
  failed:     "border-destructive/40 text-destructive",
  cancelled:  "border-muted-foreground/20 text-muted-foreground/50",
};

/**
 * Content Calendar — schedule AI generation runs for specific datetimes.
 * Worker fires due slots, generates content, enqueues onto the run
 * queue. The actual render happens via the existing pipeline once the
 * worker drops a post on the queue.
 */
export default function CalendarPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { brands } = useBrand();
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarSlot | null>(null);

  // Distinguish initial load from subsequent refreshes. The spinner
  // should only appear before we have any data — once `slots` is
  // populated, SSE / interval refreshes silently swap in the new list
  // (otherwise every push flashes a loading spinner over the calendar).
  const hasLoadedOnce = useRef(false);
  const refresh = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    try {
      const r = await api.listCalendarSlots();
      setSlots(r.slots || []);
      hasLoadedOnce.current = true;
    } catch (e: any) {
      toast({ title: "Couldn't load calendar", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    refresh();
    // SSE pushes drive most updates. The interval only fires when SSE
    // is disconnected — gating on isLiveConnected() means a healthy
    // connection costs zero polling chatter, while a dropped stream
    // still gets a refresh every 60s as a safety net.
    const t = setInterval(() => {
      if (!isLiveConnected()) refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  useAppEvent("calendar.update", refresh);

  // Group by day for the list view (next 14 days + history).
  const grouped = useMemo(() => {
    const m = new Map<string, CalendarSlot[]>();
    for (const s of slots) {
      const day = (s.scheduled_at || "").slice(0, 10);
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(s);
    }
    for (const arr of m.values())
      arr.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  // O(1) brand lookup keyed by id. Was `brands.find()` inside a render
  // loop — O(N×M) on every paint, noticeable when the calendar has
  // many slots and the user has many brands.
  const brandsById = useMemo(
    () => new Map(brands.map((b) => [b.id, b])),
    [brands],
  );

  const undoDelete = useUndoableDelete();
  const onDelete = (s: CalendarSlot) => {
    // No more confirm() prompt — the 5-second undo window IS the
    // confirmation. Optimistically remove from the list, fire the
    // backend delete after the timer if not undone.
    undoDelete({
      label: `Deleted "${s.title || "slot"}"`,
      description: "Click Undo to restore.",
      hide: () => setSlots((cur) => cur.filter((x) => x.id !== s.id)),
      restore: () => setSlots((cur) =>
        // Re-insert maintaining scheduled_at order so it pops back into
        // its original spot in the grouped view, not at the top.
        [...cur, s].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
      ),
      commit: () => api.deleteCalendarSlot(s.id),
    });
  };
  const onFireNow = async (s: CalendarSlot) => {
    try {
      await api.fireCalendarSlotNow(s.id);
      toast({ title: "Queued for next worker tick" });
      setTimeout(refresh, 1000);
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        icon={CalendarIcon}
        title="Content Calendar"
        subtitle="Schedule Generate-with-AI runs for specific datetimes. The worker fires each slot at its time, generates a story, and queues it for render."
        actions={
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Schedule run
          </Button>
        }
      />

      {loading ? (
        <Card className="border-border bg-card"><CardContent className="py-10 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent></Card>
      ) : grouped.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground space-y-1">
            <CalendarIcon className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p>No scheduled runs yet.</p>
            <p>Click <b>Schedule run</b> to plan your first slot.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([day, daySlots]) => {
            const d = new Date(day + "T12:00:00");
            const isPast = day < new Date().toISOString().slice(0, 10);
            return (
              <Card key={day} className={cn("border-border bg-card", isPast && "opacity-70")}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-border/60">
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold">
                      {d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    </p>
                    <span className="text-[10px] text-muted-foreground">{daySlots.length} slot{daySlots.length === 1 ? "" : "s"}</span>
                  </div>
                  {daySlots.map((s) => {
                    const t = new Date(s.scheduled_at);
                    const brand = s.brand_id ? brandsById.get(s.brand_id) : undefined;
                    return (
                      <div key={s.id} className="flex items-start gap-2 rounded border border-border/60 bg-secondary/30 p-2">
                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5 shrink-0 w-12 text-right">
                          {t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className="text-xs font-medium truncate">{s.title || "(untitled)"}</p>
                            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", STATUS_TONE[s.status] ?? "border-muted-foreground/30 text-muted-foreground")}>
                              {s.status}
                            </Badge>
                            {brand && (
                              <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-1"
                                style={{ borderColor: `${brand.color}60`, color: brand.color }}>
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: brand.color }} />
                                {brand.name}
                              </Badge>
                            )}
                          </div>
                          {s.params?.niche && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              {String(s.params.content_style || "story")} · {String(s.params.niche)}
                              {s.params.tone ? ` · ${String(s.params.tone)}` : ""}
                              {s.params.target_audience ? ` · ${String(s.params.target_audience).slice(0, 50)}` : ""}
                            </p>
                          )}
                          {s.error && <p className="text-[10px] text-destructive mt-0.5">{s.error}</p>}
                          {s.post_id && (
                            <p className="text-[9px] text-success mt-0.5 font-mono">→ {s.post_id}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {s.status === "planned" && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onFireNow(s)} title="Fire now">
                              <Play className="h-3 w-3 text-primary" />
                            </Button>
                          )}
                          {s.status === "planned" && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditing(s); setOpen(true); }} title="Edit">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onDelete(s)} title="Delete">
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardContent className="p-3 text-[10px] text-muted-foreground leading-relaxed space-y-1">
          <p><b>How scheduling works:</b></p>
          <p>1. Pick a datetime + brand + content style/niche/tone/audience for each slot.</p>
          <p>2. The worker checks every 30 s for due slots and fires them.</p>
          <p>3. When a slot fires, it auto-switches to its brand, generates one AI variant, and enqueues it on the run queue.</p>
          <p>4. The render queue worker (already running) picks up the post and renders it.</p>
        </CardContent>
      </Card>

      {open && (
        <SlotDialog
          editing={editing}
          brands={brands}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={() => { setOpen(false); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function SlotDialog({ editing, brands, onClose, onSaved }: {
  editing: CalendarSlot | null;
  brands: Array<{ id: string; name: string; color: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = editing !== null;

  // Default to one hour from now in the user's local timezone.
  const defaultLocal = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const tzOffsetMs = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  }, []);

  const initialLocal = editing
    ? (() => {
        const d = new Date(editing.scheduled_at);
        const tzOffsetMs = d.getTimezoneOffset() * 60_000;
        return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
      })()
    : defaultLocal;

  const [scheduledLocal, setScheduledLocal] = useState(initialLocal);
  const [title, setTitle] = useState(editing?.title || "");
  const [brandId, setBrandId] = useState<string>((editing?.brand_id as string) || "__none__");
  const [contentStyle, setContentStyle] = useState<Style>((editing?.params?.content_style as Style) || "story");
  const [niche, setNiche] = useState<string>((editing?.params?.niche as string) || NICHES[0]);
  const [tone, setTone] = useState<Tone>((editing?.params?.tone as Tone) || "dramatic");
  const [filter, setFilter] = useState<Filter>((editing?.params?.content_filter as Filter) || "normal");
  const [audience, setAudience] = useState<string>((editing?.params?.target_audience as string) || "");
  const [customTopic, setCustomTopic] = useState<string>((editing?.params?.custom_topic as string) || "");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!scheduledLocal) {
      toast({ title: "Pick a date and time", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const isoUtc = new Date(scheduledLocal).toISOString();
      const payload = {
        scheduled_at: isoUtc,
        kind: "ai" as const,
        brand_id: brandId === "__none__" ? null : brandId,
        title: title.trim() || `${contentStyle} · ${niche}`,
        params: {
          content_style: contentStyle,
          niche,
          tone,
          content_filter: filter,
          target_audience: audience.trim() || undefined,
          custom_topic: customTopic.trim() || undefined,
        },
      };
      if (editing) {
        await api.updateCalendarSlot(editing.id, payload as any);
      } else {
        await api.createCalendarSlot(payload);
      }
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-primary" />
            {isEdit ? "Edit scheduled slot" : "Schedule a run"}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Worker fires the slot at this time, switches to the brand, generates one AI variant, and enqueues it on the run queue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Scheduled at (local time)</Label>
            <Input
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              className="bg-secondary border-border h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Title (optional)</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mon morning AITA · workplace horror"
              className="bg-secondary border-border h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" /> Brand profile
            </Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Use whatever's active when fired —</SelectItem>
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
            <p className="text-[10px] text-muted-foreground">
              Slot auto-switches the active brand at fire time so each run uses the right captions / voice / avatar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Style</Label>
              <Select value={contentStyle} onValueChange={(v) => setContentStyle(v as Style)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Niche</Label>
              <Select value={niche} onValueChange={setNiche}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NICHES.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Tone</Label>
              <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Content filter</Label>
              <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILTERS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Target audience (optional)</Label>
            <Input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. women 25-34"
              className="bg-secondary border-border h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom topic / seed (optional)</Label>
            <Input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. caught my roommate doing something weird at 3am"
              className="bg-secondary border-border h-8 text-xs"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isEdit ? "Save" : "Schedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
