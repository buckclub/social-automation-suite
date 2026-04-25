/**
 * First-run wizard.
 *
 * Surfaces when the user has just cloned + started the app and hasn't
 * configured anything yet (detection lives in FirstRunGate). Walks them
 * through the 4 things they MUST set before anything works:
 *
 *   1. AI provider + key      → Generate-with-AI, scoring, social copy
 *   2. TTS provider + key     → narrating videos
 *   3. (optional) brand name  → snapshot the chosen settings as a
 *                               starting brand profile
 *   4. (optional) YouTube key → only needed for performance analytics
 *
 * Everything else (publishing OAuth, Pexels, Discord webhooks, etc.) is
 * a "configure when you need it" feature — the wizard intentionally
 * doesn't ask, otherwise it'd be 12 steps long.
 *
 * Saving uses PUT /api/config with deep-merge semantics, so each step
 * just sends the keys it changes — no need to round-trip the entire
 * config blob.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Mic, Tag, Youtube, ArrowRight, ArrowLeft, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

import { api } from "@/lib/api";
import { useConfig, useUpdateConfig } from "@/hooks/use-api";

// AI providers we can switch between. Local providers (ollama) need a
// URL instead of a key — a tiny branch in the form handles that.
type AiProvider = "gemini" | "openrouter" | "nvidia_nim" | "ollama";
type TtsProvider = "elevenlabs" | "streamlabs_polly" | "vibevoice" | "qwen3tts";

const AI_OPTIONS: { value: AiProvider; label: string; help: string; needs: "key" | "url" }[] = [
  { value: "gemini",      label: "Google Gemini",   help: "Free tier is generous; ai.studio/google.com",  needs: "key" },
  { value: "openrouter",  label: "OpenRouter",      help: "Single key for 100+ models; openrouter.ai",   needs: "key" },
  { value: "nvidia_nim",  label: "NVIDIA NIM",      help: "Free dev tier; build.nvidia.com",             needs: "key" },
  { value: "ollama",      label: "Ollama (local)",  help: "Self-hosted — no key, just the URL",          needs: "url" },
];

const TTS_OPTIONS: { value: TtsProvider; label: string; help: string; needs: "key" | "none" }[] = [
  { value: "elevenlabs",       label: "ElevenLabs",        help: "Best voices, ~10k free chars/month — elevenlabs.io", needs: "key" },
  { value: "streamlabs_polly", label: "Streamlabs Polly",  help: "Free, no signup — robotic but works",                needs: "none" },
  { value: "vibevoice",        label: "VibeVoice (local)", help: "Self-hosted; needs the model on disk",               needs: "none" },
  { value: "qwen3tts",         label: "Qwen3-TTS (local)", help: "Self-hosted, fast on a GPU",                         needs: "none" },
];

export default function FirstRunPage() {
  const nav = useNavigate();
  const { toast } = useToast();
  const cfg = useConfig();
  const updateCfg = useUpdateConfig();

  // Step machine. We commit each step's config slice on Next, so a
  // user who quits halfway through still has their first answers
  // saved — no partial-but-lost state.
  const [step, setStep] = useState(0);

  // Step 1 — AI provider
  const [aiProvider, setAiProvider] = useState<AiProvider>("gemini");
  const [aiKey, setAiKey] = useState("");
  const [aiUrl, setAiUrl] = useState("http://localhost:11434");
  const [aiModel, setAiModel] = useState("gemini-2.0-flash");

  // Step 2 — TTS provider
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>("elevenlabs");
  const [ttsKey, setTtsKey] = useState("");

  // Step 3 — brand name (optional)
  const [brandName, setBrandName] = useState("");

  // Step 4 — YouTube key (optional)
  const [ytKey, setYtKey] = useState("");

  // Hydrate from current config so a partial setup can resume cleanly.
  // We only run this ONCE per dialog session — re-running every time
  // the user changes provider would clobber their typed key with a
  // stored key for a different provider.
  //
  // Previously the effect read `aiProvider` from closure and gated
  // the gemini branch on it — that branch always saw the *initial*
  // "gemini" value, so when the user picked another provider and the
  // hydration effect re-fired, it could overwrite their typed key
  // with a stale gemini key. Now we read the saved provider directly
  // off `g.provider` and choose the matching key field, with no
  // closure dependency on local state.
  const [didHydrate, setDidHydrate] = useState(false);
  useEffect(() => {
    if (didHydrate) return;
    const c = cfg.data;
    if (!c) return;
    const g = (c.gemini ?? {}) as Record<string, string>;
    const savedProvider = (g.provider as AiProvider) || "gemini";
    setAiProvider(savedProvider);
    // Pick the key field that matches the SAVED provider, not whatever
    // local state currently holds.
    const savedKey =
      savedProvider === "gemini"     ? g.api_key :
      savedProvider === "openrouter" ? g.openrouter_api_key :
      savedProvider === "nvidia_nim" ? g.nvidia_nim_api_key : "";
    if (savedKey) setAiKey(savedKey);
    if (g.ollama_url) setAiUrl(g.ollama_url);
    if (g.model) setAiModel(g.model);

    const t = (c.tts ?? {}) as Record<string, unknown>;
    if (typeof t.provider === "string") setTtsProvider(t.provider as TtsProvider);
    if (typeof t.elevenlabs_api_key === "string") setTtsKey(t.elevenlabs_api_key);

    const y = (c.youtube ?? {}) as Record<string, string>;
    if (y.api_key) setYtKey(y.api_key);

    setDidHydrate(true);
  }, [cfg.data, didHydrate]);

  const aiOpt = useMemo(() => AI_OPTIONS.find(o => o.value === aiProvider)!, [aiProvider]);
  const ttsOpt = useMemo(() => TTS_OPTIONS.find(o => o.value === ttsProvider)!, [ttsProvider]);

  // Default model suggestion per provider so users don't have to know
  // the exact identifier strings off the top of their head.
  function defaultModelFor(p: AiProvider): string {
    if (p === "gemini")     return "gemini-2.0-flash";
    if (p === "openrouter") return "anthropic/claude-3.5-sonnet";
    if (p === "nvidia_nim") return "meta/llama-3.1-70b-instruct";
    return "qwen2.5:14b"; // ollama
  }

  function changeAiProvider(p: AiProvider) {
    setAiProvider(p);
    setAiModel(defaultModelFor(p));
    setAiKey(""); // keys aren't reusable across providers
  }

  // ── Step commit handlers ────────────────────────────────────────────

  async function commitAi() {
    const patch: Record<string, unknown> = {
      gemini: {
        enabled: true,
        provider: aiProvider,
        model: aiModel,
        // Each provider has its own field — only set the one for the
        // active provider, leave the others alone.
        ...(aiProvider === "gemini"     ? { api_key: aiKey } : {}),
        ...(aiProvider === "openrouter" ? { openrouter_api_key: aiKey } : {}),
        ...(aiProvider === "nvidia_nim" ? { nvidia_nim_api_key: aiKey } : {}),
        ...(aiProvider === "ollama"     ? { ollama_url: aiUrl } : {}),
      },
    };
    await updateCfg.mutateAsync(patch);
  }

  async function commitTts() {
    const patch: Record<string, unknown> = {
      tts: {
        provider: ttsProvider,
        ...(ttsProvider === "elevenlabs" ? { elevenlabs_api_key: ttsKey } : {}),
      },
    };
    await updateCfg.mutateAsync(patch);
  }

  async function commitYoutube() {
    if (!ytKey) return;
    await updateCfg.mutateAsync({ youtube: { api_key: ytKey } });
  }

  async function commitBrand() {
    if (!brandName.trim()) return;
    // snapshot_current=true grabs the AI/TTS/YT keys we just saved so
    // the brand has the user's whole stack baked in.
    await api.createBrand({ name: brandName.trim(), snapshot_current: true });
  }

  // Step validation — Next only enables when the step's required
  // inputs are filled. Optional steps always allow Next/Skip.
  const canNext = useMemo(() => {
    if (step === 0) {
      if (aiOpt.needs === "key") return aiKey.trim().length > 4;
      return aiUrl.trim().length > 4;
    }
    if (step === 1) {
      if (ttsOpt.needs === "key") return ttsKey.trim().length > 4;
      return true; // free providers
    }
    return true;
  }, [step, aiOpt.needs, aiKey, aiUrl, ttsOpt.needs, ttsKey]);

  const [busy, setBusy] = useState(false);
  async function next() {
    setBusy(true);
    try {
      if (step === 0) await commitAi();
      else if (step === 1) await commitTts();
      else if (step === 2) await commitBrand();
      else if (step === 3) await commitYoutube();

      if (step < 3) {
        setStep(s => s + 1);
      } else {
        toast({ title: "All set!", description: "You're ready to make videos." });
        // Land on the dashboard. The gate will recompute and stay out
        // of the way now that AI is configured.
        nav("/", { replace: true });
      }
    } catch (e: unknown) {
      toast({
        title: "Couldn't save",
        description: e instanceof Error ? e.message : "Try again — the server might be starting.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    // Skip is only meaningful for the optional steps (2, 3). Steps 0
    // and 1 require input — the button is disabled in that case.
    if (step >= 2) setStep(s => s + 1);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-6">
      <div className="w-full max-w-2xl bg-card border rounded-2xl shadow-xl p-8 space-y-6">
        {/* Header / progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome to Social Automation Suite
            </h1>
            <span className="text-sm text-muted-foreground">
              Step {step + 1} of 4
            </span>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i < step
                    ? "bg-primary"
                    : i === step
                      ? "bg-primary/70"
                      : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step body */}
        {step === 0 && (
          <StepShell
            icon={<Sparkles className="h-5 w-5" />}
            title="Pick an AI provider"
            sub="Used for scripts, scoring posts, and social copy. You can switch later in Config → AI Hooks."
          >
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={aiProvider} onValueChange={(v) => changeAiProvider(v as AiProvider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{aiOpt.help}</p>
            </div>
            {aiOpt.needs === "key" ? (
              <div className="space-y-2">
                <Label htmlFor="aikey">API key</Label>
                <Input
                  id="aikey"
                  type="password"
                  value={aiKey}
                  onChange={e => setAiKey(e.target.value)}
                  placeholder="paste your key"
                  autoFocus
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="aiurl">Ollama URL</Label>
                <Input
                  id="aiurl"
                  value={aiUrl}
                  onChange={e => setAiUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="aimodel">Default model</Label>
              <Input
                id="aimodel"
                value={aiModel}
                onChange={e => setAiModel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Per-feature model overrides live in Config — this is the fallback.
              </p>
            </div>
          </StepShell>
        )}

        {step === 1 && (
          <StepShell
            icon={<Mic className="h-5 w-5" />}
            title="Pick a TTS voice provider"
            sub="Turns scripts into narrated audio. ElevenLabs has the best voices; the free options work fine to start."
          >
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={ttsProvider} onValueChange={(v) => setTtsProvider(v as TtsProvider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TTS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ttsOpt.help}</p>
            </div>
            {ttsOpt.needs === "key" && (
              <div className="space-y-2">
                <Label htmlFor="ttskey">ElevenLabs API key</Label>
                <Input
                  id="ttskey"
                  type="password"
                  value={ttsKey}
                  onChange={e => setTtsKey(e.target.value)}
                  placeholder="paste your key"
                  autoFocus
                />
              </div>
            )}
            {ttsOpt.needs === "none" && (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No key needed — {ttsOpt.label} runs without authentication.
              </div>
            )}
          </StepShell>
        )}

        {step === 2 && (
          <StepShell
            icon={<Tag className="h-5 w-5" />}
            title="Name your first brand"
            sub="Brands snapshot your AI + TTS + caption settings so you can run multiple channels with one app. Skip if you only have one channel."
            optional
          >
            <div className="space-y-2">
              <Label htmlFor="brand">Brand / channel name</Label>
              <Input
                id="brand"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="e.g. Reddit Stories Daily"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                We'll snapshot the keys you just entered as this brand's defaults.
              </p>
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell
            icon={<Youtube className="h-5 w-5" />}
            title="Add your YouTube API key"
            sub="Optional — only needed for the Performance dashboard (view counts on your uploads). Doesn't affect publishing."
            optional
          >
            <div className="space-y-2">
              <Label htmlFor="ytkey">YouTube Data API v3 key</Label>
              <Input
                id="ytkey"
                type="password"
                value={ytKey}
                onChange={e => setYtKey(e.target.value)}
                placeholder="AIza…"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Create one at console.cloud.google.com → APIs &amp; Services → Credentials. Free tier: 10k units/day.
              </p>
            </div>
          </StepShell>
        )}

        {/* Footer / nav */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
          <div className="flex gap-2">
            {step >= 2 && (
              <Button variant="ghost" onClick={skip} disabled={busy}>
                Skip
              </Button>
            )}
            <Button onClick={next} disabled={!canNext || busy}>
              {busy
                ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                : step === 3
                  ? <Check className="h-4 w-4 mr-1.5" />
                  : null}
              {step === 3 ? "Finish" : "Next"}
              {!busy && step !== 3 && <ArrowRight className="h-4 w-4 ml-1.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section shell — shared header for each step ─────────────────────
function StepShell({
  icon, title, sub, children, optional = false,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          {icon}
          <h2 className="font-medium text-foreground">{title}</h2>
          {optional && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              optional
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
      {children}
    </div>
  );
}
