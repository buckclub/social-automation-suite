import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  PenLine, Sparkles, Loader2, Link as LinkIcon, FileText, AlertTriangle,
  Shield, ShieldAlert, ShieldOff, Users, Inbox, Save as SaveIcon, Copy, Check,
  Mic2, Plus, Trash2, ArrowLeft,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api, type TextPost } from "@/lib/api";
import { useConfig } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { TextPostCard } from "@/components/TextPostCard";
import { splitThread, type ThreadPost } from "@/lib/thread-split";
import { ThreadView } from "@/components/ThreadView";

interface BrandVoice {
  id: string;
  name: string;
  content: string;
}

const CONTENT_FILTERS = [
  { id: "safe" as const, label: "Safe", icon: Shield, color: "text-emerald-400" },
  { id: "normal" as const, label: "Normal", icon: ShieldAlert, color: "text-amber-400" },
  { id: "edgy" as const, label: "Edgy", icon: ShieldOff, color: "text-rose-400" },
];
type ContentFilter = typeof CONTENT_FILTERS[number]["id"];

interface FormatInfo {
  id: string;
  label: string;
  char_limit: number;
}

/**
 * Text Posts page.
 *
 * Generate tweets, community posts, Reddit comments, LinkedIn posts, etc.
 * with the same filter/tone/audience system as the video pipeline, plus
 * per-platform character-limit awareness and optional URL grounding.
 */
