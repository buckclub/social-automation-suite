import { PipelinePanel } from "@/components/PipelinePanel";
import { PostFeed } from "@/components/PostFeed";
import { RecentVideos } from "@/components/RecentVideos";
import { ResumePanel } from "@/components/ResumePanel";
import { RenderHistoryChart } from "@/components/RenderHistoryChart";
import { CostTrackerPanel } from "@/components/CostTrackerPanel";
import { DailyIdeasPanel } from "@/components/DailyIdeasPanel";
import { QueuePanel } from "@/components/QueuePanel";
import { QuickStartChecklist } from "@/components/QuickStartChecklist";
import { useFirstTimeTip } from "@/hooks/use-first-time-tip";

export default function Index() {
  // First-time dashboard tip — only fires once per browser. Points the
  // user at the Guide page in case the QuickStartChecklist isn't enough.
  useFirstTimeTip({
    id: "dashboard-welcome",
    title: "Welcome 👋",
    description:
      "The bell icon top-right shows render results, and there's a guide at /guide if you get stuck.",
    delayMs: 1200,
  });

  return (
    <div className="space-y-6">
      {/* Quick-start onboarding card — auto-hides once everything is
          configured or the user dismisses it. Renders nothing on a
          fresh load until config has hydrated, so no flash. */}
      <QuickStartChecklist />

      {/* Stats + 30-day bar chart in one panel */}
      <RenderHistoryChart />

      {/* Run queue — auto-hides when empty */}
      <QueuePanel />

      {/* Resume panel — auto-hides when there are no audio_only videos */}
      <ResumePanel />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-3">
          <PipelinePanel />
        </div>
        <div className="lg:col-span-5">
          <PostFeed />
        </div>
        <div className="lg:col-span-4 space-y-5">
          <RecentVideos />
          {/* Daily ideas — auto-hides if no AI provider or no niche set,
              so it doesn't show empty on a fresh install. */}
          <DailyIdeasPanel />
          <CostTrackerPanel />
        </div>
      </div>
    </div>
  );
}
