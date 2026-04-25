/**
 * FirstRunGate — decides whether to push the user to /setup before
 * letting them into the rest of the app.
 *
 * "First run" = no usable AI provider has been configured yet. Once
 * any of the AI key fields is filled in, the gate stays out of the way
 * for the rest of the session (and forever, unless the user wipes
 * config.json).
 *
 * We check AI specifically because it's the one input the app cannot
 * proceed without — every video pipeline path eventually calls into
 * gemini_hooks for either scoring, scripting, or social copy. TTS has
 * a free fallback (Streamlabs Polly), so we don't block on it.
 *
 * The gate sits inside HashRouter (so it can use useNavigate) but
 * outside AppLayout (so the wizard renders fullscreen, no sidebar).
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useConfig } from "@/hooks/use-api";

function isAiConfigured(cfg: unknown): boolean {
  if (!cfg || typeof cfg !== "object") return false;
  const g = (cfg as { gemini?: Record<string, unknown> }).gemini ?? {};
  // Any one of the provider-specific fields counts. We don't insist on
  // `enabled: true` because users might toggle that off temporarily —
  // having keys saved is the durable signal of "I've been through
  // setup."
  const has = (k: string) => typeof g[k] === "string" && (g[k] as string).trim().length > 4;
  return has("api_key")
      || has("openrouter_api_key")
      || has("nvidia_nim_api_key")
      || has("ollama_url");
}

export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const cfg = useConfig();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (cfg.isLoading || cfg.isError) return;
    const onSetup = loc.pathname === "/setup";
    const configured = isAiConfigured(cfg.data);

    // Two transitions to handle:
    // - unconfigured + not on /setup  → redirect IN
    // - configured   + on /setup      → redirect OUT (user finished
    //   the wizard, or hit /setup manually after configuring)
    if (!configured && !onSetup) {
      nav("/setup", { replace: true });
    } else if (configured && onSetup) {
      nav("/", { replace: true });
    }
  }, [cfg.isLoading, cfg.isError, cfg.data, loc.pathname, nav]);

  return <>{children}</>;
}
