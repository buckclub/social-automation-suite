import { NavLink, useLocation } from "react-router-dom";
import {
  Video, LayoutDashboard, Newspaper, Settings2, Film, Command,
  Images, Scissors, PenLine, Plus, ChevronDown,
  FileText, Layers, Hash, Globe, Quote, Music, TrendingUp, Compass, User as UserIcon,
  Calendar as CalendarIcon, MessageCircle, Users as UsersIcon, FolderOpen,
  Sparkles as SparklesIcon, ListChecks, ImageIcon, Wrench, Tag,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { useHealth } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { CommandPaletteProvider, useCommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { StatusBar } from "@/components/StatusBar";
import { SocialCopyQueueChip } from "@/components/SocialCopyQueueChip";
import { GenerateWithAIDialog } from "@/components/GenerateWithAIDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandProvider } from "@/contexts/BrandContext";
import { BrandSwitcher } from "@/components/BrandSwitcher";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Top-level single-page items.
const topLevelItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/",         label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar",  icon: CalendarIcon },
];

// Library group — places where saved assets live.
const libraryGroupItems: { to: string; label: string; icon: LucideIcon; desc: string }[] = [
  { to: "/videos",      label: "Videos",      icon: Film,    desc: "Every rendered video, filterable by brand" },
  { to: "/brands",      label: "Brands",      icon: Tag,     desc: "Saved channel-look snapshots" },
  { to: "/backgrounds", label: "Backgrounds", icon: Images,  desc: "Stock footage organised by folder" },
  { to: "/music",       label: "Music",       icon: Music,   desc: "Royalty-free tracks tagged by mood" },
];

// Engage group — analytics + outbound engagement.
const engageGroupItems: { to: string; label: string; icon: LucideIcon; desc: string }[] = [
  { to: "/performance", label: "Performance", icon: TrendingUp,    desc: "Live YT stats + AI-driven diagnoses" },
  { to: "/comments",    label: "Replies",     icon: MessageCircle, desc: "AI-drafted comment replies" },
];

// Create dropdown — grouped by output type so 10+ items stay scannable.
const createGroups: {
  label: string;
  icon: LucideIcon;
  items: { to: string; label: string; icon: LucideIcon; desc: string }[];
}[] = [
  {
    label: "Plan",
    icon: Compass,
    items: [
      { to: "/niche-finder", label: "Niche Finder", icon: Compass, desc: "Trend-driven channel-niche ideas" },
    ],
  },
  {
    label: "Video",
    icon: Film,
    items: [
      { to: "/posts",         label: "Reddit Stories", icon: Newspaper, desc: "Browse + queue Reddit threads" },
      { to: "/clips",         label: "Clip Maker",     icon: Scissors,  desc: "Long-form → Shorts" },
      { to: "/custom-script", label: "Custom Script",  icon: FileText,  desc: "Paste your own narration" },
      { to: "/avatar-reels",  label: "PNG-tuber",      icon: UserIcon,  desc: "Animated character overlay" },
      { to: "/dialogue",      label: "Dialogue Mode",  icon: UsersIcon, desc: "Two-character back-and-forth" },
    ],
  },
  {
    label: "Image",
    icon: ImageIcon,
    items: [
      { to: "/carousels",   label: "Carousel Posts", icon: Layers, desc: "Multi-slide IG / TikTok carousels" },
      { to: "/quote-cards", label: "Quote Cards",    icon: Quote,  desc: "Single-image quote post" },
    ],
  },
  {
    label: "Text",
    icon: PenLine,
    items: [
      { to: "/text-posts", label: "Text Posts", icon: PenLine, desc: "Tweets / comments / community posts" },
    ],
  },
  {
    label: "Utilities",
    icon: Wrench,
    items: [
      { to: "/news",        label: "News Roundup", icon: Globe, desc: "RSS feeds → AI riff prompts" },
      { to: "/hashtag-lab", label: "Hashtag Lab",  icon: Hash,  desc: "Rank tags for a caption" },
    ],
  },
];