export default function TextPostsPage() {
  const { toast } = useToast();

  // Metadata (formats + tones) loaded from the backend
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const [tones, setTones] = useState<string[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  // Form state
  const [format, setFormat] = useState<string>("tweet");
  const [tone, setTone] = useState<string>("professional");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("normal");
  const [targetAudience, setTargetAudience] = useState<string>("");
  const [topic, setTopic] = useState<string>("");
  const [sourceMaterial, setSourceMaterial] = useState<string>("");
  const [charLimit, setCharLimit] = useState<string>("");   // blank = use format default
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [fetchingUrl, setFetchingUrl] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [draftText, setDraftText] = useState<string>("");     // freshly generated, not yet saved
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Saved posts
  const [posts, setPosts] = useState<TextPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  // Brand voices (persisted under config.text_posts.brand_voices)
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const brandVoices: BrandVoice[] = useMemo(() => {
    const raw = (config as any)?.text_posts?.brand_voices;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (v: any) => v && typeof v.id === "string" && typeof v.name === "string" && typeof v.content === "string",
    );
  }, [config]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("__none__");
  const selectedVoice = useMemo(
    () => brandVoices.find((v) => v.id === selectedVoiceId) ?? null,
    [brandVoices, selectedVoiceId],
  );
  const [newVoiceOpen, setNewVoiceOpen] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState("");
  const [newVoiceContent, setNewVoiceContent] = useState("");
  const [savingVoice, setSavingVoice] = useState(false);

  // Variants picker
  const [variantsMode, setVariantsMode] = useState(false);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [pickedVariantIdx, setPickedVariantIdx] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const aiProvider: string = (config as any)?.gemini?.provider || "ollama";

  const loadMeta = async () => {
    setMetaLoading(true);
    try {
      const r = await api.listTextPostFormats();
      setFormats(r.formats);
      setTones(r.tones);
    } catch (e: any) {
      toast({ title: "Couldn't load formats", description: e?.message, variant: "destructive" });
    } finally {
      setMetaLoading(false);
    }
  };

  const loadPosts = async () => {
    setPostsLoading(true);
    try {
      const r = await api.listTextPosts();
      setPosts(r.posts);
    } catch (e: any) {
      toast({ title: "Couldn't load drafts", description: e?.message, variant: "destructive" });
    } finally {
      setPostsLoading(false);
    }
  };

  useEffect(() => { loadMeta(); loadPosts(); }, []);

  const currentFormat = useMemo(
    () => formats.find((f) => f.id === format),
    [formats, format],
  );

  // Auto-fill char_limit field when the user changes format (unless they've
  // typed their own override).
  const [charLimitTouched, setCharLimitTouched] = useState(false);
  useEffect(() => {
    if (!currentFormat) return;
    if (!charLimitTouched) setCharLimit(String(currentFormat.char_limit));
  }, [currentFormat, charLimitTouched]);

  const parsedCharLimit = (() => {
    const n = parseInt(charLimit, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  const draftCharCount = draftText.length;
  const draftOverLimit = parsedCharLimit != null && draftCharCount > parsedCharLimit;

  const fetchUrl = async () => {
    const url = sourceUrl.trim();
    if (!url) {
      toast({ title: "Enter a URL first", variant: "destructive" });
      return;
    }
    setFetchingUrl(true);
    try {
      const r = await api.fetchUrlForTextPost(url);
      const chunk = [r.title ? `# ${r.title}\n` : "", r.text].filter(Boolean).join("\n");
      // Append rather than overwrite so the user can stack multiple sources
      setSourceMaterial((prev) => prev.trim() ? `${prev}\n\n---\n${chunk}` : chunk);
      toast({ title: "Fetched", description: r.title || url });
      setSourceUrl("");
    } catch (e: any) {
      toast({ title: "Fetch failed", description: e?.message, variant: "destructive" });
    } finally {
      setFetchingUrl(false);
    }
  };

  const saveBrandVoice = async () => {
    const name = newVoiceName.trim();
    const content = newVoiceContent.trim();
    if (!name || !content) {
      toast({ title: "Name and content are both required", variant: "destructive" });
      return;
    }
    setSavingVoice(true);
    try {
      const voice: BrandVoice = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        content,
      };
      const next = [...brandVoices, voice];
      await api.updateConfig({ text_posts: { brand_voices: next } });
      qc.invalidateQueries({ queryKey: ["config"] });
      setSelectedVoiceId(voice.id);
      setNewVoiceName("");
      setNewVoiceContent("");
      setNewVoiceOpen(false);
      toast({ title: `Brand voice saved: ${name}` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSavingVoice(false);
    }
  };

  const deleteBrandVoice = async (id: string) => {
    const v = brandVoices.find((x) => x.id === id);
    if (!v) return;
    if (!window.confirm(`Delete brand voice "${v.name}"?`)) return;
    try {
      const next = brandVoices.filter((x) => x.id !== id);
      await api.updateConfig({ text_posts: { brand_voices: next } });
      qc.invalidateQueries({ queryKey: ["config"] });
      if (selectedVoiceId === id) setSelectedVoiceId("__none__");
      toast({ title: "Brand voice deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  };

  // Build the shared request payload once so generate + variants stay in sync
  const buildBaseRequest = () => ({
    format,
    topic: topic.trim() || undefined,
    source_material: sourceMaterial.trim() || undefined,
    brand_voice: selectedVoice?.content.trim() || undefined,
    content_filter: contentFilter,
    target_audience: targetAudience.trim() || undefined,
    tone,
    char_limit: parsedCharLimit,
  });

  const generate = async () => {
    if (variantsMode) {
      setVariantsLoading(true);
      setVariants([]);
      setPickedVariantIdx(null);
      setShowPicker(true);
      try {
        const r = await api.generateTextPostVariants({ ...buildBaseRequest(), count: 3 });
        setVariants(r.variants);
      } catch (e: any) {
        toast({ title: "Variant generation failed", description: e?.message, variant: "destructive" });
        setShowPicker(false);
      } finally {
        setVariantsLoading(false);
      }
      return;
    }

    setGenerating(true);
    setDraftText("");
    setSavedDraftId(null);
    try {
      const r = await api.generateTextPost(buildBaseRequest());
      setDraftText(r.text);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const confirmPickedVariant = () => {
    if (pickedVariantIdx == null) return;
    setDraftText(variants[pickedVariantIdx]);
    setSavedDraftId(null);
    setShowPicker(false);
    setVariants([]);
    setPickedVariantIdx(null);
  };

  const saveDraft = async () => {
    if (!draftText.trim()) return;
    try {
      const r = await api.saveTextPost({
        id: savedDraftId ?? undefined,
        text: draftText,
        format, filter: contentFilter, tone,
        target_audience: targetAudience,
        topic, source_material: sourceMaterial,
        char_limit: parsedCharLimit ?? null,
      });
      setSavedDraftId(r.post.id);
      await loadPosts();
      toast({ title: savedDraftId ? "Updated" : "Saved to drafts" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const formatLabelFor = (id?: string): string => {
    if (!id) return "—";
    const f = formats.find((x) => x.id === id);
    return f?.label || id;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary" />
            Text Posts
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate tweets, community posts, Reddit comments, LinkedIn posts and more. Ground in real sources. Rewrite with feedback.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-4">
        {/* ── Generator form ─────────────────────────────────── */}
        <Card className="md:col-span-2 bg-card border-border h-fit md:sticky md:top-16">
          <CardContent className="p-4 space-y-3">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-accent" /> New Post
            </Label>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Format</Label>
              <Select value={format} onValueChange={(v) => { setFormat(v); setCharLimitTouched(false); }}>
                <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {formats.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label} <span className="text-muted-foreground">· {f.char_limit} chars</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Mic2 className="h-3 w-3" /> Brand voice <span className="text-muted-foreground/70 font-normal">(optional)</span>
              </Label>
              <div className="flex gap-1.5">
                <Select value={selectedVoiceId} onValueChange={setSelectedVoiceId}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border flex-1">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    <SelectItem value="__none__">None</SelectItem>
                    {brandVoices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedVoice && (
                  <Button
                    size="sm" variant="outline"
                    onClick={() => deleteBrandVoice(selectedVoice.id)}
                    className="h-8 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                    title="Delete this brand voice"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  size="sm" variant="outline"
                  onClick={() => { setNewVoiceOpen((o) => !o); setNewVoiceName(""); setNewVoiceContent(""); }}
                  className="h-8 text-[10px] px-2 gap-1"
                >
                  <Plus className="h-3 w-3" /> New
                </Button>
              </div>
              {selectedVoice && (
                <p className="text-[10px] text-muted-foreground line-clamp-2 italic">
                  {selectedVoice.content}
                </p>
              )}
              {newVoiceOpen && (
                <div className="space-y-1.5 p-2 rounded-md border border-dashed border-border bg-secondary/30">
                  <Input
                    value={newVoiceName}
                    onChange={(e) => setNewVoiceName(e.target.value)}
                    placeholder="Voice name — e.g. 'BuckClub — irreverent'"
                    className="h-7 text-[11px] bg-secondary border-border"
                    autoFocus
                  />
                  <Textarea
                    value={newVoiceContent}
                    onChange={(e) => setNewVoiceContent(e.target.value)}
                    placeholder={"My brand voice:\n- irreverent, self-deprecating\n- target 25-40 tech workers\n- avoid corporate-speak\n- recurring bits: ___"}
                    className="min-h-[80px] text-[11px] bg-secondary border-border resize-none"
                  />
                  <div className="flex gap-1.5 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setNewVoiceOpen(false)} className="h-7 text-[10px] px-2">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveBrandVoice} disabled={savingVoice || !newVoiceName.trim() || !newVoiceContent.trim()} className="h-7 text-[10px] px-2">
                      {savingVoice ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save voice"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Topic / brief</Label>
              <Textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What's the post about? e.g. 'announce our new podcast episode', 'react to today's Apple announcement'…"
                className="min-h-[70px] text-xs bg-secondary border-border resize-none"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Source material <span className="text-muted-foreground/70 font-normal">(optional, grounds the post in facts)</span>
              </Label>
              <Textarea
                value={sourceMaterial}
                onChange={(e) => setSourceMaterial(e.target.value)}
                placeholder="Paste article text, headlines, tweets, bullet points… Anything factual you want the LLM to reference."
                className="min-h-[70px] text-xs bg-secondary border-border resize-none"
              />
              <div className="flex gap-1.5">
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="…or paste a URL to fetch readable article text"
                  className="h-7 text-[11px] bg-secondary border-border"
                  onKeyDown={(e) => { if (e.key === "Enter" && !fetchingUrl) fetchUrl(); }}
                />
                <Button size="sm" variant="outline" onClick={fetchUrl} disabled={fetchingUrl || !sourceUrl.trim()} className="h-7 text-[10px] px-2 gap-1">
                  {fetchingUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />}
                  Fetch
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Paywalled/SPA sites may fail — fall back to pasting.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> Content filter
              </Label>
              <div className="grid grid-cols-3 gap-1">
                {CONTENT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setContentFilter(f.id)}
                    className={cn(
                      "h-7 text-[10px] rounded border transition-colors flex items-center justify-center gap-1",
                      contentFilter === f.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/30",
                    )}
                  >
                    <f.icon className={cn("h-3 w-3", contentFilter === f.id ? f.color : "")} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {tones.map((t) => (
                      <SelectItem key={t} value={t}>
                        <span className="capitalize">{t}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Char limit</Label>
                <Input
                  type="number"
                  min={20}
                  max={10000}
                  value={charLimit}
                  onChange={(e) => { setCharLimit(e.target.value); setCharLimitTouched(true); }}
                  className="h-8 text-xs bg-secondary border-border"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> Target audience <span className="text-muted-foreground/70 font-normal">(optional)</span>
              </Label>
              <Input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g. women 18-35, startup founders, Gen Z gamers"
                className="h-8 text-xs bg-secondary border-border"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between p-2 rounded-md border border-border bg-secondary/30">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-accent" />
                  <span className="text-[11px] font-medium">Generate 3 variants</span>
                </div>
                <Button
                  size="sm"
                  variant={variantsMode ? "default" : "outline"}
                  onClick={() => setVariantsMode((v) => !v)}
                  className="h-6 text-[10px] px-2"
                >
                  {variantsMode ? "On" : "Off"}
                </Button>
              </div>
              {variantsMode && aiProvider !== "ollama" && (
                <p className="text-[10px] text-amber-400/90 flex items-center gap-1 px-1">
                  <AlertTriangle className="h-3 w-3" />
                  Uses ~3× the provider tokens of a normal run ({aiProvider}).
                </p>
              )}
            </div>

            <Button
              onClick={generate}
              disabled={generating || variantsLoading || metaLoading}
              className="w-full gap-2 glow-accent"
            >
              {(generating || variantsLoading)
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {variantsMode ? "Generate 3 options" : "Generate"}
            </Button>

            {/* Variants picker — overlays the usual draft area */}
            {showPicker && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">
                    Pick a variant
                  </Label>
                  <button
                    onClick={() => { setShowPicker(false); setVariants([]); setPickedVariantIdx(null); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <ArrowLeft className="h-3 w-3" /> Back
                  </button>
                </div>

                {variantsLoading ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <p className="text-[11px]">Generating 3 variants in parallel…</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                      {variants.map((v, i) => {
                        const count = v.length;
                        const over = parsedCharLimit != null && count > parsedCharLimit;
                        const preview = splitThread(v);
                        return (
                          <button
                            key={i}
                            onClick={() => setPickedVariantIdx(i)}
                            className={cn(
                              "w-full text-left p-2 rounded-md border transition-all",
                              pickedVariantIdx === i
                                ? "border-primary bg-primary/10"
                                : "border-border bg-secondary/40 hover:border-primary/30",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] font-semibold">Option {i + 1}</span>
                              <span className={cn("text-[10px]", over ? "text-destructive" : "text-muted-foreground")}>
                                {count}{parsedCharLimit ? ` / ${parsedCharLimit}` : ""} chars
                                {preview && ` · ${preview.length}-post thread`}
                              </span>
                            </div>
                            <p className="text-[11px] whitespace-pre-wrap leading-snug line-clamp-6">
                              {v}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    <Button
                      onClick={confirmPickedVariant}
                      disabled={pickedVariantIdx == null}
                      className="w-full gap-2"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Use this one
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Draft result */}
            {!showPicker && draftText && (
              <DraftBlock
                draftText={draftText}
                setDraftText={setDraftText}
                format={format}
                savedDraftId={savedDraftId}
                parsedCharLimit={parsedCharLimit}
                draftCharCount={draftCharCount}
                draftOverLimit={draftOverLimit}
                copied={copied}
                onCopy={copyDraft}
                onSave={saveDraft}
                onDiscard={() => { setDraftText(""); setSavedDraftId(null); }}
              />
            )}
          </CardContent>
        </Card>

        {/* ── Saved drafts ───────────────────────────────────── */}
        <div className="md:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Inbox className="h-3 w-3" /> Drafts
              {posts.length > 0 && <Badge variant="outline" className="text-[10px] ml-1">{posts.length}</Badge>}
            </Label>
          </div>

          {postsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading drafts…
            </div>
          ) : posts.length === 0 ? (
            <Card className="bg-card border-border border-dashed">
              <CardContent className="p-6 text-center text-xs text-muted-foreground space-y-1">
                <Inbox className="h-5 w-5 mx-auto opacity-60" />
                <p>No saved drafts yet.</p>
                <p className="text-[10px]">Generate something on the left and hit Save to keep it.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <TextPostCard
                  key={p.id}
                  post={p}
                  formatLabel={formatLabelFor(p.format)}
                  onChanged={loadPosts}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── DraftBlock ──────────────────────────────────────────────────
// The freshly-generated / in-progress draft. For x_thread format,
// offers a toggle between a per-post visualizer and a raw textarea for
// editing.

interface DraftBlockProps {
  draftText: string;
  setDraftText: (v: string) => void;
  format: string;
  savedDraftId: string | null;
  parsedCharLimit?: number;
  draftCharCount: number;
  draftOverLimit: boolean;
  copied: boolean;
  onCopy: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

function DraftBlock({
  draftText, setDraftText, format, savedDraftId,
  parsedCharLimit, draftCharCount, draftOverLimit,
  copied, onCopy, onSave, onDiscard,
}: DraftBlockProps) {
  const thread: ThreadPost[] | null = useMemo(
    () => (format === "x_thread" ? splitThread(draftText) : null),
    [format, draftText],
  );
  const [rawMode, setRawMode] = useState(false);
  const showThread = thread && !rawMode;

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">
          {savedDraftId ? "Saved draft" : "Fresh draft"}
          {thread && ` · ${thread.length}-post thread`}
        </Label>
        <span className={cn("text-[10px]", draftOverLimit ? "text-destructive" : "text-muted-foreground")}>
          {draftCharCount}{parsedCharLimit ? ` / ${parsedCharLimit}` : ""} chars
        </span>
      </div>

      {showThread ? (
        <ThreadView posts={thread!} />
      ) : (
        <Textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          className="min-h-[140px] text-xs bg-secondary/50 border-border"
        />
      )}

      {thread && (
        <button
          onClick={() => setRawMode((v) => !v)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
        >
          {rawMode ? "Show as thread" : "Edit raw text"}
        </button>
      )}

      {draftOverLimit && !thread && (
        <p className="text-[10px] text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Over the limit — tighten or re-generate.
        </p>
      )}

      <div className="flex gap-1.5 flex-wrap">
        <Button size="sm" variant="outline" onClick={onCopy} className="h-7 text-[10px] px-2 gap-1">
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button size="sm" onClick={onSave} className="h-7 text-[10px] px-2 gap-1">
          <SaveIcon className="h-3 w-3" />
          {savedDraftId ? "Update saved" : "Save to drafts"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDiscard} className="h-7 text-[10px] px-2">
          Discard
        </Button>
      </div>
    </div>
  );
}
