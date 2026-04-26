import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { DollarSign, Mic, Brain, Zap, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

/**
 * Usage / cost panel on the Dashboard. Combines:
 *   - ElevenLabs live character balance (via their /v1/user endpoint)
 *   - Local ledger counting everything else: AI tokens per provider +
 *     TTS chars for non-ElevenLabs engines (Streamlabs, VibeVoice, etc.)
 *
 * We can't report real $ because each user has a different plan, but
 * character/token counts are enough to catch 'oh shit I burned through
 * my month' moments.
 */
export function CostTrackerPanel() {
  const [cost, setCost] = useState<Awaited<ReturnType<typeof api.getCostSummary>> | null>(null);
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof api.getElevenLabsBalance>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const c = await api.getCostSummary();
        if (!cancelled) setCost(c);
      } catch {}
      try {
        const b = await api.getElevenLabsBalance();
        if (!cancelled) setBalance(b);
      } catch {
        if (!cancelled) setBalance(null);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const month = cost?.month ?? {};
  const today = cost?.today ?? {};
  const el = (month.elevenlabs?.chars as number) || 0;

  // Aggregate AI totals across providers (in/out chars, calls).
  const aiProviders = ["gemini", "openrouter", "ollama", "nvidia_nim"] as const;
  const aiRows = aiProviders
    .map((p) => ({ name: p, ...(month[p] || {}) }))
    .filter((r) => (r as any).calls > 0);
  const totalAiCalls = aiRows.reduce((s, r) => s + ((r as any).calls || 0), 0);
  const totalAiChars = aiRows.reduce((s, r) => s + ((r as any).in_chars || 0) + ((r as any).out_chars || 0), 0);

  // Today's stats — same shape as month, just one day's slice.
  const todayChars =
    ((today.elevenlabs?.chars as number) || 0) +
    aiProviders.reduce((s, p) => s + ((today[p]?.in_chars as number) || 0) + ((today[p]?.out_chars as number) || 0), 0);
  const todayCalls = aiProviders.reduce((s, p) => s + ((today[p]?.calls as number) || 0), 0);

  const fmt = (n: number) => n.toLocaleString();

  // Rough month-to-date $ estimate. Uses public list rates as of late
  // 2025; real billing depends on the user's plan + which model
  // variant they pick. We deliberately under-promise on precision —
  // this is a "watch the trend" gauge, not an invoice.
  //
  // ElevenLabs:  $0.18 / 1K chars (typical Starter plan effective rate)
  // Gemini:      $0.10 / 1M input + $0.40 / 1M output (Flash 2.0)
  // NVIDIA NIM / OpenRouter / Ollama: skipped — vary too widely or are free.
  const estCost = (() => {
    const elCost = (el / 1000) * 0.18;
    const gemini = month.gemini || {};
    const gIn  = ((gemini.in_chars as number)  || 0) / 4;  // chars→tokens
    const gOut = ((gemini.out_chars as number) || 0) / 4;
    const gemCost = (gIn / 1_000_000) * 0.10 + (gOut / 1_000_000) * 0.40;
    return elCost + gemCost;
  })();

  // Days-into-month projection, only meaningful after a few days of data.
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const showProjection = dayOfMonth >= 3 && estCost > 0.10;
  const projectedMonthEnd = showProjection ? estCost * (daysInMonth / dayOfMonth) : null;

  // ElevenLabs balance bar
  const elPct = balance?.available && balance.character_limit
    ? Math.min(100, Math.round(((balance.character_count ?? 0) / balance.character_limit) * 100))
    : null;
  const elColor = elPct == null ? "" :
    elPct >= 90 ? "bg-destructive" :
    elPct >= 70 ? "bg-warning" : "bg-success";
  const resetStr = balance?.next_character_count_reset_unix
    ? new Date(balance.next_character_count_reset_unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-success" />
            Usage this month
            <Badge variant="outline" className="text-[9px] ml-auto">UTC</Badge>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-xs">
          {/* Top-of-panel summary: $ estimate + today's activity. The
              detail blocks below break this down per provider; this
              tile is the "is anything running away from me?" glance.
              List-rate $ math is in the component above — clearly
              labeled as approximate. */}
          <div className="flex items-stretch gap-2">
            <div className="flex-1 rounded-md border border-border bg-secondary/30 p-2.5">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Est. spend MTD</div>
              <div className="text-base font-semibold mt-0.5">
                ${estCost.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {projectedMonthEnd != null
                  ? <>Projected month-end: <strong>${projectedMonthEnd.toFixed(2)}</strong></>
                  : "Approx — varies by plan / model"}
              </div>
            </div>
            <div className="flex-1 rounded-md border border-border bg-secondary/30 p-2.5">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Today</div>
              <div className="text-base font-semibold mt-0.5">
                {fmt(todayCalls)} <span className="text-[10px] font-normal text-muted-foreground">AI calls</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {fmt(todayChars)} chars across all providers
              </div>
            </div>
          </div>

          {/* ElevenLabs live balance */}
          <div className="rounded-md border border-border bg-secondary/30 p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Mic className="h-3 w-3 text-primary" />
              <span className="font-semibold">ElevenLabs</span>
              {balance?.tier && (
                <Badge variant="outline" className="text-[9px] ml-1">{balance.tier}</Badge>
              )}
              {balance?.available ? (
                <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                  {fmt(balance.character_count ?? 0)} / {fmt(balance.character_limit ?? 0)}
                </span>
              ) : (
                <span className="ml-auto text-[10px] text-muted-foreground">no API key</span>
              )}
            </div>

            {elPct != null && (
              <>
                <div className="h-1 rounded-full bg-background overflow-hidden">
                  <div className={`h-full ${elColor} transition-all`} style={{ width: `${elPct}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{elPct}% used</span>
                  {resetStr && <span>resets {resetStr}</span>}
                </div>
              </>
            )}

            {!balance?.available && (
              <p className="text-[10px] text-muted-foreground">
                Add your ElevenLabs API key in <strong>Config → TTS</strong> to see your live balance.
                Local tally this month: <strong>{fmt(el)}</strong> chars.
              </p>
            )}

            {balance?.available && elPct != null && elPct >= 90 && (
              <div className="flex items-start gap-1.5 text-[10px] text-destructive mt-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Under 10% remaining — next render may truncate.</span>
              </div>
            )}
          </div>

          {/* AI tokens */}
          <div className="rounded-md border border-border bg-secondary/30 p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Brain className="h-3 w-3 text-accent" />
              <span className="font-semibold">AI providers</span>
              <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                {fmt(totalAiCalls)} calls · {fmt(totalAiChars)} chars
              </span>
            </div>
            {aiRows.length === 0 ? (
              <p className="text-[10px] text-muted-foreground">
                No AI calls this month yet.
              </p>
            ) : (
              <div className="space-y-0.5">
                {aiRows.map((r: any) => {
                  const tokensIn  = Math.round((r.in_chars  ?? 0) / 4);
                  const tokensOut = Math.round((r.out_chars ?? 0) / 4);
                  return (
                    <div key={r.name} className="flex items-center justify-between text-[10px]">
                      <span className="capitalize">{r.name.replace("_", " ")}</span>
                      <span className="text-muted-foreground font-mono">
                        {r.calls} calls · ~{fmt(tokensIn)} in / {fmt(tokensOut)} out tokens
                      </span>
                    </div>
                  );
                })}
                <p className="text-[9px] text-muted-foreground italic pt-0.5 border-t border-border/40">
                  Token count is approximate (chars ÷ 4). Real billing depends on each provider's tokenizer.
                </p>
              </div>
            )}
          </div>

          {/* 30-day sparkline */}
          {cost?.series_30d?.length ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3" />
                <span>Daily usage across all providers (last 30 days)</span>
              </div>
              <div className="flex items-end gap-[2px] h-10">
                {cost.series_30d.map((d) => {
                  const peak = Math.max(1, ...cost.series_30d.map((x) => x.chars));
                  const h = Math.max(1, Math.round((d.chars / peak) * 36));
                  return (
                    <div
                      key={d.date}
                      className="flex-1 bg-accent/60 rounded-sm"
                      style={{ height: `${h}px` }}
                      title={`${d.date}: ${fmt(d.chars)} chars`}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  );
}