// Flat list for the mobile nav and active-state checks.
const allCreateItems = createGroups.flatMap((g) => g.items);
const allNavItems = [
  ...topLevelItems,
  ...allCreateItems,
  ...libraryGroupItems,
  ...engageGroupItems,
  { to: "/config", label: "Configuration", icon: Settings2 },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BrandProvider>
      <CommandPaletteProvider>
        <KeyboardShortcuts />
        <AppLayoutInner>{children}</AppLayoutInner>
        <SocialCopyQueueChip />
        <StatusBar />
      </CommandPaletteProvider>
    </BrandProvider>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { data: health } = useHealth();
  const isOnline = health?.status === "online";
  const { toggle: toggleCommand } = useCommandPalette();
  const { pathname } = useLocation();

  const isInGroup = (group: { items: { to: string }[] }) =>
    group.items.some((i) => pathname.startsWith(i.to));
  const isInCreate = createGroups.some((g) => isInGroup(g));
  const isInLibrary = libraryGroupItems.some((i) => pathname.startsWith(i.to));
  const isInEngage = engageGroupItems.some((i) => pathname.startsWith(i.to));

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 glow-primary">
                <Video className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-lg font-bold tracking-tight text-gradient whitespace-nowrap">
                Social Automation Suite
              </h1>
            </NavLink>

            <nav className="hidden md:flex items-center gap-1">
              {/* Dashboard */}
              <NavItem item={topLevelItems[0]} />

              {/* Create dropdown — sectioned by output type */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none",
                      isInCreate
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {createGroups.map((group, gi) => (
                    <div key={group.label}>
                      {gi > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <group.icon className="h-3 w-3" /> {group.label}
                      </DropdownMenuLabel>
                      {group.items.map((item) => (
                        <DropdownMenuItem key={item.to} asChild>
                          <NavLink
                            to={item.to}
                            className={({ isActive }) =>
                              cn(
                                "flex items-start gap-2.5 cursor-pointer",
                                isActive && "bg-primary/10 text-primary",
                              )
                            }
                          >
                            <item.icon className="h-4 w-4 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-medium leading-tight">{item.label}</div>
                              <div className="text-[10px] text-muted-foreground leading-tight">
                                {item.desc}
                              </div>
                            </div>
                          </NavLink>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Calendar — single top-level item */}
              <NavItem item={topLevelItems[1]} />

              {/* Library dropdown — saved assets */}
              <NavGroupDropdown
                label="Library"
                icon={FolderOpen}
                items={libraryGroupItems}
                isActive={isInLibrary}
              />

              {/* Engage dropdown — analytics + outreach */}
              <NavGroupDropdown
                label="Engage"
                icon={SparklesIcon}
                items={engageGroupItems}
                isActive={isInEngage}
              />

              {/* Configuration — single top-level item, last */}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )
                }
              >
                <Settings2 className="h-3.5 w-3.5" />
                Configuration
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <BrandSwitcher />
            <GenerateWithAIDialog />
            <ThemeToggle />
            <button
              onClick={toggleCommand}
              title="Command palette (⌘K / Ctrl+K)"
              className="hidden lg:flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 hover:bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Command className="h-3 w-3" />
              <span>Jump to…</span>
              <kbd className="ml-1 rounded bg-background/60 border border-border px-1 font-mono text-[9px]">⌘K</kbd>
            </button>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1",
                isOnline
                  ? "border-success/30 bg-success/10"
                  : "border-destructive/30 bg-destructive/10"
              )}
            >
              <div
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isOnline ? "bg-success animate-pulse" : "bg-destructive"
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium hidden sm:inline",
                  isOnline ? "text-success" : "text-destructive"
                )}
              >
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>

        {/* Mobile nav — flat list, every page reachable directly. */}
        <div className="md:hidden border-t border-border flex overflow-x-auto">
          {allNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground"
                )
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 lg:px-8 py-6">
        {/* Route-level boundary — keyed by pathname so navigation
            resets it. Without this, a runtime crash on any page
            blanks the whole app instead of showing the error inline. */}
        <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>
      </main>
      <div className="fixed bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
    </div>
  );
}

function NavItem({ item }: { item: { to: string; label: string; icon: LucideIcon } }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        )
      }
    >
      <item.icon className="h-3.5 w-3.5" />
      {item.label}
    </NavLink>
  );
}

function NavGroupDropdown({
  label, icon: GroupIcon, items, isActive,
}: {
  label: string; icon: LucideIcon;
  items: { to: string; label: string; icon: LucideIcon; desc: string }[];
  isActive: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none",
            isActive
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary",
          )}
        >
          <GroupIcon className="h-3.5 w-3.5" />
          {label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {items.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-start gap-2.5 cursor-pointer",
                  isActive && "bg-primary/10 text-primary",
                )
              }
            >
              <item.icon className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium leading-tight">{item.label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">{item.desc}</div>
              </div>
            </NavLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
