// Vector art for poke5e's Poké Balls — one recolorable SVG per ball id (the SAME ids BALL_DC in
// electron/sheet.ts keys off, e.g. "great-ball"). Pure string builder: no DOM, safe in the renderer
// bundle and unit-testable. This module is purely the picture; the GM-facing capture maths lives with
// BALL_DC. Unknown ids fall back to a plain Poké Ball so a new ball type still renders something sane.

export type BallMark =
  | "arcs" | "H" | "M" | "stripes" | "dots" | "ring" | "web"
  | "wave" | "corners" | "crescent" | "leaf" | "bolt" | "eye" | "heart";

export interface BallArt {
  /** colour of the upper hemisphere */
  top: string;
  /** optional emblem on the top half */
  mark?: BallMark;
  /** mark colour (defaults to white) */
  mc?: string;
}

/** Keyed by the ball's item id — mirrors the ids in electron/sheet.ts BALL_DC. */
export const BALL_ART: Record<string, BallArt> = {
  "poke-ball":   { top: "#e3350d" },
  "great-ball":  { top: "#2f6fd6", mark: "arcs",     mc: "#e3350d" },
  "ultra-ball":  { top: "#1b1b1b", mark: "H",        mc: "#f6c700" },
  "master-ball": { top: "#5a2d8f", mark: "M",        mc: "#ff6fb5" },
  "safari-ball": { top: "#7a7f3c", mark: "stripes",  mc: "#474d21" },
  "friend-ball": { top: "#58c247", mark: "dots",     mc: "#e85d9b" },
  "sport-ball":  { top: "#e8622a", mark: "ring",     mc: "#2fa84f" },
  "net-ball":    { top: "#1fb5ae", mark: "web",      mc: "#0e3a52" },
  "dive-ball":   { top: "#2a7fd0", mark: "wave",     mc: "#bfe6ff" },
  "heavy-ball":  { top: "#2b3b66", mark: "corners",  mc: "#f6c700" },
  "repeat-ball": { top: "#e8902a", mark: "ring",     mc: "#c23016" },
  "moon-ball":   { top: "#24306a", mark: "crescent", mc: "#f6c700" },
  "lure-ball":   { top: "#2aa6c0", mark: "dots",     mc: "#e3350d" },
  "level-ball":  { top: "#e23b16", mark: "stripes",  mc: "#f6c700" },
  "nest-ball":   { top: "#6fae3a", mark: "leaf",     mc: "#cdea7a" },
  "quick-ball":  { top: "#2f6fd6", mark: "bolt",     mc: "#f6c700" },
  "dusk-ball":   { top: "#20392a", mark: "eye",      mc: "#e8632a" },
  "love-ball":   { top: "#ec6fae", mark: "heart",    mc: "#ffffff" },
  "timer-ball":  { top: "#dfe3ea", mark: "stripes",  mc: "#e3350d" },
  "fast-ball":   { top: "#f2c200", mark: "bolt",     mc: "#e23b16" },
};

const FALLBACK: BallArt = { top: "#e3350d" }; // unknown ball id → a plain Poké Ball

/** Normalize an item id to a BALL_ART key (lowercase, non-dash separators → dash, a couple of aliases). */
export function ballArtKey(itemId: string | null | undefined): string {
  const raw = String(itemId ?? "").trim().toLowerCase();
  if (BALL_ART[raw]) return raw;
  const dash = raw.replace(/[_\s]+/g, "-");
  if (BALL_ART[dash]) return dash;
  if (dash === "pokeball" || dash === "poké-ball") return "poke-ball";
  return raw;
}

