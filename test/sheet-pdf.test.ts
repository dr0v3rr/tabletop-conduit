import { describe, it, expect } from "vitest";
import { buildSheetDto, renderSheetHtml, sgn, type SheetInput } from "../src/sheet/sheet-pdf";

function sampleInput(over: Partial<SheetInput> = {}): SheetInput {
  const model: any = {
    name: "Mira",
    level: 5,
    profBonus: 3,
    initiative: 2,
    speed: 30,
    abilities: {
      STR: { score: 8, mod: -1 }, DEX: { score: 16, mod: 3 }, CON: { score: 14, mod: 2 },
      INT: { score: 18, mod: 4 }, WIS: { score: 12, mod: 1 }, CHA: { score: 10, mod: 0 },
    },
    saves: {
      STR: { mod: -1, proficient: false }, DEX: { mod: 3, proficient: false }, CON: { mod: 2, proficient: false },
      INT: { mod: 7, proficient: true }, WIS: { mod: 4, proficient: true }, CHA: { mod: 0, proficient: false },
    },
    skills: {
      arcana: { mod: 7, ability: "INT", proficient: true, expertise: false },
      stealth: { mod: 6, ability: "DEX", proficient: true, expertise: true },
    },
    passives: { perception: 11, investigation: 17, insight: 11 },
  };
  return {
    model,
    subtitle: "Level 5 Wizard",
    ac: 15,
    hp: { current: 22, max: 32, temp: 4 },
    hitDice: "5d6",
    weapons: [{ name: "Dagger", attackMod: 5, damageDice: "1d4", damageMod: 3, damageType: "piercing", proficient: true }],
    spellcasting: { classes: [{ attackBonus: 7, saveDc: 15 }], spells: [{ name: "Fire Bolt", isCantrip: true, casting: "attack", attackBonus: 7, damageDice: "2d10", damageType: "fire" }] },
    spellSlots: [{ level: 1, total: 4, used: 1 }],
    inventory: [{ name: "Potion of Healing", quantity: 2 }],
    feats: [{ name: "Arcane Recovery", description: "Recover spell slots on a short rest." }],
    ...over,
  };
}

describe("sgn", () => {
  it("formats signed modifiers with a real minus sign", () => {
    expect(sgn(3)).toBe("+3");
    expect(sgn(0)).toBe("+0");
    expect(sgn(-1)).toBe("−1");
  });
});

