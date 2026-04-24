import { useEffect, useState, useRef } from "react";
import { Upload, Trash2, User, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface Props {
  username: string;
  onUsernameChange: (v: string) => void;
  hideStats: boolean;
  onHideStatsChange: (v: boolean) => void;
  profilePicPath: string;
  onProfilePicChange: (v: string) => void;
}

/**
 * Title-card branding controls:
 *   - Upload a circular profile pic (stored on server at branding/avatar.*)
 *   - Username handle (shown next to the avatar)
 *   - Toggle the fake hearts/share stats bar (off by default — fewer glyph
 *     rendering issues, looks more like a real Reddit card grab)
 *
 * Uploading the pic saves it server-side AND patches config.json directly.
 * The user doesn't need to click Save All for the upload to persist, but
 * changes to the username/toggle still do.
 */
export function TitleCardSettings({
  username, onUsernameChange,
  hideStats, onHideStatsChange,
  profilePicPath, onProfilePicChange,
}: Props) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewKey, setPreviewKey] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  // Bump the preview query param whenever the underlying path changes so the
  // <img> actually refreshes instead of serving a cached pixel.
  useEffect(() => {
    setPreviewKey(Date.now());
  }, [profilePicPath]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Too big", description: "Keep it under 5 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const r = await api.uploadProfilePic(file);
      onProfilePicChange(r.path);
      toast({ title: "Profile picture saved" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleClear = async () => {
    try {
      await api.clearProfilePic();
      onProfilePicChange("");
      toast({ title: "Profile picture removed" });
    } catch (e: any) {
      toast({ title: "Remove failed", description: e.message, variant: "destructive" });
    }
  };

  const hasPic = Boolean(profilePicPath);
  const previewUrl = hasPic ? `${api.profilePicUrl()}&k=${previewKey}` : "";

  return (
    <div className="space-y-3">
      {/* Preview row: avatar + username */}
      <div className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-3">
        <div className="relative h-14 w-14 rounded-full bg-secondary border border-border overflow-hidden flex items-center justify-center">
          {hasPic ? (
            <img
              src={previewUrl}
              alt="Profile"
              className="w-full h-full object-cover"
              onError={() => {
                // The file was deleted outside the app or the path is stale.
                toast({ title: "Preview failed", description: "Re-upload the image.", variant: "destructive" });
                onProfilePicChange("");
              }}
            />
          ) : (
            <User className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">
            {username
              ? (username.startsWith("@") || username.startsWith("u/") ? username : "@" + username)
              : <span className="text-muted-foreground italic">(no handle set)</span>
            }
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            Preview of how the title card header will render.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
        {/* Upload controls */}
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png, image/jpeg, image/webp"
            className="hidden"
            onChange={handleFile}
          />
          <Button
            size="sm" variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="gap-1"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {hasPic ? "Replace" : "Upload"} image
          </Button>
          {hasPic && (
            <Button
              size="sm" variant="outline"
              onClick={handleClear}
              className="gap-1 text-destructive hover:text-destructive"
              disabled={uploading}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Display username</Label>
          <Input
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="@relationshipstories"
            className="h-8 text-xs bg-secondary border-border font-mono"
          />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/20 p-2.5">
        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground leading-snug">
          PNGs with transparency work best — the image is masked into a circle.
          Square aspect ratio recommended (e.g. 512×512). Saved to
          {" "}<code>branding/avatar.*</code> in the project root.
        </p>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div>
          <Label className="text-xs">Hide fake stats bar</Label>
          <p className="text-[10px] text-muted-foreground">
            Hides the ♡ upvotes / ⤴ share numbers at the bottom of the card.
            Often a good idea — the glyphs don't always render cleanly.
          </p>
        </div>
        <Switch checked={hideStats} onCheckedChange={onHideStatsChange} />
      </div>
    </div>
  );
}
