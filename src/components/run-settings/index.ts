/**
 * Shared run-settings — single source of truth for the per-render
 * controls (content filter, tone, narrator gender, voice override,
 * background, video mode) that appear in every "generate" dialog.
 *
 * Why this module exists: previously, GenerateWithAIDialog,
 * GenerateFromUrlDialog, GenerateFromCustomDialog, CustomScriptPage,
 * DialoguePage, and TextPostsPage each defined their own copies of
 * `TONES`, `CONTENT_FILTERS`, `VIDEO_MODES`, etc. Adding a new tone or
 * tweaking a label meant editing six places. Worse, when we shipped
 * the new "Long Reel" video mode the dialogs drifted briefly out of
 * sync until we caught the others. Pulling the constants here means
 * one place to update, six places get the update for free.
 *
 * The components in this folder are intentionally small and pluggable
 * — each dialog still owns its own wizard flow and chooses which
 * controls to render and where. No top-down `<RunSettings>` god-
 * component that imposes a layout.
 */

export * from "./constants";
export * from "./types";
