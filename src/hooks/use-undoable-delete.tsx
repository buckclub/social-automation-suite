/**
 * useUndoableDelete — defer a destructive action by 5 seconds with an
 * inline Undo toast. Used across delete-video, clear-history,
 * delete-brand, delete-calendar-slot, etc.
 *
 * Pattern:
 *
 *   const undoDelete = useUndoableDelete();
 *
 *   undoDelete({
 *     label: `Deleted "${video.title}"`,
 *     hide:    () => setVideos(v => v.filter(x => x.id !== video.id)),
 *     restore: () => setVideos(v => [...v, video]),
 *     commit:  () => api.deleteVideo(video.id),
 *   });
 *
 * Behaviour:
 *  - hide() runs immediately (optimistic UI: row disappears).
 *  - The toast shows for 5s with an Undo button.
 *  - If the user clicks Undo, restore() runs and commit() is cancelled.
 *  - If the timer fires, commit() runs (the actual API call). On
 *    failure, restore() runs and an error toast surfaces.
 *
 * Why this pattern (and not "soft-delete on the backend"):
 *  - No backend round-trip needed during the undo window.
 *  - Works for any destructive action, not just CRUD on a single
 *    resource. Clearing queue history, for example, doesn't have a
 *    natural "restore" endpoint.
 *  - The 5s window matches Gmail / Slack norms — long enough to catch
 *    the "wait, no" reflex, short enough that the user moves on.
 */
import { useCallback, useRef } from "react";

import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export interface UndoableDeleteArgs {
  /** Toast headline. Past-tense reads naturally — "Deleted Foo." */
  label: string;
  /** Optional sub-line in the toast body. */
  description?: string;
  /** Called immediately to hide the row from the UI. */
  hide: () => void;
  /** Called if the user clicks Undo OR if commit() fails. */
  restore: () => void;
  /**
   * Called after the undo window elapses to actually perform the
   * destructive action (typically an API call). Awaited; rejection
   * triggers restore() + an error toast.
   */
  commit: () => Promise<unknown> | unknown;
  /** Override the 5s default if a particular flow needs more time. */
  delayMs?: number;
}

export function useUndoableDelete() {
  const { toast } = useToast();
  // Track per-call timers so a follow-up call doesn't lose the prior
  // one's commit. (Multi-delete in quick succession is rare but
  // possible — bulk-clear, e.g.)
  const timers = useRef<Set<number>>(new Set());

  const trigger = useCallback(
    (args: UndoableDeleteArgs) => {
      const { label, description, hide, restore, commit, delayMs = 5000 } = args;

      // Optimistic hide.
      hide();

      let undone = false;

      const tid = window.setTimeout(async () => {
        timers.current.delete(tid);
        if (undone) return;
        try {
          await commit();
        } catch (e: unknown) {
          // Backend rejected the actual delete — put the row back and
          // surface the error so the user knows the optimistic hide
          // was rolled back.
          restore();
          toast({
            title: "Couldn't delete",
            description: e instanceof Error ? e.message : "The server rejected the request.",
            variant: "destructive",
          });
        }
      }, delayMs);
      timers.current.add(tid);

      toast({
        title: label,
        description,
        // Approximate display time matches the undo window. Default
        // toast duration is much longer; we shorten so the toast
        // dismisses around when the action commits.
        duration: delayMs + 200,
        action: (
          <ToastAction
            altText="Undo"
            onClick={() => {
              undone = true;
              clearTimeout(tid);
              timers.current.delete(tid);
              restore();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [toast],
  );

  return trigger;
}
