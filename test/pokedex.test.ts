import { describe, it, expect } from "vitest";
import { buildPokedex, normalizeSpecies, spriteUrl, artUrl } from "../src/poke5e/pokedex";

const RALTS = {
  id: "ralts", name: "Ralts", number: 280, type: ["psychic", "fairy"], size: "tiny", sr: 0.25,
  ac: 11, hp: 16, hitDice: "d6", speed: [{ type: "walking", value: 25 }],
  attributes: { str: 9, dex: 12, con: 10, int: 10, wis: 12, cha: 10 },
  savingThrows: ["wis"], skills: ["insight"],
  abilities: [{ id: "synchronize", name: "Synchronize", description: "Passes status conditions back to the attacker." }, { id: "trace", name: "Trace" }, { id: "telepathy", name: "Telepathy", hidden: true }],
  habitat: { nativeRegion: "Hoenn", biomes: ["forest", "city"] },
  evolution: { from: [], to: [{ id: "kirlia", conditions: [{ type: "level", value: 6 }] }] },
  moves: { start: ["growl", "confusion"], level14: ["hypnosis", "dream-eater"] },
};
const KIRLIA = { id: "kirlia", name: "Kirlia", number: 281, type: ["psychic", "fairy"], evolution: {} };
const MOVES = [
  { id: "growl", name: "Growl", type: "normal", description: ["Lowers the target's Attack."] },
  { id: "confusion", name: "Confusion", type: "psychic", description: ["1d8 psychic; may confuse."] },
  { id: "hypnosis", name: "Hypnosis", type: "psychic", description: ["Target saves or falls asleep."] },
  { id: "dream-eater", name: "Dream Eater", type: "psychic", description: ["Heals off a sleeping target."] },
];

describe("pokedex normalizeSpecies", () => {
  const byId: Record<string, any> = { ralts: RALTS, kirlia: KIRLIA };
  const movesById = Object.fromEntries(MOVES.map((m) => [m.id, m]));
  const e = normalizeSpecies(RALTS, movesById, byId);

  it("maps core fields, stats, saves, and skills", () => {
    expect(e.num).toBe(280);
    expect(e.types).toEqual(["psychic", "fairy"]);
    expect(e.sr).toBe(0.25);
    expect(e.stats).toEqual({ STR: 9, DEX: 12, CON: 10, INT: 10, WIS: 12, CHA: 10 });
    expect(e.saves).toEqual(["WIS"]);
    expect(e.skills).toEqual(["Insight"]);
    expect(e.size).toBe("Tiny");
  });
  it("flags a hidden ability, carries ability text, and formats speed", () => {
    expect(e.abilities.find((a) => a.name === "Telepathy")!.hidden).toBe(true);
    expect(e.abilities.find((a) => a.name === "Synchronize")!.description).toContain("Passes status conditions");
    expect(e.abilities.find((a) => a.name === "Trace")!.description).toBe(""); // missing text → empty, not undefined
    expect(e.speed).toBe("25 ft");
    expect(e.speedModes).toEqual([{ type: "walking", value: 25 }]);
  });
  it("resolves level-up moves with wording + level labels, and flags sleep moves", () => {
    const hyp = e.moves.find((m) => m.id === "hypnosis")!;
    expect(hyp.level).toBe("L14");
    expect(hyp.sleep).toBe(true);
    expect(hyp.description).toContain("falls asleep");
    expect(e.sleep).toBe(true); // has Hypnosis
  });
  it("builds the evolution chain with conditions", () => {
    expect(e.evolution).toEqual([
      { name: "Ralts", here: true },
      { name: "Kirlia", cond: "Lv 6" },
    ]);
  });
  it("points sprites at poke5e's asset host", () => {
    expect(e.sprite).toBe(spriteUrl("ralts"));
    expect(e.art).toBe(artUrl("ralts"));
    expect(e.sprite).toMatch(/^https:\/\/poke5e\.app\/assets\/pokemon\/ralts\/sprite\.png$/);
  });
});

describe("pokedex media handling", () => {
  const movesById = {};
  it("uses the dataset's own media paths (absolute-ized)", () => {
    const p = { id: "mudkip", name: "Mudkip", number: 258, media: { sprite: "/assets/pokemon/mudkip/sprite.png", main: "/assets/pokemon/mudkip/main.png" } };
    const e = normalizeSpecies(p, movesById, {});
    expect(e.sprite).toBe("https://poke5e.app/assets/pokemon/mudkip/sprite.png");
    expect(e.art).toBe("https://poke5e.app/assets/pokemon/mudkip/main.png");
  });
  it("leaves sprite empty for a fakémon with art but no sprite (→ placeholder), keeping its /unofficial art", () => {
    const p = { id: "rookite", name: "Rookite", number: 0, media: { main: "/unofficial/rookite/main.png" } };
    const e = normalizeSpecies(p, movesById, {});
    expect(e.sprite).toBe(""); // no list sprite → UI renders an initial-letter placeholder
    expect(e.art).toBe("https://poke5e.app/unofficial/rookite/main.png");
  });
  it("flags /unofficial species as fakémon (hidden by default), and /assets species as official", () => {
    const fake = normalizeSpecies({ id: "rookite", name: "Rookite", media: { main: "/unofficial/rookite/main.png" } }, movesById, {});
    const real = normalizeSpecies({ id: "mudkip", name: "Mudkip", media: { sprite: "/assets/pokemon/mudkip/sprite.png" } }, movesById, {});
    expect(fake.fakemon).toBe(true);
    expect(real.fakemon).toBe(false);
  });
});

describe("pokedex buildPokedex", () => {
  it("normalizes and sorts by dex number", () => {
    const dex = buildPokedex([KIRLIA, RALTS], MOVES); // input out of order
    expect(dex.map((p) => p.num)).toEqual([280, 281]);
  });
});
