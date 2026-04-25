import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp, Loader2, ArrowLeft, RefreshCw, Eye, ThumbsUp,
  MessageCircle, ExternalLink, Trophy, Youtube,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Analytics = Awaited<ReturnType<typeof api.getPerformanceAnalytics>>;

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtDate(s: string): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return s.slice(0, 10); }
}

/**
 * Performance Analytics — pulls every YT upload tracked in the suite,
 * fetches stats from the YouTube Data API (cached 10 min server-side),
 * and surfaces totals + top performers + a 30-day trend so the user
 * can see what's actually working without leaving the dashboard.
 */
export default function PerformancePage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await api.getPerformanceAnalytics(force);
      setData(r);
    } catch (e: any) {
      setError(e.message || "Failed");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Sparkline path for the 30-day daily-views chart.
  const sparkPath = useMemo(() => {
    if (!data || data.by_day.length < 2) return "";
    const W = 600, H = 60;
    const max = Math.max(...data.by_day.map((d) => d.views), 1);
    const step = W / (data.by_day.length - 1);
    return data.by_day.map((d, i) => {
      const x = i * step;
      const y = H - (d.views / max) * H;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }, [data]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Performance</h1>
            <p className="text-xs text-muted-foreground">
              Live YouTube stats for every video the suite has uploaded.
              {data?.fetched_at && (
                <> Fetched <span className="font-mono">{new Date(data.fetched_at).toLocaleTimeString()}</span>.</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="gap-1"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </div>
      </div>

      {loading && !data && (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          </CardContent>
        </Card>
      )}

      {error && !data && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-3 text-xs text-destructive space-y-1">
            <p>{error}</p>
            {error.toLowerCase().includes("api key") && (
              <p className="text-muted-foreground">
                Set one in <code>Config → Publishing → YouTube API key</code>.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {data && data.totals.videos === 0 && (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground space-y-1">
            <Trophy className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p>No YouTube uploads tracked yet.</p>
            <p>
              Once you publish a video from the Videos page, its stats appear here automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {data && data.totals.videos > 0 && (
        <>
          {/* Totals row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Videos tracked" value={String(data.totals.videos)} sub={`${data.totals.days_tracked}d window`} />
            <StatCard label="Total views"    value={fmtNum(data.totals.views)}    sub={`avg ${fmtNum(data.averages.views)}/video`} accent />
            <StatCard label="Total likes"    value={fmtNum(data.totals.likes)}    sub={`avg ${fmtNum(data.averages.likes)}/video`} />
            <StatCard label="Total comments" value={fmtNum(data.totals.comments)} sub={`avg ${fmtNum(data.averages.comments)}/video`} />
          </div>

          {/* 30-day trend + top performer */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="border-border bg-card lg:col-span-2">
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" /> 30-day views by upload date
                  </p>
                  {data.by_day.length > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {data.by_day[0].date} → {data.by_day[data.by_day.length - 1].date}
                    </span>
                  )}
                </div>
                {data.by_day.length < 2 ? (
                  <p className="text-[10px] text-muted-foreground italic py-8 text-center">
                    Need at least 2 days of uploads for the trend to plot.
                  </p>
                ) : (
                  <svg viewBox="0 0 600 70" className="w-full h-16">
                    <path d={sparkPath} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5 text-primary" /> Top performer
                </p>
                {data.top[0] && (
                  <a
                    href={data.top[0].url} target="_blank" rel="noreferrer"
                    className="block space-y-1 hover:opacity-90 transition-opacity"
                  >
                    {data.top[0].thumbnail && (
                      <img src={data.top[0].thumbnail} alt="" className="w-full rounded aspect-video object-cover bg-black" />
                    )}
                    <p className="text-[11px] font-medium leading-snug line-clamp-2">
                      {data.top[0].title}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <Eye className="h-3 w-3" /> {fmtNum(data.top[0].views)}
                      <span>·</span>
                      <ExternalLink className="h-2.5 w-2.5" /> watch
                    </div>
                  </a>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Per-video table */}
          <Card className="border-border bg-card">
            <CardContent className="p-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <Youtube className="h-3.5 w-3.5 text-[#ff0000]" /> All tracked videos ({data.videos.length})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr className="text-left">
                      <th className="py-1.5 px-2 font-medium">Title</th>
                      <th className="py-1.5 px-2 font-medium text-right">Views</th>
                      <th className="py-1.5 px-2 font-medium text-right">Likes</th>
                      <th className="py-1.5 px-2 font-medium text-right">Comments</th>
                      <th className="py-1.5 px-2 font-medium">Published</th>
                      <th className="py-1.5 px-2 font-medium">Status</th>
                      <th className="py-1.5 px-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((v) => (
                      <tr key={v.yt_video_id} className="border-b border-border/40 last:border-0 hover:bg-secondary/30">
                        <td className="py-1.5 px-2 max-w-[260px]">
                          <div className="flex items-center gap-2">
                            {v.thumbnail && (
                              <img src={v.thumbnail} alt="" className="w-12 h-7 object-cover rounded shrink-0 bg-black" />
                            )}
                            <span className="truncate" title={v.title}>{v.title}</span>
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">{fmtNum(v.views)}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-muted-foreground">{fmtNum(v.likes)}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums text-muted-foreground">{fmtNum(v.comments)}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{fmtDate(v.published_at)}</td>
                        <td className="py-1.5 px-2">
                          <Badge variant="outline" className={cn(
                            "text-[9px] px-1.5 py-0 capitalize",
                            v.privacy_status === "public" && "border-success/40 text-success",
                            v.privacy_status === "unlisted" && "border-amber-400/40 text-amber-400",
                            v.privacy_status === "private" && "border-muted-foreground/40 text-muted-foreground",
                          )}>
                            {v.privacy_status || "?"}
                          </Badge>
                        </td>
                        <td className="py-1.5 px-2">
                          <a href={v.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground text-center">
            Stats cached server-side for 10 min to conserve YouTube API quota. Click <b>Refresh</b> to force-fetch.
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <Card className={cn("border-border bg-card", accent && "border-primary/30 bg-primary/5")}>
      <CardContent className="p-3 space-y-0.5">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className={cn("text-2xl font-bold tabular-nums", accent && "text-primary")}>{value}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
