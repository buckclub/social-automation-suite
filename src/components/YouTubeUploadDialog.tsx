import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Youtube, Loader2, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props {
  videoId: string;
  videoTitle: string;
  partIndex?: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type Privacy = "public" | "unlisted" | "private";

// Build a local-datetime-input value (`YYYY-MM-DDTHH:mm`) anchored 24h ahead
// so "schedule for tomorrow at this time" is one click away.
function defaultFutureLocal(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a local-datetime-input value to a UTC ISO string YouTube will accept.
function localToUtcIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);  // browser parses in local TZ
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function YouTubeUploadDialog({ videoId, videoTitle, partIndex = 0, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [channelTitle, setChannelTitle] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [schedule, setSchedule] = useState(false);
  const [publishLocal, setPublishLocal] = useState<string>(defaultFutureLocal());
  const [uploading, setUploading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string>("");

  // Pre-fill from saved social copy + connection status on open.
  useEffect(() => {
    if (!open) return;
    setResultUrl("");
    setSchedule(false);
    setPublishLocal(defaultFutureLocal());
    api.youtubeStatus().then((s) => {
      setConnected(s.connected);
      setChannelTitle(s.channel_title || "");
    }).catch(() => setConnected(false));

    api.getSocialCopy(videoId).then((s) => {
      const y = (s as any)?.youtube || {};
      setTitle((y.titles?.[0] || videoTitle || "").slice(0, 100));
      setDescription(y.description || videoTitle || "");
      setTags((y.tags || []).join(", "));
    }).catch(() => {
      setTitle(videoTitle || "");
      setDescription(videoTitle || "");
      setTags("reddit, redditstories, shorts");
    });
  }, [open, videoId, videoTitle]);

  const handleUpload = async () => {
    if (!connected) {
      toast({ title: "Not connected", description: "Open Config → Publishing to connect YouTube.", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const publishAt = schedule ? localToUtcIso(publishLocal) : undefined;
    if (schedule && (!publishAt || new Date(publishAt).getTime() <= Date.now() + 60_000)) {
      toast({ title: "Schedule time must be at least 1 minute in the future", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const r = await api.youtubeUpload({
        video_id: videoId,
        part_index: partIndex,
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        privacy: schedule ? "private" : privacy,  // YouTube forces private when publish_at is set
        publish_at: publishAt,
      });
      setResultUrl(r.url);
      toast({
        title: schedule ? "Scheduled on YouTube" : "Uploaded to YouTube",
        description: schedule
          ? `Will go live at ${new Date(publishAt!).toLocaleString()}. Your server can be offline at release.`
          : `Live: ${r.url}`,
      });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Youtube className="h-4 w-4 text-[#ff0000]" /> Post to YouTube Shorts
          </DialogTitle>
          <DialogDescription className="text-xs">
            {connected === null ? "Checking connection…"
              : connected ? <>Uploading to <strong>{channelTitle || "your channel"}</strong>.</>
              : <>Not connected yet — <a href="#" className="text-primary underline" onClick={(e) => { e.preventDefault(); onOpenChange(false); window.location.href = "/config?tab=publishing"; }}>open Publishing settings</a>.</>}
          </DialogDescription>
        </DialogHeader>

        {resultUrl ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-success/40 bg-success/10 p-3 text-xs text-success leading-relaxed">
              {schedule ? "Scheduled — YouTube will publish this privately until release time." : "Upload complete."}
            </div>
            <Button variant="outline" className="w-full gap-1" onClick={() => window.open(resultUrl, "_blank")}>
              <ExternalLink className="h-3 w-3" /> View on YouTube
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Title <span className="text-muted-foreground">({title.length}/100)</span></Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                className="h-8 text-xs bg-secondary border-border"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="text-xs bg-secondary border-border font-mono"
                placeholder="Hook line then hashtags on a new line…"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tags (comma-separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="reddit, redditstories, shorts"
                className="h-8 text-xs bg-secondary border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Privacy</Label>
                <Select value={privacy} onValueChange={(v) => setPrivacy(v as Privacy)} disabled={schedule}>
                  <SelectTrigger className="h-8 text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="unlisted">Unlisted</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Schedule</Label>
                <div className="flex items-center h-8 gap-2 px-2 rounded-md border border-border bg-secondary">
                  <input
                    type="checkbox"
                    checked={schedule}
                    onChange={(e) => setSchedule(e.target.checked)}
                    id="schedule-chk"
                    className="h-3 w-3"
                  />
                  <label htmlFor="schedule-chk" className="text-xs cursor-pointer">Release later</label>
                </div>
              </div>
            </div>

            {schedule && (
              <div className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Label className="text-xs flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Release time (your local time)
                </Label>
                <Input
                  type="datetime-local"
                  value={publishLocal}
                  onChange={(e) => setPublishLocal(e.target.value)}
                  className="h-8 text-xs bg-secondary border-border"
                  min={defaultFutureLocal().slice(0, 16)}
                />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  YouTube stores this and auto-publishes. Your server can be <strong>offline</strong> at release time.
                  The video is uploaded as Private until then.
                </p>
              </div>
            )}

            {!schedule && privacy === "public" && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2">
                <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                <p className="text-[10px] text-warning leading-snug">
                  Uploads as <strong>Public immediately</strong>. New YouTube accounts are capped at 6 uploads/day via the API.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!resultUrl && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Cancel</Button>
              <Button onClick={handleUpload} disabled={uploading || !connected} className="gap-1">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Youtube className="h-3.5 w-3.5" />}
                {schedule ? "Schedule upload" : "Upload now"}
              </Button>
            </>
          )}
          {resultUrl && (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
