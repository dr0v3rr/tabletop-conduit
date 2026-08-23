// Path-safety for the durable roll archive. The Roll20 campaign id is UNTRUSTED — it comes from the
// page (window.campaign_id), which a hostile game or player can influence — so it must never be able
// to escape the archive directory, traverse, or hit an OS-reserved filename.
//
// This module is PURE (no node imports) so it can be unit-tested by the src/test tsc project (which
// has no @types/node). The final belt-and-suspenders path-containment check lives in main.ts, which
// is bundled by esbuild rather than tsc-checked and so can use node:path directly.

// Windows treats these base names as devices regardless of extension (CON.jsonl == the CON device).
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A safe `<id>.jsonl` filename for a campaign id: id-safe chars only (no path separators, no dots),
 *  length-capped, reserved-name-neutralised, non-empty. Real Roll20 ids are already `[A-Za-z0-9_-]`,
 *  so legitimate ids are unchanged; only adversarial input is rewritten. Because the result contains
 *  no separators and no `..`, it is always a single in-directory path segment. */
export function campaignLogFileName(id: string | null | undefined): string {
  let base = String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "unknown";
  if (WIN_RESERVED.test(base)) base = "_" + base; // e.g. CON -> _CON
  return `${base}.jsonl`;
}
