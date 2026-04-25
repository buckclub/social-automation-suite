import { useRef, useState } from "react";
import { Download, Upload, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

/**
 * Workspace backup panel — Export downloads a zip of every config /
 * brand / queue / music-metadata / per-post sidecar. Import takes a
 * zip back and atomically restores it (with backup of overwritten
 * files in .cache/imports/<timestamp>/).
 *
 * Designed to live inside Config → Output & Discord → Workspace
 * backup section.
 */
export function WorkspaceBackupPanel() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<{ restored: number; backup_dir: string } | null>(null);

  const exportNow = () => {
    // Native download via anchor — no spinner needed; the browser
    // handles streaming + Save-As prompt.
    const a = document.createElement("a");
    a.href = api.workspaceExportUrl();
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!confirm(
      "Importing a workspace will overwrite your current config, brand profiles, " +
      "queue state, and per-post social copy.\n\n" +
      "Existing files are backed up to .cache/imports/<timestamp>/ so you can roll " +
      "back manually.\n\n" +
      "Recommended: pause active renders before continuing.\n\n" +
      "Proceed?"
    )) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImporting(true);
    try {
      const r = await api.workspaceImport(f, true);
      setLastImport({ restored: r.restored.length, backup_dir: r.backup_dir });
      toast({
        title: `Restored ${r.restored.length} file${r.restored.length === 1 ? "" : "s"}`,
        description: `Old files backed up to ${r.backup_dir}. Restart the server for queue workers to pick up the new state.`,
      });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={exportNow} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export workspace zip
        </Button>
        <Button
          size="sm" variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="gap-1.5"
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Import workspace zip
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          hidden
          onChange={onPickFile}
        />
      </div>

      {lastImport && (
        <div className="rounded border border-success/30 bg-success/5 p-2 text-[11px] flex items-start gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>
              Imported <b>{lastImport.restored}</b> file{lastImport.restored === 1 ? "" : "s"}.
              Old versions saved to <code>{lastImport.backup_dir}</code>.
            </p>
            <p className="text-muted-foreground mt-0.5">
              Restart the server (Ctrl-C the dev process and re-run, or restart the systemd / Docker
              unit) so the queue workers re-read the imported state.
            </p>
          </div>
        </div>
      )}

      <div className="rounded border border-amber-400/20 bg-amber-400/5 p-2 text-[10px] flex items-start gap-1.5 text-muted-foreground">
        <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p>
            <b className="text-foreground">Excluded from the zip:</b> rendered videos, raw audio,
            stock backgrounds, music audio files, clip-maker projects, and downloaded models —
            they're large and regenerable. Back those directories up separately if needed.
          </p>
        </div>
      </div>
    </div>
  );
}
