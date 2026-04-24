/**
 * Split an X-thread output string into individual tweets.
 *
 * Matches lines like "1/5", "2/5", "3/5" as post delimiters. Returns null
 * if the text doesn't look like a multi-part thread (fewer than 2 markers)
 * so callers can fall back to rendering a single textarea.
 */
export interface ThreadPost {
  index: number;   // 1-based
  total: number;
  text: string;
}

const MARKER_RE = /(^|\n)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[.:)\-]?\s*/;

export function splitThread(raw: string): ThreadPost[] | null {
  if (!raw) return null;
  const text = raw.trim();

  // Global pattern — find every marker position with its index/total
  const globalRe = /(^|\n)\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[.:)\-]?\s*/g;
  const markers: Array<{ pos: number; index: number; total: number; markerEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(text)) !== null) {
    const idx = parseInt(m[2], 10);
    const tot = parseInt(m[3], 10);
    if (!Number.isFinite(idx) || !Number.isFinite(tot) || tot < 2 || idx < 1 || idx > tot) continue;
    // m[1] is the leading newline or empty (for start-of-string). The
    // actual marker begins after the leading whitespace of the capture.
    markers.push({
      pos: m.index + (m[1]?.length ?? 0),
      index: idx,
      total: tot,
      markerEnd: globalRe.lastIndex,
    });
  }

  if (markers.length < 2) return null;

  // All markers must agree on the total (prevents false positives like
  // prose fractions "1/5 of users", "2/3 majority").
  const total = markers[0].total;
  if (!markers.every((m) => m.total === total)) return null;

  // And indices should climb monotonically from 1.
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].index !== i + 1) return null;
  }

  const posts: ThreadPost[] = [];
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    const body = text.slice(cur.markerEnd, next ? next.pos : text.length).trim();
    if (!body) continue;
    posts.push({ index: cur.index, total: cur.total, text: body });
  }

  return posts.length >= 2 ? posts : null;
}
