/**
 * Social Automation Suite (fork of reels-automation)
 * Upstream Author: Faheem Alvi <faheemalvi2000@gmail.com>
 * GitHub: https://github.com/FaheemAlvii
 * LinkedIn: https://www.linkedin.com/in/faheem-alvi
 * License: CC BY-NC 4.0
 */
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index";
import PostsPage from "./pages/PostsPage";
import VideosPage from "./pages/VideosPage";
import BackgroundsPage from "./pages/BackgroundsPage";
import ClipsPage from "./pages/ClipsPage";
import ClipProjectPage from "./pages/ClipProjectPage";
import ConfigPage from "./pages/ConfigPage";
import TextPostsPage from "./pages/TextPostsPage";
import CustomScriptPage from "./pages/CustomScriptPage";
import NewsRoundupPage from "./pages/NewsRoundupPage";
import HashtagLabPage from "./pages/HashtagLabPage";
import CarouselPage from "./pages/CarouselPage";
import QuoteCardPage from "./pages/QuoteCardPage";
import MusicLibraryPage from "./pages/MusicLibraryPage";
import PerformancePage from "./pages/PerformancePage";
import BrandsPage from "./pages/BrandsPage";
import NicheFinderPage from "./pages/NicheFinderPage";
import AvatarReelsPage from "./pages/AvatarReelsPage";
import CalendarPage from "./pages/CalendarPage";
import CommentReplierPage from "./pages/CommentReplierPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <AppLayout>
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
            <Route path="/config" element={<ConfigPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
