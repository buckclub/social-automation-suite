import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
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
 */
interface State { err: Error | null; info: string | null; }

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

  render() {
    if (!this.state.err) return this.props.children;
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
