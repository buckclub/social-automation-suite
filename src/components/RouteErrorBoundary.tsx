import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Wraps every page render so a runtime
 * crash inside one page no longer blanks the whole app. Surfaces the
 * actual error name + message + component stack so users can paste
 * a useful report instead of just "the page is blank."
 *
 * Resets when the route changes — uses `key` from the parent to nuke
 * the boundary's internal error state on navigation.
 *
 * Special-case: chunk-load errors after a deploy. When the backend
 * builds + redeploys, the lazy-route chunk filenames change (vite
 * hashes content into the filename). A tab that was loaded BEFORE
 * the deploy holds the old `index-<hash>.js` which references old
 * chunk URLs that 404 after the dist swap. The error surfaces as
 * `TypeError: error loading dynamically imported module …`. Rather
 * than show the user a scary stack trace they can't act on, detect
 * this specific shape and offer a one-click reload.
 */
interface State { err: Error | null; info: string | null; }


/**
 * Heuristic: every framework / browser uses slightly different
 * wording for "couldn't fetch a JS module" but they all contain
 * one of these substrings. Capturing all variants is safer than
 * trying to match an exact `.name`.
 */
function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("failed to fetch dynamically") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("import error") ||
    // Chrome / Firefox emit slightly different wording for the
    // same underlying ERR_ABORTED / 404-on-import case.
    /error loading.*module/.test(msg)
  );
}


export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null, info: null };

  static getDerivedStateFromError(err: Error): State {
    return { err, info: null };
  }

  componentDidCatch(err: Error, info: { componentStack?: string }) {
    console.error("[RouteErrorBoundary] page crashed:", err, info);
    this.setState({ info: info.componentStack ?? null });
  }

  reset = () => this.setState({ err: null, info: null });
  hardReload = () => {
    // Cache-bust the navigation so the browser fetches a fresh
    // index.html (which references the new chunk hashes).
    window.location.reload();
  };

  render() {
    if (!this.state.err) return this.props.children;

    // Stale-chunk path: friendly UI, one-click reload. The user's
    // tab is just out of date — no real crash to debug.
    if (isChunkLoadError(this.state.err)) {
      return (
        <Card className="border-primary/40 bg-primary/5 max-w-2xl mx-auto mt-6">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              <h2 className="text-base font-bold">A new version was deployed</h2>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This tab is running an older build of the app, so it can't load
              the page you just navigated to (the file it expects no longer
              exists on the server). One click to refresh — your work isn't
              lost, the backend keeps state independently of the tab.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={this.hardReload} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh now
              </Button>
              <Button size="sm" variant="outline" asChild className="gap-1">
                <a href="#/"><Home className="h-3.5 w-3.5" /> Dashboard</a>
              </Button>
            </div>
            <details className="text-[10px] text-muted-foreground/70">
              <summary className="cursor-pointer hover:text-foreground">Technical details</summary>
              <pre className="mt-1 bg-background/60 border border-border rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap break-words text-[10px]">
                {this.state.err.message}
              </pre>
            </details>
          </CardContent>
        </Card>
      );
    }

    // Generic crash path — same UI as before.
    return (
      <Card className="border-destructive/40 bg-destructive/5 max-w-3xl mx-auto mt-6">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-bold">This page crashed</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            React threw an unhandled error rendering this page. The error name + message
            below should be enough to reproduce; the component stack helps pinpoint the file.
          </p>
          <pre className="text-[10px] bg-background/60 border border-border rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap break-words">
            <strong className="text-destructive">{this.state.err.name}:</strong> {this.state.err.message}
            {this.state.err.stack ? "\n\n" + this.state.err.stack : ""}
          </pre>
          {this.state.info && (
            <details className="text-[10px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Component stack</summary>
              <pre className="mt-2 bg-background/60 border border-border rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                {this.state.info}
              </pre>
            </details>
          )}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={this.reset} className="gap-1">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </Button>
            <Button size="sm" variant="outline" asChild className="gap-1">
              <a href="#/"><Home className="h-3.5 w-3.5" /> Dashboard</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
}
