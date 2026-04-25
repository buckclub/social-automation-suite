import { createElement, isValidElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Lucide icon component (or any React node) shown in the rounded badge. */
  icon: LucideIcon | ReactNode;
  /** Page title — bold, large. */
  title: string;
  /** One-line description shown below the title. */
  subtitle?: string | ReactNode;
  /** Right-side cluster — page-specific buttons (Sync / Refresh / etc). */
  actions?: ReactNode;
  /** When false, the Back button is hidden. Default: true. */
  showBack?: boolean;
  /** Override the back-button target. Default: history.back(). */
  backTo?: string;
  /** Tone for the badge background. */
  tone?: "primary" | "muted";
  /** Extra className for the wrapper. */
  className?: string;
}

/**
 * Shared page header — used at the top of every Create / Library /
 * Engage / utility page so they all share visual rhythm. Pattern:
 *
 *     [icon]  Page Title                    [actions...] [Back]
 *             Subtitle line
 *
 * Pages that need bespoke layouts can still skip this and roll their
 * own — the goal is consistency for the 90% case, not lock-in.
 */
export function PageHeader({
  icon, title, subtitle, actions,
  showBack = true, backTo, tone = "primary",
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const goBack = () => {
    if (backTo) navigate(backTo);
    else navigate(-1);
  };

  // Lucide icons in current versions are `forwardRef(...)` OBJECTS, not
  // plain function components — so `typeof icon === "function"` fell
  // through and tried to render the component value as a React child,
  // triggering React error #31 ("Objects are not valid as a React
  // child, found object with keys {$$typeof, render, displayName}").
  // createElement handles both function-components AND forwardRef
  // objects uniformly. Pre-rendered elements (e.g. <SomeIcon />) pass
  // through unchanged.
  const renderIcon = () => {
    if (icon == null) return null;
    if (isValidElement(icon)) return icon;
    return createElement(icon as any, { className: "h-5 w-5 text-primary" });
  };

  return (
    <div className={cn("flex items-center justify-between gap-3 flex-wrap", className)}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
          tone === "primary" ? "bg-primary/10" : "bg-muted",
        )}>
          {renderIcon()}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {showBack && (
          <Button variant="ghost" size="sm" onClick={goBack} className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        )}
      </div>
    </div>
  );
}