/** True if we have dedicated art for this ball id (vs. the generic Poké Ball fallback). */
export function hasBallArt(itemId: string | null | undefined): boolean {
  return Boolean(BALL_ART[ballArtKey(itemId)]);
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markSvg(kind: BallMark | undefined, mc: string, top: string): string {
  switch (kind) {
    case "arcs":     return `<path fill="${mc}" d="M18 42 L41 26 L46 32 L26 46 Z"/><path fill="${mc}" d="M82 42 L59 26 L54 32 L74 46 Z"/>`;
    case "H":        return `<g fill="${mc}"><rect x="33" y="13" width="6.5" height="29"/><rect x="60.5" y="13" width="6.5" height="29"/><rect x="33" y="23.5" width="34" height="6.5"/></g>`;
    case "M":        return `<path fill="${mc}" d="M39 42 L39 17 L50 30 L61 17 L61 42 L55 42 L55 28 L50 35 L45 28 L45 42 Z"/><circle cx="27" cy="21" r="3.2" fill="#fff"/><circle cx="73" cy="21" r="3.2" fill="#fff"/>`;
    case "stripes":  return `<g fill="${mc}"><rect x="0" y="19" width="100" height="5"/><rect x="0" y="31" width="100" height="5"/></g>`;
    case "dots":     return `<circle cx="29" cy="27" r="5" fill="${mc}"/><circle cx="71" cy="27" r="5" fill="${mc}"/>`;
    case "ring":     return `<circle cx="50" cy="50" r="19" fill="none" stroke="${mc}" stroke-width="5"/>`;
    case "web":      return `<g stroke="${mc}" stroke-width="2.3" fill="none" opacity=".92"><path d="M14 40 L50 17 L86 40"/><path d="M24 43 L50 26 L76 43"/><path d="M50 17 L50 44"/><path d="M33 21 L39 44"/><path d="M67 21 L61 44"/></g>`;
    case "wave":     return `<path fill="none" stroke="${mc}" stroke-width="4" stroke-linecap="round" d="M15 31 Q27 21 39 31 T63 31 T87 31"/>`;
    case "corners":  return `<g fill="${mc}"><path d="M14 19 h17 v6 h-11 v11 h-6 Z"/><path d="M86 19 h-17 v6 h11 v11 h6 Z"/></g>`;
    case "crescent": return `<circle cx="51" cy="29" r="14" fill="${mc}"/><circle cx="58" cy="25" r="13" fill="${top}"/>`;
    case "leaf":     return `<path fill="${mc}" d="M50 13 Q71 24 50 45 Q29 24 50 13 Z"/><path stroke="${top}" stroke-width="1.6" fill="none" d="M50 16 L50 42"/>`;
    case "bolt":     return `<path fill="${mc}" d="M57 13 L33 38 L47 38 L43 49 L69 23 L54 23 Z"/>`;
    case "eye":      return `<ellipse cx="50" cy="29" rx="14" ry="8.5" fill="${mc}"/><circle cx="50" cy="29" r="3.6" fill="#141417"/>`;
    case "heart":    return `<path fill="${mc}" d="M50 43 C33 31 34 15 46 17 C49.5 17.4 50 21 50 23 C50 21 50.5 17.4 54 17 C66 15 67 31 50 43 Z"/>`;
    default:         return "";
  }
}

export interface BallSvgOpts {
  /** pixel size for both width and height; omit to let CSS size it (viewBox is always 0 0 100 100) */
  size?: number;
  /** extra class(es) on the <svg> */
  className?: string;
  /** accessible label; defaults to the ball id */
  title?: string;
}

/**
 * Build a standalone, self-contained `<svg>` string for a ball id. The clip/gradient `<defs>` ids are
 * keyed off the ball id — identical across repeats of the same ball on a page, which is harmless since
 * the defs are geometrically identical, and distinct between different balls.
 */
export function ballSvg(itemId: string | null | undefined, opts: BallSvgOpts = {}): string {
  const key = ballArtKey(itemId);
  const art: BallArt = BALL_ART[key] ?? FALLBACK;
  const idk = BALL_ART[key] ? key : "fallback";
  const cls = opts.className ? ` class="${opts.className}"` : "";
  const dim = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const label = opts.title ?? (itemId ? String(itemId) : "Poké Ball");
  const c = "bc_" + idk, s = "bs_" + idk;
  return (
    `<svg${cls}${dim} viewBox="0 0 100 100" role="img" aria-label="${xmlEsc(label)}">` +
      `<defs>` +
        `<clipPath id="${c}"><circle cx="50" cy="50" r="46"/></clipPath>` +
        `<radialGradient id="${s}" cx="38%" cy="30%" r="62%">` +
          `<stop offset="0" stop-color="#fff" stop-opacity=".5"/>` +
          `<stop offset="46%" stop-color="#fff" stop-opacity="0"/>` +
        `</radialGradient>` +
      `</defs>` +
      `<g clip-path="url(#${c})">` +
        `<rect x="0" y="0" width="100" height="50" fill="${art.top}"/>` +
        `<rect x="0" y="50" width="100" height="50" fill="#eef1f6"/>` +
        markSvg(art.mark, art.mc || "#fff", art.top) +
        `<rect x="0" y="44.5" width="100" height="11" fill="#141417"/>` +
        `<circle cx="50" cy="50" r="200" fill="url(#${s})"/>` +
      `</g>` +
      `<circle cx="50" cy="50" r="13.5" fill="#141417"/>` +
      `<circle cx="50" cy="50" r="8.6" fill="#f3f4f6"/>` +
      `<circle cx="50" cy="50" r="3.3" fill="#c9cdd6"/>` +
      `<circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>` +
    `</svg>`
  );
}
