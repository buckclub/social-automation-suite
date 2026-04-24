import { useMemo, useState } from "react";
import {
  Copy, Check, Trash2, Pencil, Save as SaveIcon, RefreshCcw, History, X, Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api, type TextPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { splitThread } from "@/lib/thread-split";
import { ThreadView } from "@/components/ThreadView";

interface Props {
  post: TextPost;
  formatLabel: string;
  onChanged: () => void;
}

export function TextPostCard({ post, formatLabel, onChanged }: Props) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.current);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(post.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const saveEdits = async () => {
    if (editText.trim() === post.current.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.saveTextPost({
        id: post.id,
        text: editText,
        instruction: "manual edit",
        format: post.format,
        filter: post.filter,
        tone: post.tone,
        target_audience: post.target_audience,
        topic: post.topic,
        source_material: post.source_material,
        char_limit: post.char_limit ?? undefined,
      });
      setEditing(false);
      onChanged();
      toast({ title: "Edits saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const rewrite = async () => {
    const instr = rewriteInstruction.trim();
    if (!instr) {
      toast({ title: "Enter an instruction first (e.g. 'punchier hook')", variant: "destructive" });
      return;
    }
    setRewriting(true);
    try {
      const { text: newText } = await api.rewriteTextPost({
        format: post.format || "tweet",
        original: post.current,
        instruction: instr,
        content_filter: (post.filter as any) || undefined,
        target_audience: post.target_audience || undefined,
        tone: post.tone || undefined,
        char_limit: post.char_limit ?? undefined,
        source_material: post.source_material || undefined,
      });
      await api.saveTextPost({
        id: post.id,
        text: newText,
        instruction: instr,
        format: post.format,
        filter: post.filter,
        tone: post.tone,
        target_audience: post.target_audience,
        topic: post.topic,
        source_material: post.source_material,
        char_limit: post.char_limit ?? undefined,
      });
      setRewriteInstruction("");
      onChanged();
      toast({ title: "Rewritten" });
    } catch (e: any) {
      toast({ title: "Rewrite failed", description: e?.message, variant: "destructive" });
    } finally {
      setRewriting(false);
    }
  };

  const del = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteTextPost(post.id);
      onChanged();
      toast({ title: "Deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
      setDeleting(false);
    }
  };

  const createdLabel = new Date(post.created_at).toLocaleString();
  const updatedLabel = new Date(post.updated_at).toLocaleString();
  const charCount = (editing ? editText : post.current).length;
  const charLimit = post.char_limit;
  const overLimit = charLimit != null && charCount > charLimit;

  // If this is an X-thread (format === "x_thread") and the body has n/N
  // markers, render each post as its own tweet-shaped card in read mode.
  const thread = useMemo(() => {
    if (editing) return null;
    if (post.format !== "x_thread") return null;
    return splitThread(post.current);
  }, [post.format, post.current, editing]);

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[10px] font-medium">{formatLabel}</Badge>
          {post.tone && <span className="capitalize">{post.tone}</span>}
          {post.filter && <span>·  {post.filter}</span>}
          <span className="ml-auto">
            {post.updated_at !== post.created_at ? `edited ${updatedLabel}` : createdLabel}
          </span>
        </div>

        {editing ? (
          <>
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="min-h-[120px] text-xs bg-secondary/50 border-border"
            />
            <div className="flex items-center justify-between text-[10px]">
              <span className={cn(overLimit ? "text-destructive" : "text-muted-foreground")}>
                {charCount}{charLimit ? ` / ${charLimit}` : ""} chars
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); setEditText(post.current); }} className="h-6 text-[10px] px-2">
                  Cancel
                </Button>
                <Button size="sm" onClick={saveEdits} disabled={saving} className="h-6 text-[10px] px-2 gap-1">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <SaveIcon className="h-3 w-3" />}
                  Save
                </Button>
              </div>
            </div>
          </>
        ) : thread ? (
          <>
            <ThreadView posts={thread} compact />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{thread.length} posts in thread</span>
              <span className="text-[10px] text-muted-foreground">
                {charCount} chars total
              </span>
            </div>
          </>
        ) : (
          <>
            <p
              className={cn(
                "text-xs whitespace-pre-wrap leading-relaxed text-foreground",
                !expanded && "line-clamp-4",
              )}
            >
              {post.current}
            </p>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
              <span className={cn("text-[10px]", overLimit ? "text-destructive" : "text-muted-foreground")}>
                {charCount}{charLimit ? ` / ${charLimit}` : ""} chars
              </span>
            </div>
          </>
        )}

        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          <Button size="sm" variant="outline" onClick={copy} className="h-6 text-[10px] px-2 gap-1">
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => { setEditText(post.current); setEditing(true); }} className="h-6 text-[10px] px-2 gap-1">
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
          {(post.revisions?.length ?? 0) > 0 && (
            <Button
              size="sm" variant="outline"
              onClick={() => setShowHistory((v) => !v)}
              className="h-6 text-[10px] px-2 gap-1"
            >
              <History className="h-3 w-3" /> {post.revisions!.length} revision{post.revisions!.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={del} disabled={deleting} className="h-6 text-[10px] px-2 gap-1 text-destructive hover:bg-destructive/10">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </Button>
        </div>

        {/* Rewrite instruction row */}
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            value={rewriteInstruction}
            onChange={(e) => setRewriteInstruction(e.target.value)}
            placeholder="Rewrite instruction — e.g. 'punchier hook', 'drop the hashtags'"
            className="h-7 text-[11px] bg-secondary/50 border-border"
            onKeyDown={(e) => { if (e.key === "Enter" && !rewriting) rewrite(); }}
          />
          <Button size="sm" onClick={rewrite} disabled={rewriting || !rewriteInstruction.trim()} className="h-7 text-[10px] px-2 gap-1">
            {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            Rewrite
          </Button>
        </div>

        {showHistory && (post.revisions?.length ?? 0) > 0 && (
          <div className="pt-2 space-y-1.5 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Previous versions</Label>
              <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
            {[...(post.revisions ?? [])].reverse().map((r, i) => (
              <div key={i} className="rounded border border-border bg-secondary/30 p-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{new Date(r.at).toLocaleString()}</span>
                  {r.instruction && <span className="italic">→ {r.instruction}</span>}
                </div>
                <p className="text-[11px] whitespace-pre-wrap leading-relaxed text-muted-foreground">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
