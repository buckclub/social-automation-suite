import { PipelinePanel } from "@/components/PipelinePanel";
import { PostFeed } from "@/components/PostFeed";
import { RecentVideos } from "@/components/RecentVideos";
import { ResumePanel } from "@/components/ResumePanel";
import { RenderHistoryChart } from "@/components/RenderHistoryChart";
import { CostTrackerPanel } from "@/components/CostTrackerPanel";
import { QueuePanel } from "@/components/QueuePanel";

export default function Index() {
  return (
    <div className="space-y-6">
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
          <CostTrackerPanel />
        </div>
      </div>
    </div>
  );
}
