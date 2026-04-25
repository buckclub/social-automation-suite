import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Tag, Plus, Loader2, Trash2, Check, Save, Upload,
  Camera, Pencil, X,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useBrand } from "@/contexts/BrandContext";
import { api, type BrandSummary } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Brands page — manage every saved profile.
 *
 *   - Click a card to set it active (snapshot-and-swap happens server-side).
 *   - Inline rename / recolor / pic-upload via per-card edit toggle.
 *   - "+ New brand" — clones current config so the user can branch from
 *     whatever they're already running.
 *   - "Save current" on the active brand — manually write the live
 *     config.json values back into this profile (useful after editing
 *     something on Config that you want to lock in).
 *   - Delete (with confirm).
 */
export default function BrandsPage() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const { brands, activeId, refresh, switchBrand, loading } = useBrand();
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#FF8855");
  const [creating, setCreating] = useState(false);

  // Auto-open the create dialog when arriving with ?new=1 from the
  // header switcher's "+ New brand" entry.
  useEffect(() => {
    if (params.get("new") === "1") setCreatingOpen(true);
  }, [params]);

  const create = async () => {
    if (!newName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const r = await api.createBrand({
        name: newName.trim(), color: newColor, snapshot_current: true,
      });
      toast({ title: "Brand created", description: `Snapshotted current config to "${r.brand.name}".` });
      setNewName("");
      setNewColor("#FF8855");
      setCreatingOpen(false);
      refresh();
    } catch (e: any) {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <PageHeader
        icon={Tag}
        title="Brands"
        subtitle="Saved snapshots of every 'what this channel looks like' config — title card, captions, watermark, voice, BG selector, music tags. Switch via the header pill before each render."
        actions={
          <Button size="sm" onClick={() => setCreatingOpen((v) => !v)} className="gap-1">
            {creatingOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {creatingOpen ? "Cancel" : "New brand"}
          </Button>
        }
      />

      {creatingOpen && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3 space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Create brand from current config</Label>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Snapshots your current Captions / Title Card / Voice / Watermark / Background settings into a named profile.
              Becomes immediately active when you select it from the header switcher.
            </p>
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Brand name (e.g. Toxic GF Stories)"
                className="bg-secondary border-border h-8 text-xs"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") create(); }}
              />
              <div className="flex gap-1">
                <Input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(newColor) ? newColor : "#FF8855"}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="h-8 w-12 p-0.5 bg-secondary border-border shrink-0"
                />
                <Input
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="bg-secondary border-border h-8 text-[11px] font-mono"
                />
              </div>
            </div>
            <Button size="sm" onClick={create} disabled={creating || !newName.trim()} className="gap-1">
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Create
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card className="border-border bg-card">
          <CardContent className="py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </CardContent>
        </Card>
      ) : brands.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-10 text-center text-xs text-muted-foreground space-y-1.5">
            <Tag className="h-6 w-6 mx-auto mb-1 opacity-40" />
            <p>No brands saved yet.</p>
            <p>Click <b>+ New brand</b> above to snapshot your current config as your first brand.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {brands.map((b) => (
            <BrandCard
              key={b.id}
              brand={b}
              isActive={b.id === activeId}
              onActivate={() => switchBrand(b.id)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardContent className="p-3 text-[10px] text-muted-foreground leading-relaxed space-y-1">
          <p><b>How brands flow:</b></p>
          <p>1. Switch a brand active via the header pill or by clicking a card here.</p>
          <p>2. The previous active brand auto-saves your latest edits before the swap.</p>
          <p>3. The new brand's overrides are written into <code>config.json</code> — every Config tab now edits THAT brand's values.</p>
          <p>4. Each render is tagged with the active brand id; the Videos page surfaces it as a badge and lets you filter.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function BrandCard({
  brand, isActive, onActivate, onChanged,
}: {
  brand: BrandSummary; isActive: boolean;
  onActivate: () => void | Promise<void>;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(brand.name);
  const [color, setColor] = useState(brand.color);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [savingCurrent, setSavingCurrent] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateBrand(brand.id, { name: name.trim(), color });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete brand "${brand.name}"? Videos rendered with it keep their tag, but the profile is gone.`)) return;
    setDeleting(true);
    try {
      await api.deleteBrand(brand.id);
      onChanged();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const activate = async () => {
    setActivating(true);
    try {
      await onActivate();
      toast({ title: `Switched to "${brand.name}"`, description: "Render config updated. Hit Generate to use it." });
    } finally {
      setActivating(false);
    }
  };

  const saveCurrent = async () => {
    setSavingCurrent(true);
    try {
      await api.saveCurrentToBrand(brand.id);
      toast({ title: "Snapshot saved", description: `"${brand.name}" updated with current config.` });
      onChanged();
    } catch (e: any) {
      toast({ title: "Snapshot failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingCurrent(false);
    }
  };

  const onPickPic = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await api.uploadBrandPic(brand.id, f);
      toast({ title: "Profile pic updated" });
      onChanged();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card className={cn(
      "transition-all",
      isActive ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border bg-card",
    )}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2.5">
          <div className="relative shrink-0">
            {brand.has_pic ? (
              <img
                src={api.brandPicUrl(brand.id, brand.updated_at || brand.id)}
                alt={brand.name}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div
                className="h-12 w-12 rounded-full flex items-center justify-center font-bold text-white text-lg"
                style={{ backgroundColor: brand.color }}
              >
                {(brand.name || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:scale-110 transition-transform"
              title="Upload profile pic"
            >
              <Camera className="h-2.5 w-2.5" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPic} />
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-secondary border-border h-7 text-xs"
                  autoFocus
                />
                <div className="flex gap-1">
                  <Input
                    type="color"
                    value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888"}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-7 w-9 p-0.5 bg-secondary border-border shrink-0"
                  />
                  <Input
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="bg-secondary border-border h-7 text-[10px] font-mono"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold truncate">{brand.name}</p>
                  {isActive && <Badge variant="outline" className="text-[9px] border-primary/40 text-primary px-1.5 py-0 shrink-0">Active</Badge>}
                </div>
                <p className="text-[9px] text-muted-foreground font-mono truncate">{brand.id}</p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
          {editing ? (
            <>
              <Button size="sm" onClick={save} disabled={saving} className="h-6 text-[10px] gap-1 flex-1">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(brand.name); setColor(brand.color); }}
                className="h-6 text-[10px]">
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <>
              {isActive ? (
                <Button size="sm" variant="outline" onClick={saveCurrent} disabled={savingCurrent}
                  className="h-6 text-[10px] gap-1 flex-1" title="Snapshot current config.json into this brand">
                  {savingCurrent ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save current
                </Button>
              ) : (
                <Button size="sm" onClick={activate} disabled={activating}
                  className="h-6 text-[10px] gap-1 flex-1">
                  {activating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Activate
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="h-6 text-[10px] gap-1">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} disabled={deleting} className="h-6 text-[10px] gap-1">
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 text-destructive" />}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
