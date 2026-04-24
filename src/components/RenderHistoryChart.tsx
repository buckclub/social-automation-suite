import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, TrendingUp, Clock, Flame, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Range = 7 | 30 | 90;

/**
 * 30/60/90-day render history panel that replaces the old 4 flat stat
 * cards. Shows:
 *   - Today + lifetime totals (renders, success rate, avg render time)
 *   - Per-day bar chart with success/failure split
 *   - Clickable bars → jump to the Videos page (filter by date later)
 *
 * Updates on a 60s poll so running renders bump the chart in near-real-time.
 */
export function RenderHistoryChart() {
  const nav = useNavigate();
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRenderHistory>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.getRenderHistory(range)
        .then((r) => { if (!cancelled) setData(r); })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [range]);

  const peak = useMemo(
    () => (data?.series ?? []).reduce((max, d) => Math.max(max, d.renders), 0) || 1,
    [data]
  );

  if (!data) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-10 text-center text-xs text-muted-foreground">
          Loading history…
        </CardContent>
      </Card>
    );
  }

  const { totals, today, series } = data;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              Render activity
            </CardTitle>
            <div className="flex items-center gap-1">
              {[7, 30, 90].map((r) => (
                <Button
                  key={r}
                  size="sm" variant={range === r ? "default" : "outline"}
                  className="h-6 text-[10px] px-2"
                  onClick={() => setRange(r as Range)}
                >
                  {r}d
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Stat strip — replaces the 4 flat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Stat
              icon={<Flame className="h-3.5 w-3.5 text-primary" />}
              label="Today"
              value={today.successes + today.failures}
              hint={
                today.failures > 0
                  ? `${today.successes} ok · ${today.failures} failed`
                  : today.successes > 0 ? `${today.successes} rendered` : "no renders yet"
              }
            />
            <Stat
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              label={`Last ${range}d`}
              value={totals.successes}
              hint={`${totals.renders} attempts`}
            />
            <Stat
              icon={<TrendingUp className="h-3.5 w-3.5 text-accent" />}
              label="Success rate"
              value={`${totals.success_rate}%`}
              hint={totals.failures > 0 ? `${totals.failures} failures` : "clean slate"}
              valueTone={totals.success_rate >= 90 ? "success" : totals.success_rate >= 70 ? "warning" : "destructive"}
            />
            <Stat
              icon={<Clock className="h-3.5 w-3.5 text-warning" />}
              label="Avg render"
              value={totals.avg_render_s > 0 ? `${totals.avg_render_s}s` : "—"}
              hint="per successful render"
            />
          </div>

          {/* Bar chart */}
          <div className="space-y-1">
            <div className="flex items-end gap-[3px] h-24">
              {series.map((d) => {
                const successFrac = d.successes / peak;
                const failFrac    = d.failures  / peak;
                const successPx   = Math.max(successFrac > 0 ? 2 : 0, Math.round(successFrac * 96));
                const failPx      = Math.max(failFrac    > 0 ? 2 : 0, Math.round(failFrac    * 96));
                const isToday     = d.date === series[series.length - 1]?.date;
                const tooltip     = `${d.date}: ${d.successes} ok${d.failures > 0 ? ` · ${d.failures} failed` : ""}${d.resumes > 0 ? ` · ${d.resumes} resumed` : ""}`;
                return (
                  <button
                    key={d.date}
                    className="flex-1 flex flex-col justify-end rounded-sm hover:bg-secondary/40 transition-colors p-[1px] group"
                    title={tooltip}
                    onClick={() => nav(`/videos?date=${d.date}`)}
                  >
                    {failPx > 0 && (
                      <div
                        className="w-full bg-destructive/70 group-hover:bg-destructive transition-colors"
                        style={{ height: `${failPx}px` }}
                      />
                    )}
                    <div
                      className={`w-full rounded-sm ${isToday ? "bg-primary" : "bg-primary/60"} group-hover:bg-primary transition-colors`}
                      style={{ height: `${successPx}px` }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>{series[0]?.date}</span>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-sm bg-primary" /> success
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-sm bg-destructive/70" /> failed
                </span>
              </span>
              <span>today</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Stat({
  icon, label, value, hint, valueTone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  valueTone?: "success" | "warning" | "destructive";
}) {
  const toneClass =
    valueTone === "success" ? "text-success" :
    valueTone === "warning" ? "text-warning" :
    valueTone === "destructive" ? "text-destructive" :
    "text-foreground";
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-lg font-bold tabular-nums mt-0.5 ${toneClass}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}
