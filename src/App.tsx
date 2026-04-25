/**
 * Social Automation Suite (fork of reels-automation)
 * Upstream Author: Faheem Alvi <faheemalvi2000@gmail.com>
 * GitHub: https://github.com/FaheemAlvii
 * LinkedIn: https://www.linkedin.com/in/faheem-alvi
 * License: CC BY-NC 4.0
 */
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";

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
const PerformancePage    = lazy(() => import("./pages/PerformancePage"));
const BrandsPage         = lazy(() => import("./pages/BrandsPage"));
const NicheFinderPage    = lazy(() => import("./pages/NicheFinderPage"));
const AvatarReelsPage    = lazy(() => import("./pages/AvatarReelsPage"));
const CalendarPage       = lazy(() => import("./pages/CalendarPage"));
const CommentReplierPage = lazy(() => import("./pages/CommentReplierPage"));
const DialoguePage       = lazy(() => import("./pages/DialoguePage"));

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <AppLayout>
          <Suspense fallback={<PageFallback />}>
            <Routes>
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
              <Route path="/performance" element={<PerformancePage />} />
              <Route path="/brands" element={<BrandsPage />} />
              <Route path="/niche-finder" element={<NicheFinderPage />} />
              <Route path="/avatar-reels" element={<AvatarReelsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/comments" element={<CommentReplierPage />} />
              <Route path="/dialogue" element={<DialoguePage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
