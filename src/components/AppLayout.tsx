import { NavLink, useLocation } from "react-router-dom";
import {
  Video, LayoutDashboard, Newspaper, Settings2, Film, Command,
  Images, Scissors, PenLine, Plus, ChevronDown,
  FileText, Layers, Hash, Globe, Quote, Music,
} from "lucide-react";
import { useHealth } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { CommandPaletteProvider, useCommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { StatusBar } from "@/components/StatusBar";
import { SocialCopyQueueChip } from "@/components/SocialCopyQueueChip";
import { GenerateWithAIDialog } from "@/components/GenerateWithAIDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// Single-link nav items — render as standalone <NavLink>s.
// "Posts", "Text Posts", and "Clip Maker" are sources of new content;
// they're grouped under a "Create" dropdown defined separately so the
// header stays compact on narrower laptop widths.
const topLevelItems = [
  { to: "/",            label: "Dashboard",     icon: LayoutDashboard },
  { to: "/videos",      label: "Videos",        icon: Film },
  { to: "/backgrounds", label: "Backgrounds",   icon: Images },
  { to: "/music",       label: "Music",         icon: Music },
  { to: "/config",      label: "Configuration", icon: Settings2 },
];
const createGroupItems = [
  { to: "/posts",         label: "Reddit Posts",   icon: Newspaper, desc: "Browse + queue Reddit content" },
  { to: "/clips",         label: "Clip Maker",     icon: Scissors,  desc: "Long-form → Shorts" },
  { to: "/text-posts",    label: "Text Posts",     icon: PenLine,   desc: "Tweets / comments / community posts" },
  { to: "/custom-script", label: "Custom Script",  icon: FileText,  desc: "Paste your own narration → render" },
  { to: "/carousels",     label: "Carousel Posts", icon: Layers,    desc: "Multi-slide IG / TikTok carousels" },
  { to: "/quote-cards",   label: "Quote Cards",    icon: Quote,     desc: "Single-image quote post (extract from video)" },
  { to: "/news",          label: "News Roundup",   icon: Globe,     desc: "RSS feeds → AI riff prompts" },
  { to: "/hashtag-lab",   label: "Hashtag Lab",    icon: Hash,      desc: "Rank tags for a caption" },
];
// Combined list — used by the mobile nav so every page is reachable.
const allNavItems = [...topLevelItems, ...createGroupItems];

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <KeyboardShortcuts />
      <AppLayoutInner>{children}</AppLayoutInner>
      <SocialCopyQueueChip />
      <StatusBar />
    </CommandPaletteProvider>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { data: health } = useHealth();
  const isOnline = health?.status === "online";
  const { toggle: toggleCommand } = useCommandPalette();
  const { pathname } = useLocation();
  // Highlight the "Create" trigger when we're on any of its destinations.
  const isInCreate = createGroupItems.some((i) => pathname.startsWith(i.to));

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        {/* Bumped from max-w-7xl (1280) to max-w-screen-2xl (1536) so the
            wordmark, nav, and right-side actions all fit comfortably on
            the same row at typical laptop widths. Main also widens below
            so the content area lines up with the header. */}
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
              {/* Dashboard first */}
              <NavItem item={topLevelItems[0]} />

              {/* Create dropdown — Reddit Posts / Clip Maker / Text Posts */}
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
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Sources of new content
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {createGroupItems.map((item) => (
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
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Remaining top-level items */}
              {topLevelItems.slice(1).map((item) => (
                <NavItem key={item.to} item={item} />
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {/* Primary "create" CTA — accessible from every page so the
                user never has to navigate to the dashboard just to kick
                off a generation run. */}
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

      <main className="mx-auto max-w-screen-2xl px-4 lg:px-8 py-6">{children}</main>
      <div className="fixed bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
    </div>
  );
}

function NavItem({ item }: { item: { to: string; label: string; icon: typeof Film } }) {
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
