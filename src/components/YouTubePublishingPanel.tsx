import { useEffect, useState } from "react";
import { Youtube, CheckCircle2, XCircle, Loader2, ExternalLink, Unplug, Gauge, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AlertTriangle } from "lucide-react";

interface QuotaSnapshot {
  today: string;
  daily_limit: number;
  used_today: number;
  remaining: number;
  pct_used: number;
  events_today: Record<string, number>;
  history: { date: string; total: number }[];
  reset_at: string;
  seconds_until_reset: number;
}

function formatResetIn(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 1) return `${m}m`;
  return `${h}h ${m}m`;
}

function QuotaWidget() {
  const { toast } = useToast();
  const [q, setQ] = useState<QuotaSnapshot | null>(null);
  const [limitInput, setLimitInput] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const refresh = async () => {
    try {
      const s = await api.youtubeQuota();
      setQ(s);
      if (!limitInput) setLimitInput(String(s.daily_limit));
    } catch (e: any) {
      toast({ title: "Couldn't load quota", description: e.message, variant: "destructive" });
    }
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, []);

  if (!q) return null;

  const pct = q.pct_used;
  const barColor = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-warning" : "bg-success";
  const uploadsLeft = Math.floor(q.remaining / 1600);

  const saveLimit = async () => {
    const n = parseInt(limitInput, 10);
    if (!n || n < 1) { toast({ title: "Enter a positive number", variant: "destructive" }); return; }
    setSavingLimit(true);
    try {
      await api.youtubeQuotaSetLimit(n);
      toast({ title: "Daily limit updated" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingLimit(false);
    }
  };

  const doReset = async () => {
    setResetConfirmOpen(false);
    setResetting(true);
    try {
      await api.youtubeQuotaReset();
      toast({ title: "Today's counter cleared" });
      await refresh();
    } catch (e: any) {
      toast({ title: "Reset failed", description: e.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex items-center gap-2">
        <Gauge className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Quota usage</span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          resets in {formatResetIn(q.seconds_until_reset)}
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="font-mono">{q.used_today.toLocaleString()} / {q.daily_limit.toLocaleString()} units</span>
          <span className="font-mono text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-background overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          ~{uploadsLeft} upload{uploadsLeft === 1 ? "" : "s"} left today (1,600 units each).
          Benchmarks search is 101 units; cached 24h so re-generations are free.
        </p>
      </div>

      {/* Per-operation breakdown */}
      {Object.keys(q.events_today).length > 0 && (
        <div className="pt-1 border-t border-border/60">
          <p className="text-[10px] text-muted-foreground mb-1">Today's calls</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(q.events_today).map(([op, count]) => (
              <Badge key={op} variant="outline" className="text-[9px] font-mono">
                {op} × {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* History sparkline */}
      {q.history.length > 1 && (
        <div className="pt-1 border-t border-border/60">
          <p className="text-[10px] text-muted-foreground mb-1">Last {q.history.length} days</p>
          <div className="flex items-end gap-0.5 h-8">
            {q.history.map((d) => {
              const h = q.daily_limit > 0 ? Math.max(2, Math.round((d.total / q.daily_limit) * 32)) : 2;
              const over = d.total >= q.daily_limit * 0.9;
              return (
                <div
                  key={d.date}
                  className={`flex-1 rounded-sm ${over ? "bg-destructive" : "bg-primary/60"}`}
                  style={{ height: `${h}px` }}
                  title={`${d.date}: ${d.total.toLocaleString()} units`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Admin controls */}
      <div className="flex items-end gap-2 pt-1 border-t border-border/60">
        <div className="space-y-0.5 flex-1">
          <Label className="text-[10px] text-muted-foreground">Daily limit (if you got a quota bump)</Label>
          <Input
            type="number"
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className="h-7 text-[11px] bg-secondary border-border font-mono"
          />
        </div>
        <Button size="sm" variant="outline" onClick={saveLimit} disabled={savingLimit} className="h-7 gap-1 text-[10px]">
          {savingLimit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => setResetConfirmOpen(true)} disabled={resetting} className="h-7 gap-1 text-[10px]" title="Zero today's counter (use after Google issues a manual reset)">
          {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          Reset today
        </Button>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Reset today's quota counter?"
        icon={<AlertTriangle className="h-4 w-4 text-warning" />}
        description={
          <>
            Zeros the local ledger for today. Use this only if Google issued you
            a manual quota reset, or the counter drifted from reality. Doesn't
            affect your actual YouTube API quota — just what we think we've used.
          </>
        }
        confirmLabel="Reset counter"
        variant="warning"
        onConfirm={doReset}
        isLoading={resetting}
      />
    </div>
  );
}

interface YtStatus {
  has_credentials: boolean;
  connected: boolean;
  channel_title: string;
  channel_id: string;
  custom_url: string;
}

export function YouTubePublishingPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<YtStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const refresh = async () => {
    try {
      const s = await api.youtubeStatus();
      setStatus(s);
    } catch (e: any) {
      toast({ title: "Couldn't load YouTube status", description: e.message, variant: "destructive" });
    }
  };

  useEffect(() => { refresh(); }, []);

  // Listen for the OAuth popup's postMessage so we refresh status without
  // the user having to click anything after consenting.
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev?.data?.youtubeOauth === "done") {
        toast({ title: "YouTube connected" });
        refresh();
      } else if (ev?.data?.youtubeOauth === "error") {
        toast({ title: "YouTube authorization failed", variant: "destructive" });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const saveCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: "Both client_id and client_secret are required", variant: "destructive" });
      return;
    }
    setSavingCreds(true);
    try {
      await api.youtubeSaveCredentials(clientId.trim(), clientSecret.trim());
      toast({ title: "Credentials saved" });
      setClientId(""); setClientSecret("");
      await refresh();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingCreds(false);
    }
  };

  const connect = async () => {
    setLoading(true);
    try {
      // Pass our page's host so the callback URL matches what we actually
      // serve on (localhost vs 127.0.0.1 vs LAN IP all work).
      const host = typeof window !== "undefined" ? window.location.host : "localhost:8000";
      const { auth_url } = await api.youtubeOauthStart(host);
      const popup = window.open(auth_url, "yt-oauth", "width=500,height=720");
      if (!popup) {
        toast({
          title: "Popup blocked",
          description: "Allow popups for this site and try again.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Connect failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setDisconnectOpen(false);
    try {
      await api.youtubeDisconnect();
      toast({ title: "YouTube disconnected" });
      refresh();
    } catch (e: any) {
      toast({ title: "Disconnect failed", description: e.message, variant: "destructive" });
    }
  };

  if (!status) {
    return <div className="flex items-center gap-2 text-xs text-muted-foreground py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <QuotaWidget />

      {/* Connection status */}
      <div className="flex items-center gap-2">
        {status.connected ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-xs">
              Connected as <strong>{status.channel_title || "(unknown)"}</strong>
              {status.custom_url && <span className="text-muted-foreground ml-1">({status.custom_url})</span>}
            </span>
            <Badge variant="outline" className="ml-auto text-[10px] border-success/40 text-success">ready</Badge>
          </>
        ) : status.has_credentials ? (
          <>
            <XCircle className="h-4 w-4 text-warning" />
            <span className="text-xs">Credentials saved — finish OAuth to upload.</span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs">Not set up yet.</span>
          </>
        )}
      </div>

      {/* Setup instructions (collapsed once connected) */}
      {!status.has_credentials && (
        <div className="rounded-md border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">One-time setup</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google Cloud Console → Credentials</a>.</li>
            <li>Pick the same project where you enabled YouTube Data API v3.</li>
            <li>Create Credentials → <strong>OAuth 2.0 Client ID</strong> → application type <strong>Desktop app</strong>.</li>
            <li>Paste the resulting <code>client_id</code> and <code>client_secret</code> below, save, then click Connect.</li>
          </ol>
          <p className="text-[10px] italic">The API key you already have (for benchmarks) is a different thing — YouTube requires OAuth for uploads, not an API key.</p>
        </div>
      )}

      {/* Credentials form — shown until connected */}
      {!status.connected && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">OAuth Client ID</Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={status.has_credentials ? "••••••••  (already saved, enter to replace)" : "...apps.googleusercontent.com"}
              className="h-8 text-xs bg-secondary border-border font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">OAuth Client Secret</Label>
            <SecretInput
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={status.has_credentials ? "•••••••• (already saved)" : "GOCSPX-..."}
              inputClassName="h-8 text-xs bg-secondary border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveCreds} disabled={savingCreds}>
              {savingCreds ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save credentials
            </Button>
            {status.has_credentials && (
              <Button size="sm" onClick={connect} disabled={loading} className="gap-1">
                <Youtube className="h-3.5 w-3.5" />
                Connect YouTube
                {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Connected controls */}
      {status.connected && (
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline"
            onClick={() => window.open(`https://youtube.com/channel/${status.channel_id}`, "_blank")}
            className="gap-1"
          >
            <ExternalLink className="h-3 w-3" /> Open channel
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDisconnectOpen(true)} className="gap-1 text-destructive hover:text-destructive">
            <Unplug className="h-3 w-3" /> Disconnect
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect YouTube?"
        icon={<AlertTriangle className="h-4 w-4 text-warning" />}
        description={
          <>
            Removes the stored refresh token. You'll need to go through the OAuth
            flow again before you can upload more videos. Previously uploaded
            videos on your channel are unaffected.
          </>
        }
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={disconnect}
      />
    </div>
  );
}
