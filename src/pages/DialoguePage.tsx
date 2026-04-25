import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Loader2, ArrowLeft, Sparkles, Send, ListPlus, Copy, Check,
  Drama, Laugh, Heart, Zap, Frown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TONES = [
  { id: "dramatic" as const,  label: "Dramatic",  icon: Drama },
  { id: "funny" as const,     label: "Funny",     icon: Laugh },
  { id: "heartfelt" as const, label: "Heartfelt", icon: Heart },
  { id: "shocking" as const,  label: "Shocking",  icon: Zap },
  { id: "cringe" as const,    label: "Cringe",    icon: Frown },
];

type Tone = typeof TONES[number]["id"];
type Filter = "safe" | "normal" | "edgy";
type Segment = { speaker: "primary" | "guest"; label: string; text: string };

/**
 * Dialogue mode — AI generates a back-and-forth script between two
 * characters, then ships it through the existing Custom Script
 * pipeline. Speaker labels stay in the body so captions naturally
 * show who's talking ("A:", "B:" inline).
 */
export default function DialoguePage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [primaryLabel, setPrimaryLabel] = useState("A");
  const [guestLabel,   setGuestLabel]   = useState("B");
  const [primaryPersona, setPrimaryPersona] = useState("");
  const [guestPersona,   setGuestPersona]   = useState("");
  const [exchanges, setExchanges] = useState(6);
  const [tone, setTone] = useState<Tone>("dramatic");
  const [filter, setFilter] = useState<Filter>("normal");
  const [generating, setGenerating] = useState(false);

  const [title, setTitle] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [plainScript, setPlainScript] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState<null | "now" | "queue">(null);

  const generate = async () => {
    if (!topic.trim()) {
      toast({ title: "Topic required", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const r = await api.generateDialogue({
        topic, primary_persona: primaryPersona, guest_persona: guestPersona,
        primary_label: primaryLabel, guest_label: guestLabel,
        exchanges, tone, content_filter: filter,
      });
      setTitle(r.title);
      setSegments(r.segments);
      setPlainScript(r.plain_script);
      toast({ title: `Generated ${r.segments.length} lines` });
    } catch (e: any) {
      toast({ title: "Generate failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const renderIt = async (mode: "now" | "queue") => {
    if (!plainScript.trim()) return;
    setSubmitting(mode);
    try {
      const r = await api.runCustomScript({
        title: title.trim() || topic.trim() || "Dialogue",
        body: plainScript,
        content_style: "story",
        video_mode: "short_reel",
        tts_enabled: true,
        narrator_gender: "auto",
        enqueue: mode === "queue",
      });
      toast({
        title: r.queued ? "Queued" : "Pipeline started",
        description: r.queued
          ? "Watch the run queue panel on Dashboard."
          : `Rendering "${title.trim().slice(0, 60)}"…`,
      });
      navigate("/");
    } catch (e: any) {
      toast({ title: "Render failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(null);
    }
  };

  const copyScript = async () => {
    if (!plainScript) return;
    await navigator.clipboard?.writeText(plainScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Dialogue Mode</h1>
            <p className="text-xs text-muted-foreground">
              Two-character back-and-forth scripts. AI writes the
              exchange, the existing pipeline renders the video with
              speaker labels baked into the captions.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Topic / scenario</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. wife confronts husband about a strange text on his phone"
              className="bg-secondary border-border h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Speaker A label</Label>
              <Input
                value={primaryLabel}
                onChange={(e) => setPrimaryLabel(e.target.value)}
                className="bg-secondary border-border h-8 text-xs font-mono"
                maxLength={24}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Speaker B label</Label>
              <Input
                value={guestLabel}
                onChange={(e) => setGuestLabel(e.target.value)}
                className="bg-secondary border-border h-8 text-xs font-mono"
                maxLength={24}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Speaker A persona (optional)</Label>
              <Input
                value={primaryPersona}
                onChange={(e) => setPrimaryPersona(e.target.value)}
                placeholder="e.g. tired wife, suspicious"
                className="bg-secondary border-border h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Speaker B persona (optional)</Label>
              <Input
                value={guestPersona}
                onChange={(e) => setGuestPersona(e.target.value)}
                placeholder="e.g. defensive husband, evasive"
                className="bg-secondary border-border h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Exchanges (turns each)</Label>
              <div className="grid grid-cols-5 gap-1">
                {[3, 4, 6, 8, 10].map((n) => (
                  <Button key={n} size="sm"
                    variant={exchanges === n ? "default" : "outline"}
                    onClick={() => setExchanges(n)}
                    className="h-7 text-[10px] p-0"
                  >{n}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Tone</Label>
              <Select value={tone} onValueChange={(v) => setTone(v as Tone)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="inline-flex items-center gap-1.5"><t.icon className="h-3 w-3" />{t.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Content filter</Label>
              <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">Safe</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="edgy">Edgy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={generate}
            disabled={generating || !topic.trim()}
            className="w-full gap-2 glow-accent"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate dialogue
          </Button>
        </CardContent>
      </Card>

      {segments.length > 0 && (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold flex-1">{title || topic}</p>
                <button onClick={copyScript} className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  Copy script
                </button>
              </div>
              <div className="space-y-1.5">
                {segments.map((s, i) => (
                  <div key={i} className={cn(
                    "rounded p-2 text-[12px] leading-snug",
                    s.speaker === "primary"
                      ? "bg-blue-500/10 border-l-2 border-blue-500/50 ml-0 mr-12"
                      : "bg-rose-500/10 border-l-2 border-rose-500/50 ml-12 mr-0",
                  )}>
                    <span className="text-[10px] font-mono text-muted-foreground">{s.label}: </span>
                    {s.text}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => renderIt("queue")}
              disabled={submitting !== null}
              className="flex-1 gap-2"
            >
              {submitting === "queue" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
              Add to render queue
            </Button>
            <Button
              onClick={() => renderIt("now")}
              disabled={submitting !== null}
              className="flex-1 gap-2 glow-accent"
            >
              {submitting === "now" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Render now
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center leading-snug">
            The render uses the active brand's TTS voice + captions / title-card / avatar settings.
            Speaker labels (<code>{primaryLabel}:</code> / <code>{guestLabel}:</code>) stay in the
            captions so viewers can follow the back-and-forth. Coming soon: per-speaker voice + dual-avatar overlay.
          </p>
        </>
      )}
    </div>
  );
}