describe("buildSheetDto", () => {
  const dto = buildSheetDto(sampleInput());

  it("carries header + core stats, formatted", () => {
    expect(dto.name).toBe("Mira");
    expect(dto.subtitle).toBe("Level 5 Wizard");
    expect(dto.profBonus).toBe("+3");
    expect(dto.ac).toBe("15");
    expect(dto.initiative).toBe("+2");
    expect(dto.speed).toBe("30 ft");
    expect(dto.hp).toEqual({ current: "22", max: "32", temp: "4" });
    expect(dto.hitDice).toBe("5d6");
  });

  it("emits all six abilities in order with score + mod", () => {
    expect(dto.abilities.map((a) => a.key)).toEqual(["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
    expect(dto.abilities[3]).toEqual({ key: "INT", score: "18", mod: "+4" });
    expect(dto.abilities[0]!.mod).toBe("−1");
  });

  it("emits all 18 skills and flags proficiency/expertise", () => {
    expect(dto.skills).toHaveLength(18);
    const stealth = dto.skills.find((s) => s.label === "Stealth")!;
    expect(stealth).toMatchObject({ ability: "DEX", mod: "+6", prof: true, expertise: true });
    const arcana = dto.skills.find((s) => s.label === "Arcana")!;
    expect(arcana).toMatchObject({ prof: true, expertise: false, mod: "+7" });
    // a skill with no data defaults to +0, not proficient
    expect(dto.skills.find((s) => s.label === "Athletics")).toMatchObject({ mod: "+0", prof: false });
  });

  it("builds attacks, spells (with meta), features and equipment", () => {
    expect(dto.attacks[0]).toEqual({ name: "Dagger", hit: "+5", damage: "1d4+3 piercing" });
    expect(dto.spellMeta).toBe("Spell atk +7 · save DC 15");
    expect(dto.spells[0]).toMatchObject({ level: "Cantrip", name: "Fire Bolt", detail: "+7 · 2d10 fire" });
    expect(dto.features[0]).toEqual({ name: "Arcane Recovery", text: "Recover spell slots on a short rest." });
    expect(dto.equipment[0]).toEqual({ name: "Potion of Healing", qty: "×2" });
  });

  it("handles missing optional data without throwing", () => {
    const bare = buildSheetDto(sampleInput({ ac: null, hp: null, hitDice: null, weapons: [], spellcasting: null, inventory: [], feats: [] }));
    expect(bare.ac).toBe("—");
    expect(bare.hp.max).toBe("—");
    expect(bare.attacks).toEqual([]);
    expect(bare.spells).toEqual([]);
    expect(bare.spellMeta).toBe("");
  });
});

describe("renderSheetHtml", () => {
  it("produces a self-contained page containing the character's data", () => {
    const html = renderSheetHtml(buildSheetDto(sampleInput()));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page");
    expect(html).toContain("Mira");
    expect(html).toContain("Fire Bolt");
    expect(html).toContain("Dagger");
  });

  it("escapes HTML in user-controlled values", () => {
    const html = renderSheetHtml(buildSheetDto(sampleInput({ subtitle: "<script>x</script>" })));
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("locks scripts to a per-render CSP nonce (no unsafe-inline, no remote loads)", () => {
    const html = renderSheetHtml(buildSheetDto(sampleInput()));
    const m = html.match(/script-src 'nonce-([a-z0-9]+)'/i);
    expect(m).toBeTruthy();
    expect(html).toContain(`<script nonce="${m![1]}">`); // only our scaling script carries the nonce
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/script-src[^;"]*'unsafe-inline'/); // scripts are never unsafe-inline
    // a second render uses a different nonce
    const m2 = renderSheetHtml(buildSheetDto(sampleInput())).match(/script-src 'nonce-([a-z0-9]+)'/i);
    expect(m2![1]).not.toBe(m![1]);
  });

  it("neutralizes injected markup/handlers from any user-controlled field", () => {
    const evil = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
    const html = renderSheetHtml(buildSheetDto(sampleInput({ subtitle: evil, feats: [{ name: evil, description: evil }] })));
    expect(html).not.toContain("<img src=x onerror=");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain('"><img'); // attribute break-out neutralized
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("wraps the sheet for scale-to-fit-one-page (zero page margin + scaling script)", () => {
    const html = renderSheetHtml(buildSheetDto(sampleInput()));
    expect(html).toContain('id="sheetRoot"');
    expect(html).toContain('id="sheetWrap"');
    expect(html).toContain("@page { size: Letter; margin: 0;");
    expect(html).toMatch(/Math\.min\(1, *739 *\/ *w, *979 *\/ *h\)/); // fits into the 739x979 content area
  });

  it("always includes a Notes section and blank equipment rows to write on", () => {
    const html = renderSheetHtml(buildSheetDto(sampleInput()));
    expect(html).toContain(">Notes<");
    expect(html).toContain("blankline"); // ruled blank lines for equipment + notes
  });

  it("renders the creature image only when provided, and passes the URL through", () => {
    const withImg = buildSheetDto(sampleInput({ imageUrl: "https://poke5e.app/assets/pokemon/ralts/art.png" }));
    expect(withImg.image).toBe("https://poke5e.app/assets/pokemon/ralts/art.png");
    expect(renderSheetHtml(withImg)).toContain('<img src="https://poke5e.app/assets/pokemon/ralts/art.png"');
    // no image → no <img tag
    expect(renderSheetHtml(buildSheetDto(sampleInput()))).not.toContain("<img");
  });
});
