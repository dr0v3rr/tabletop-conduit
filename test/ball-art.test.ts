import { describe, it, expect } from "vitest";
import { ballSvg, ballArtKey, hasBallArt, BALL_ART } from "../src/poke5e/ball-art";

// The ball ids poke5e's BALL_DC (electron/sheet.ts) defines. ball-art.ts must cover every one so a ball
// that can be thrown always has dedicated art — otherwise it would silently fall back to a plain red
// Poké Ball, which is the bug this test guards against.
const BALL_DC_IDS = [
  "poke-ball", "great-ball", "ultra-ball", "master-ball", "safari-ball", "friend-ball",
  "sport-ball", "net-ball", "dive-ball", "heavy-ball", "repeat-ball", "moon-ball", "lure-ball",
  "level-ball", "nest-ball", "quick-ball", "dusk-ball", "love-ball", "timer-ball", "fast-ball",
  "dream-ball", "heal-ball", "luxury-ball", "premier-ball",
];

describe("ball-art", () => {
  it("has dedicated art for every BALL_DC ball id", () => {
    for (const id of BALL_DC_IDS) expect(hasBallArt(id), id).toBe(true);
    expect(Object.keys(BALL_ART).sort()).toEqual([...BALL_DC_IDS].sort());
  });

  it("renders a single self-contained <svg> with the ball's top colour", () => {
    const svg = ballSvg("great-ball");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect((svg.match(/<svg/g) || []).length).toBe(1);
    expect((svg.match(/<\/svg>/g) || []).length).toBe(1);
    // Great Ball's blue hemisphere + its red arc mark.
    expect(svg).toContain(`fill="${BALL_ART["great-ball"]!.top}"`);
    expect(svg).toContain(`fill="${BALL_ART["great-ball"]!.mc}"`);
    // the white lower hemisphere + black button are always present
    expect(svg).toContain(`fill="#eef1f6"`);
  });

  it("gives each known ball a distinct top colour (not all the Poké Ball red)", () => {
    const tops = new Set(BALL_DC_IDS.map((id) => BALL_ART[id]!.top));
    expect(tops.size).toBeGreaterThan(10);
  });

  it("falls back to a plain Poké Ball for an unknown id, still valid svg", () => {
    const svg = ballSvg("beast-ball"); // a real-world ball poke5e doesn't define → genuinely unknown
    expect(hasBallArt("beast-ball")).toBe(false);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`fill="${BALL_ART["poke-ball"]!.top}"`); // red top like a Poké Ball
    expect(svg).toContain(`id="bc_fallback"`); // fallback keeps its own def ids
  });

  it("normalizes ids: separators, case, and the 'pokeball' alias", () => {
    expect(ballArtKey("Great_Ball")).toBe("great-ball");
    expect(ballArtKey("  ULTRA BALL ")).toBe("ultra-ball");
    expect(ballArtKey("pokeball")).toBe("poke-ball");
    expect(ballArtKey(null)).toBe("");
    expect(hasBallArt("Great_Ball")).toBe(true);
  });

  it("honours size and title options", () => {
    const svg = ballSvg("dusk-ball", { size: 24, title: "Dusk Ball", className: "ball-icon" });
    expect(svg).toContain(`width="24" height="24"`);
    expect(svg).toContain(`aria-label="Dusk Ball"`);
    expect(svg).toContain(`class="ball-icon"`);
  });

  it("escapes a hostile title (no raw angle brackets or quotes leak into the attribute)", () => {
    const svg = ballSvg("poke-ball", { title: `"><script>x` });
    expect(svg).not.toContain(`"><script>`);
    expect(svg).toContain("&quot;&gt;&lt;script&gt;x");
  });
});
