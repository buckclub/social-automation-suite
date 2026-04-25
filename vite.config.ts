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
    // Split SAFE heavy third-party deps into their own chunks for
    // caching benefit. The previous config tried to split React off
    // from Radix and produced a runtime crash:
    //
    //   TypeError: can't access property "forwardRef" of undefined
    //   (vendor-radix evaluating before vendor-react had finished
    //   initializing)
    //
    // Lesson: don't split tightly-coupled libraries that touch React
    // at module-eval time. Radix calls React.forwardRef at the top
    // level of every primitive, so it must live in the same chunk
    // as React (or a chunk that's guaranteed to evaluate after).
    // Rather than fight Rollup's chunk-graph ordering, we keep the
    // React + Radix + react-* world in one big "vendor-ui" chunk and
    // only split off libs that have no React module-eval dependency.
    //
    // Post-split chunks:
    //   - vendor-ui    : react/dom/router + @radix-ui + everything
    //                    that uses React.forwardRef at top-level.
    //                    Also catches use-sync-external-store, jsx-
    //                    runtime, etc.
    //   - vendor-motion: framer-motion (lazy uses of React, no eval-
    //                    time forwardRef calls).
    //   - vendor-icons : lucide-react (functional components, no
    //                    eval-time React access).
    //   - vendor-charts: recharts + d3-* (only used if a route
    //                    actually imports a chart).
    //   - vendor       : everything else under node_modules.
    //   - index        : our app code.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;

          // Lucide icons — pure-function components, safe to split.
          if (id.includes("lucide-react")) return "vendor-icons";

          // Recharts only loads when a page that uses charts mounts.
          // Splitting keeps it out of every other initial paint.
          if (id.includes("recharts") || id.includes("/d3-")) {
            return "vendor-charts";
          }

          // Framer-motion uses React but only inside its component
          // bodies (no top-level forwardRef calls), so a later-than-
          // React chunk is fine. Heavy enough to be worth its own
          // chunk for caching.
          if (id.includes("framer-motion")) return "vendor-motion";

          // The React + Radix + react-router world. Anything that
          // calls React.forwardRef at top-level — including Radix
          // primitives, react-router, react-hook-form, react-query,
          // etc — has to share a chunk with React itself. Bundling
          // all of them into one cacheable blob is the safest play.
          if (
            id.includes("react") ||           // covers react, react-dom, react-router*, react-*
            id.includes("/scheduler/") ||
            id.includes("/use-sync-external-store/") ||
            id.includes("@radix-ui/") ||
            id.includes("@tanstack/")
          ) {
            return "vendor-ui";
          }

          // Everything else under node_modules → generic vendor bucket.
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));
