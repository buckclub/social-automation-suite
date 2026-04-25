import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Split heavy third-party deps into their own chunks. Three reasons:
    //
    // 1. **Caching:** these libraries change rarely. A typo in our app
    //    code shouldn't bust the framer-motion / radix / react chunks.
    //    Returning visitors get the cached vendor blobs and only
    //    re-download our small app code.
    // 2. **Parallel download:** browsers fetch chunks in parallel, so
    //    splitting reduces blocking time even if total bytes are the
    //    same.
    // 3. **Easier perf debugging:** chunk-size warnings now point at
    //    a specific dep instead of one giant 740KB blob.
    //
    // Per-chunk targets (post-split):
    //   - vendor-react       : react + react-dom + react-router-dom (~150 KB)
    //   - vendor-radix       : @radix-ui/* primitives (~120 KB)
    //   - vendor-motion      : framer-motion (~60 KB)
    //   - vendor-icons       : lucide-react (tree-shakes by-name imports)
    //   - main app chunk     : everything else (~300-400 KB)
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;

          // Core React / router — always on the critical path; one
          // chunk so it caches as a unit.
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }

          // All Radix primitives — many separate packages, but they
          // ship together as the dialog/select/etc UI layer.
          if (id.includes("@radix-ui/")) {
            return "vendor-radix";
          }

          // Framer-motion is heavy and used widely across pages —
          // its own chunk so it caches separately. (Eventually
          // worth replacing with smaller animation primitives.)
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }

          // Lucide icons — name-imports tree-shake well, but
          // putting it in a vendor chunk avoids re-emitting whatever
          // icons each lazy route happens to use.
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }

          // Recharts — heavy but only used in chart components. If a
          // page lazy-imports a chart, the chart chunk pulls recharts
          // with it. Without this rule, recharts could leak into the
          // main bundle if any reachable file touches it transitively.
          if (id.includes("recharts") || id.includes("d3-")) {
            return "vendor-charts";
          }

          // Everything else under node_modules → a generic vendor
          // bucket so the main app chunk stays just our code.
          return "vendor";
        },
      },
    },
    // Bump the chunk-size warning slightly — the vendor split below
    // produces a few legitimately-large chunks (radix is ~120 KB)
    // that aren't worth more aggressive splitting.
    chunkSizeWarningLimit: 600,
  },
}));
