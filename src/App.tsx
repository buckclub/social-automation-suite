/**
 * Social Automation Suite (fork of reels-automation)
 * Upstream Author: Faheem Alvi <faheemalvi2000@gmail.com>
 * GitHub: https://github.com/FaheemAlvii
 * LinkedIn: https://www.linkedin.com/in/faheem-alvi
 * License: CC BY-NC 4.0
 */
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { FirstRunGate } from "@/components/FirstRunGate";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";


/**
 * Vite emits a `vite:preloadError` event on `window` when a lazy
 * chunk's `<link rel="modulepreload">` 404s — typically because a
 * deploy invalidated the chunk filenames the current tab knows
 * about. We listen at the app root so a stale tab triggers a
 * one-time auto-reload before the user even tries to navigate.
 *
 * This catches the proactive case (chunk failed to PRELOAD).
 * RouteErrorBoundary still handles the reactive case (user
 * navigated, chunk fetch failed at import time) so both paths
 * get a friendly recovery instead of a silent blank page.
 *
 * The reload is one-shot per session via sessionStorage so an
 * actual broken deploy doesn't put the user in a refresh loop.
 */
function ChunkRecoverEffect() {
  useEffect(() => {
    const handler = (e: Event) => {
      // Avoid loops: only reload once per session.
      if (sessionStorage.getItem("__chunk_reload__")) return;
      sessionStorage.setItem("__chunk_reload__", "1");
      console.warn(
        "[ChunkRecover] vite:preloadError — reloading once to pick up new chunk hashes",
        e,
      );
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", handler);
    return () => window.removeEventListener("vite:preloadError", handler);
  }, []);
  return null;
}

// ── Eagerly loaded ────────────────────────────────────────────────
// The Dashboard is the first paint for everyone — keep it in the
// initial chunk so users don't see a spinner before TTI. Everything
// else lazy-splits per-route, so the home payload drops from ~900 KB
// to ~350 KB and each tool's chunk loads only when its page opens.
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// ── Code-split per route ──────────────────────────────────────────
const PostsPage          = lazy(() => import("./pages/PostsPage"));
const VideosPage         = lazy(() => import("./pages/VideosPage"));
const BackgroundsPage    = lazy(() => import("./pages/BackgroundsPage"));
const ClipsPage          = lazy(() => import("./pages/ClipsPage"));
const ClipProjectPage    = lazy(() => import("./pages/ClipProjectPage"));
const ConfigPage         = lazy(() => import("./pages/ConfigPage"));
const TextPostsPage      = lazy(() => import("./pages/TextPostsPage"));
const CustomScriptPage   = lazy(() => import("./pages/CustomScriptPage"));
const NewsRoundupPage    = lazy(() => import("./pages/NewsRoundupPage"));
const HashtagLabPage     = lazy(() => import("./pages/HashtagLabPage"));
const CarouselPage       = lazy(() => import("./pages/CarouselPage"));
const QuoteCardPage      = lazy(() => import("./pages/QuoteCardPage"));
const MusicLibraryPage   = lazy(() => import("./pages/MusicLibraryPage"));
const SFXLibraryPage     = lazy(() => import("./pages/SFXLibraryPage"));
const PerformancePage    = lazy(() => import("./pages/PerformancePage"));
const BrandsPage         = lazy(() => import("./pages/BrandsPage"));
const NicheFinderPage    = lazy(() => import("./pages/NicheFinderPage"));
const AvatarReelsPage    = lazy(() => import("./pages/AvatarReelsPage"));
const CalendarPage       = lazy(() => import("./pages/CalendarPage"));
const CommentReplierPage = lazy(() => import("./pages/CommentReplierPage"));
const DialoguePage       = lazy(() => import("./pages/DialoguePage"));
const FirstRunPage       = lazy(() => import("./pages/FirstRunPage"));
const GuidePage          = lazy(() => import("./pages/GuidePage"));

const queryClient = new QueryClient();

// Tiny inline fallback while a chunk fetches — kept to a sub-second
// flash for typical chunk sizes (<100 KB each post-split).
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-20 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

// Inner shell — sits inside HashRouter so it can read useLocation, and
// inside FirstRunGate so the gate's redirect runs before any chunk
// loads. The /setup route renders fullscreen (no sidebar) — every
// other route is wrapped in AppLayout.
function AppRoutes() {
  const loc = useLocation();
  const isSetup = loc.pathname === "/setup";

  const routes = (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/setup" element={<FirstRunPage />} />
        <Route path="/" element={<Index />} />
        <Route path="/posts" element={<PostsPage />} />
        <Route path="/videos" element={<VideosPage />} />
        <Route path="/backgrounds" element={<BackgroundsPage />} />
        <Route path="/clips" element={<ClipsPage />} />
        <Route path="/clips/:id" element={<ClipProjectPage />} />
        <Route path="/text-posts" element={<TextPostsPage />} />
        <Route path="/custom-script" element={<CustomScriptPage />} />
        <Route path="/news" element={<NewsRoundupPage />} />
        <Route path="/hashtag-lab" element={<HashtagLabPage />} />
        <Route path="/carousels" element={<CarouselPage />} />
        <Route path="/quote-cards" element={<QuoteCardPage />} />
        <Route path="/music" element={<MusicLibraryPage />} />
        <Route path="/sfx" element={<SFXLibraryPage />} />
        <Route path="/performance" element={<PerformancePage />} />
        <Route path="/brands" element={<BrandsPage />} />
        <Route path="/niche-finder" element={<NicheFinderPage />} />
        <Route path="/avatar-reels" element={<AvatarReelsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/comments" element={<CommentReplierPage />} />
        <Route path="/dialogue" element={<DialoguePage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );

  // /setup renders fullscreen (no AppLayout, no sidebar) but still
  // needs an error boundary — otherwise a crash in the wizard or a
  // failed lazy-chunk load blanks the entire app with no recovery.
  // AppLayout supplies its own RouteErrorBoundary for the main shell;
  // we only need to add one here for the bare /setup route.
  return isSetup
    ? <RouteErrorBoundary>{routes}</RouteErrorBoundary>
    : <AppLayout>{routes}</AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ChunkRecoverEffect />
      <HashRouter>
        <FirstRunGate>
          <AppRoutes />
        </FirstRunGate>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
