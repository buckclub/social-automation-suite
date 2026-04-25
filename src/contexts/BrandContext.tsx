import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type BrandSummary } from "@/lib/api";

/**
 * Global brand-profile context. One source of truth for:
 *   - the list of saved brands
 *   - the active brand id + summary
 *   - the imperative `switchBrand`, `refresh`, etc helpers
 *
 * Header BrandSwitcher, Generate-with-AI banner, Videos filter, and
 * Brands page all read from here so they stay in sync without
 * prop-drilling.
 */
interface BrandContextValue {
  brands: BrandSummary[];
  activeId: string | null;
  active: BrandSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
  switchBrand: (id: string | null) => Promise<void>;
}

const Ctx = createContext<BrandContextValue | null>(null);

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.listBrands();
      setBrands(r.brands || []);
      setActiveId(r.active_id);
    } catch {
      // Silent — server may be down or endpoint missing on a stale build
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const switchBrand = useCallback(async (id: string | null) => {
    await api.setActiveBrand(id);
    await refresh();
    // The active brand applies its config overrides server-side. Existing
    // useConfig consumers don't need to know — they'll fetch the new
    // values on their next refetch (most pages refetch on focus).
  }, [refresh]);

  const active = brands.find((b) => b.id === activeId) || null;

  return (
    <Ctx.Provider value={{ brands, activeId, active, loading, refresh, switchBrand }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBrand() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBrand must be inside BrandProvider");
  return v;
}
