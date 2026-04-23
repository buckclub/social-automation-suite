import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive red button vs neutral default. */
  variant?: "default" | "destructive" | "warning";
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  icon?: ReactNode;
}

export function ConfirmDialog({
  open, onOpenChange,
  title, description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  isLoading = false,
  icon,
}: Props) {
  const btnClass =
    variant === "destructive" ? "" :
    variant === "warning" ? "bg-warning text-warning-foreground hover:bg-warning/90" :
    "";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {icon}
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-xs leading-relaxed">{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            className={btnClass}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
