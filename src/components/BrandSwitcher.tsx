import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Plus, Settings2, Check, Loader2, Tag } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useBrand } from "@/contexts/BrandContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Header brand switcher. Avatar + name + chevron. Dropdown lists every
 * saved brand (active marked with a check), plus a "Manage brands" link
 * to /brands and a "+ New brand" inline action.
 *
 * Switching is immediate — the API call snapshots current config into
 * the previously-active brand, then applies the new brand's overrides
 * to config.json. Every component pulling from useBrand() refreshes.
 *
 * When no brand is configured yet (fresh install), shows a muted "No
 * brand" pill that opens the dropdown to either pick or create.
 */
export function BrandSwitcher() {
  const { brands, activeId, active, switchBrand, refresh, loading } = useBrand();
  const [switching, setSwitching] = useState<string | null>(null);

  const onPick = async (id: string | null) => {
    if (id === activeId) return;
    setSwitching(id ?? "__none__");
    try {
      await switchBrand(id);
    } finally {
      setSwitching(null);
    }
  };

  const Avatar = ({ size = 24, brand }: { size?: number; brand: { id: string; name: string; color: string; has_pic?: boolean } | null }) => {
    if (!brand) {
      return (
        <div
          className="rounded-full bg-muted flex items-center justify-center text-muted-foreground"
          style={{ width: size, height: size, fontSize: size * 0.45 }}
          title="No brand selected"
        >
          <Tag className="w-1/2 h-1/2" />
        </div>
      );
    }
    if (brand.has_pic) {
      return (
        <img
          src={api.brandPicUrl(brand.id, brand.id)}
          alt={brand.name}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      );
    }
    const initial = (brand.name || "?").trim().charAt(0).toUpperCase();
    return (
      <div
        className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
        style={{
          width: size, height: size, fontSize: size * 0.45,
          backgroundColor: brand.color || "#888",
        }}
      >
        {initial}
      </div>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 rounded-full border border-border bg-secondary/60 hover:bg-secondary px-2 py-1 transition-colors",
            !active && "opacity-90",
          )}
          title={active ? `Brand: ${active.name}` : "Pick a brand"}
        >
          <Avatar size={20} brand={active} />
          <span className="text-[11px] font-medium max-w-[110px] truncate">
            {loading ? "…" : (active?.name || "No brand")}
          </span>
          <ChevronDown className="h-3 w-3 opacity-70 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Active brand for next render
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {brands.length === 0 ? (
          <div className="px-2 py-3 text-[11px] text-muted-foreground text-center">
            No brands saved yet.<br />
            <Link to="/brands" className="text-primary hover:underline">Create your first brand →</Link>
          </div>
        ) : (
          <>
            {brands.map((b) => (
              <DropdownMenuItem
                key={b.id}
                onSelect={(e) => { e.preventDefault(); onPick(b.id); }}
                className="cursor-pointer flex items-start gap-2.5 py-1.5"
              >
                <Avatar size={28} brand={b} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{b.name}</div>
                  <div className="text-[9px] text-muted-foreground font-mono truncate">{b.id}</div>
                </div>
                <div className="shrink-0 self-center">
                  {switching === b.id
                    ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    : (b.id === activeId ? <Check className="h-3.5 w-3.5 text-primary" /> : null)}
                </div>
              </DropdownMenuItem>
            ))}
            {activeId && (
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); onPick(null); }}
                className="cursor-pointer text-[11px] text-muted-foreground"
              >
                <Tag className="h-3 w-3 mr-2" /> Use no brand
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/brands" className="cursor-pointer flex items-center gap-2 text-[11px]">
            <Settings2 className="h-3 w-3" /> Manage brands
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/brands?new=1" className="cursor-pointer flex items-center gap-2 text-[11px] text-primary">
            <Plus className="h-3 w-3" /> New brand
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
