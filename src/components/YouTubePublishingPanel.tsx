import { useEffect, useState } from "react";
import { Youtube, CheckCircle2, XCircle, Loader2, ExternalLink, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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
    if (!confirm("Disconnect YouTube? You'll need to re-authorize to upload again.")) return;
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
          <Button size="sm" variant="outline" onClick={disconnect} className="gap-1 text-destructive hover:text-destructive">
            <Unplug className="h-3 w-3" /> Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
