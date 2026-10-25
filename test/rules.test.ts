import { describe, it, expect } from "vitest";

import aldricFixture from "./fixtures/aldric-144074405.json";
import { RULES, listAvailableToggles, resolveEffects } from "../src/rules/index.js";
import type { Rule } from "../src/rules/index.js";
import type { RollRequest, RuleEffect } from "../src/shared/roll-types.js";
import type { CharacterData, RollModel } from "../src/engine/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function byId(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id);
}

/** A minimal stand-in RollModel (only what the registry might read: profBonus). */
const rollModel = { profBonus: 3 } as unknown as RollModel;

/** A minimal character with a given set of feats. */
function charWithFeats(...names: string[]): CharacterData {
  return {
    name: "Test",
    stats: [],
    classes: [],
    feats: names.map((n) => ({ definition: { name: n } })),
  } as unknown as CharacterData;
}

const emptyChar = charWithFeats();

const attackReq: RollRequest = { kind: "attack" };

function has(effects: RuleEffect[], pred: (e: RuleEffect) => boolean): boolean {
  return effects.some(pred);
}

// ---------------------------------------------------------------------------
// Registry contents
// ---------------------------------------------------------------------------

describe("registry contents", () => {
  it("contains the 83 catalog entries + 3 additions + 6 condition rules", () => {
    const nonCondition = RULES.filter((r) => !/^condition-/.test(r.id));
    expect(nonCondition.length).toBe(86); // 83 catalog + Elven Accuracy + Savage Attacker + automatic Brutal Critical
    const conditionRules = RULES.filter((r) => /^condition-/.test(r.id));
    expect(conditionRules.length).toBe(6); // Blinded/Frightened/Invisible/Poisoned/Prone/Restrained
  });

  it("has all the key rules present by id", () => {
    for (const id of [
      "sharpshooter",
      "great-weapon-master",
      "effects-bless",
      "great-weapon-fighting-2014",
      "halfling-lucky",
      "elven-accuracy",
      "savage-attacker",
    ]) {
      expect(byId(id), `missing rule ${id}`).toBeDefined();
    }
  });

  it("has unique ids", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("appends Elven Accuracy and Savage Attacker with the right shapes", () => {
    const ea = byId("elven-accuracy")!;
    expect(ea.toggle).toBe(false);
    expect(ea.kind).toBe("advantage");

    const sa = byId("savage-attacker")!;
    expect(sa.toggle).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEffects — specific mappings
// ---------------------------------------------------------------------------

describe("resolveEffects", () => {
  it("Sharpshooter yields -5 attack and +10 damage", () => {
    const effects = resolveEffects(emptyChar, rollModel, attackReq, ["sharpshooter"]);
    expect(
      has(effects, (e) => e.op === "flat" && e.target === "attack" && e.value === -5),
    ).toBe(true);
    expect(
      has(effects, (e) => e.op === "flat" && e.target === "damage" && e.value === 10),
    ).toBe(true);
  });

  it("Bless yields an add-dice 1d4 (on attack)", () => {
    const effects = resolveEffects(emptyChar, rollModel, attackReq, ["effects-bless"]);
    expect(
      has(effects, (e) => e.op === "add-dice" && e.dice === "1d4"),
    ).toBe(true);
  });

  it("Great Weapon Master yields -5 attack and +10 damage", () => {
    const effects = resolveEffects(emptyChar, rollModel, attackReq, ["great-weapon-master"]);
    expect(has(effects, (e) => e.op === "flat" && e.target === "attack" && e.value === -5)).toBe(true);
    expect(has(effects, (e) => e.op === "flat" && e.target === "damage" && e.value === 10)).toBe(true);
  });

  it("Great Weapon Fighting yields a reroll threshold 2", () => {
    const gwf = byId("great-weapon-fighting-2014")!;
    const effects = gwf.toEffects(emptyChar, rollModel, { kind: "attack", weapon: { ability: "STR", melee: true, twoHanded: true } });
    expect(
      has(effects, (e) => e.op === "reroll" && e.threshold === 2),
    ).toBe(true);
    // …and nothing for a spell, a bow or a one-handed swing
    expect(gwf.toEffects(emptyChar, rollModel, { kind: "attack" })).toHaveLength(0);
  });

  it("Halfling Lucky yields a reroll threshold 1", () => {
    const hl = byId("halfling-lucky")!;
    const effects = hl.toEffects(emptyChar, rollModel, attackReq);
    expect(has(effects, (e) => e.op === "reroll" && e.threshold === 1)).toBe(true);
  });

  it("Elven Accuracy only produces an effect when the attack already has advantage", () => {
    const ea = byId("elven-accuracy")!;
    expect(ea.toEffects(emptyChar, rollModel, { kind: "attack" })).toHaveLength(0);
    const withAdv = ea.toEffects(emptyChar, rollModel, { kind: "attack", advantage: "advantage" });
    expect(
      has(withAdv, (e) => e.op === "advantage" && e.mode === "elven-accuracy"),
    ).toBe(true);
  });

  it("Savage Attacker yields reroll-keep-higher on damage", () => {
    const sa = byId("savage-attacker")!;
    const effects = sa.toEffects(emptyChar, rollModel, { kind: "damage" });
    expect(has(effects, (e) => e.op === "reroll-keep-higher" && e.target === "damage")).toBe(true);
  });

  it("does not include a disabled toggle's effects", () => {
    const effects = resolveEffects(emptyChar, rollModel, attackReq, []);
    expect(has(effects, (e) => e.op === "flat" && e.value === -5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirmed-bug regressions
// ---------------------------------------------------------------------------

describe("confirmed-bug regressions", () => {
  it("Silver Tongue produces NO effects (Bug 2)", () => {
    const st = byId("silver-tongue")!;
    expect(st.toEffects(emptyChar, rollModel, { kind: "check" })).toHaveLength(0);
    // and must not inject an advantage that would corrupt attacks
    expect(has(st.toEffects(emptyChar, rollModel, { kind: "attack" }), (e) => e.op === "advantage")).toBe(false);
  });

  it("Reliable Talent produces NO effects (Bug 2)", () => {
    const rt = byId("reliable-talent")!;
    expect(rt.toEffects(emptyChar, rollModel, { kind: "check" })).toHaveLength(0);
    // and must not inject a damage reroll
    expect(has(rt.toEffects(emptyChar, rollModel, { kind: "damage" }), (e) => e.op === "reroll")).toBe(false);
  });

  it("Halfling Lucky targets ALL d20 rolls, not just attacks (Bug 4)", () => {
    const hl = byId("halfling-lucky")!;
    const effects = hl.toEffects(emptyChar, rollModel, attackReq);
    expect(has(effects, (e) => e.op === "reroll" && e.target === "d20" && e.threshold === 1)).toBe(true);
  });

  it("the level-less Exhaustion toggles never resolve — the condition's level drives it instead", () => {
    const effects = resolveEffects(emptyChar, rollModel, attackReq, ["effects-exhaustion-2024", "effects-exhaustion-2014"]);
    expect(effects.filter((e) => /exhaustion/i.test(e.label ?? ""))).toHaveLength(0);
  });

  it("a character with Great Weapon Fighting gets exactly ONE GWF effect, for its own edition (Bug 6)", () => {
    // 2014: a Fighting Style option (Player's Handbook 2014, source 1) → reroll 1s and 2s
    const char2014 = {
      name: "GWF", stats: [], feats: [],
      classes: [{ definition: { name: "Fighter" }, classFeatures: [{ definition: { name: "Fighting Style", sources: [{ sourceId: 1 }] } }] }],
      options: { class: [{ definition: { name: "Great Weapon Fighting", sourceId: 1 } }] },
    } as unknown as CharacterData;
    // 2024: a Fighting Style feat (Player's Handbook 2024, source 145) → 1s and 2s count as 3
    const char2024 = {
      name: "GWF", stats: [], classes: [{ definition: { name: "Fighter" }, classFeatures: [] }],
      feats: [{ definition: { name: "Great Weapon Fighting", sourceId: 145 } }],
    } as unknown as CharacterData;
    const req: RollRequest = { kind: "attack", weapon: { ability: "STR", melee: true, twoHanded: true } };
    const gwf = (c: CharacterData) => resolveEffects(c, rollModel, req, []).filter((e) => e.label === "Great Weapon Fighting");
    expect(gwf(char2014).map((e) => e.op)).toEqual(["reroll"]);
    expect(gwf(char2024).map((e) => e.op)).toEqual(["min-die"]);
  });

  it("only features the character has reached count (DDB lists every level's features)", () => {
    const cls = (name: string, level: number, feats: [string, number][]) => ({ name: "C", stats: [], feats: [],
      classes: [{ level, definition: { name }, classFeatures: feats.map(([n, requiredLevel]) => ({ definition: { name: n, requiredLevel } })) }],
    }) as unknown as CharacterData;
    // A Paladin 6 has Divine Smite but not Improved Divine Smite (11th)
    const pal = cls("Paladin", 6, [["Divine Smite", 2], ["Improved Divine Smite", 11]]);
    expect(byId("paladin-improved-divine-smite")!.appliesTo(pal, attackReq)).toBe(false);
    expect(byId("paladin-improved-divine-smite")!.appliesTo(cls("Paladin", 11, [["Improved Divine Smite", 11]]), attackReq)).toBe(true);
    // A Champion 3 crits on 19-20, not Superior Critical's 18-20 (15th)
    const champ = cls("Fighter", 3, [["Improved Critical", 3], ["Superior Critical", 15]]);
    expect(resolveEffects(champ, rollModel, attackReq, []).find((e) => e.op === "crit-range")).toMatchObject({ range: 19 });
  });

  it("a Tasha's optional feature replaces the one it swaps out (Favored Foe for Favored Enemy)", () => {
    const ranger = { name: "R", stats: [], feats: [],
      classes: [{ level: 5, definition: { name: "Ranger" }, classFeatures: [
        { definition: { id: 294, name: "Favored Enemy", requiredLevel: 1, sources: [{ sourceId: 1 }] } },
        { definition: { id: 295, name: "Natural Explorer", requiredLevel: 1, sources: [{ sourceId: 1 }] } },
      ] }],
      optionalClassFeatures: [{ classFeatureId: 3035739, affectedClassFeatureId: 294 }, { classFeatureId: 3035679, affectedClassFeatureId: 295 }],
      actions: { class: [{ componentId: 3035739, name: "Favored Foe" }] },
    } as unknown as CharacterData;
    expect(byId("ranger-favored-foe")!.appliesTo(ranger, attackReq)).toBe(true);
    expect(byId("ranger-natural-explorer")!.appliesTo(ranger, attackReq)).toBe(false);
  });

  it("Lifedrinker: only with the invocation; 2014 +CHA, 2024 +1d6", () => {
    const warlock = (sourceId?: number) => ({ name: "W", stats: [], feats: [],
      classes: [{ level: 12, definition: { name: "Warlock" }, classFeatures: [] }],
      options: { class: sourceId ? [{ definition: { name: "Lifedrinker", sourceId } }] : [] },
    }) as unknown as CharacterData;
    const req: RollRequest = { kind: "attack", weapon: { ability: "CHA", melee: true, twoHanded: false } };
    const model = { profBonus: 4, abilities: { CHA: { mod: 4 } } } as unknown as RollModel;
    const eff = (c: CharacterData) => resolveEffects(c, model, req, ["eldritch-invocation-lifedrinker"]);
    expect(eff(warlock())).toEqual([]);
    expect(eff(warlock(1))).toEqual([{ op: "flat", target: "damage", value: 4, label: "Lifedrinker" }]);
    expect(eff(warlock(148))).toEqual([{ op: "add-dice", target: "damage", dice: "1d6", label: "Lifedrinker" }]);
  });

  it("names match whole words: Aura of Courage isn't Rage", () => {
    const pal = { name: "P", stats: [], feats: [],
      classes: [{ level: 10, definition: { name: "Paladin" }, classFeatures: [{ definition: { name: "Aura of Courage", requiredLevel: 10 } }] }],
    } as unknown as CharacterData;
    expect(byId("barbarian-rage")!.appliesTo(pal, attackReq)).toBe(false);
  });

  describe("level-scaled features", () => {
    const at = (cls: string, level: number, features: string[] = [], extra: Record<string, unknown> = {}) => ({ name: "C", stats: [], feats: [],
      classes: [{ level, definition: { name: cls }, classFeatures: features.map((name) => ({ definition: { name, requiredLevel: 1, sources: [{ sourceId: 1 }] } })) }],
      ...extra,
    }) as unknown as CharacterData;
    const strMelee: RollRequest = { kind: "attack", baseDamage: "1d12 + 3", weapon: { ability: "STR", melee: true, twoHanded: true } };
    const eff = (c: CharacterData, id: string, req: RollRequest = strMelee) => resolveEffects(c, rollModel, req, [id]);

    it("Rage: +2/+3/+4 by Barbarian level, only on attacks using Strength", () => {
      expect(eff(at("Barbarian", 8, ["Rage"]), "barbarian-rage")).toEqual([{ op: "flat", target: "damage", value: 2, label: "Rage" }]);
      expect(eff(at("Barbarian", 9, ["Rage"]), "barbarian-rage")[0]).toMatchObject({ value: 3 });
      expect(eff(at("Barbarian", 16, ["Rage"]), "barbarian-rage")[0]).toMatchObject({ value: 4 });
      expect(eff(at("Barbarian", 9, ["Rage"]), "barbarian-rage", { kind: "attack", weapon: { ability: "DEX", melee: false, twoHanded: false } })).toEqual([]);
      expect(eff(at("Barbarian", 9, ["Rage"]), "barbarian-rage", { kind: "attack" })).toEqual([]); // a spell
    });

    it("Divine Strike, Giant's Might, Brutal Strike, Favored Foe grow with level", () => {
      const dice = (c: CharacterData, id: string) => eff(c, id).map((e: any) => e.dice).join(",");
      expect(dice(at("Cleric", 13), "cleric-divine-strike")).toBe("1d8");
      expect(dice(at("Cleric", 14), "cleric-divine-strike")).toBe("2d8");
      expect(dice(at("Fighter", 10), "fighter-giant-might")).toBe("1d8");
      expect(dice(at("Fighter", 18), "fighter-giant-might")).toBe("1d10");
      expect(dice(at("Barbarian", 17), "brutal-strike")).toBe("2d10");
      expect(dice(at("Ranger", 6), "ranger-favored-foe")).toBe("1d6");
    });

    it("Divine Fury: 1d6 + half the Barbarian level", () => {
      expect(eff(at("Barbarian", 11), "barbarian-divine-fury").map((e: any) => e.dice ?? e.value)).toEqual(["1d6", 5]);
    });

    it("Charger: 2014 +5, 2024 +1d8", () => {
      const charger = (sourceId: number) => ({ name: "C", stats: [], classes: [], feats: [{ definition: { name: "Charger", sourceId } }] }) as unknown as CharacterData;
      expect(eff(charger(1), "charger-feat")).toEqual([{ op: "flat", target: "damage", value: 5, label: "Charger" }]);
      expect(eff(charger(145), "charger-feat")).toEqual([{ op: "add-dice", target: "damage", dice: "1d8", label: "Charger" }]);
    });

    it("Brutal Critical: extra weapon dice on a melee crit only, automatically", () => {
      const barb = (level: number) => at("Barbarian", level, ["Brutal Critical"]);
      const crit = { ...strMelee, crit: true };
      const brutal = (c: CharacterData, r: RollRequest) => resolveEffects(c, rollModel, r, []).filter((e) => e.label === "Brutal Critical");
      expect(brutal(barb(9), crit)).toEqual([{ op: "add-dice", target: "damage", dice: "1d12", critOnly: true, label: "Brutal Critical" }]);
      expect(brutal(barb(17), crit)[0]).toMatchObject({ dice: "3d12" });
      expect(brutal(barb(17), strMelee)).toEqual([]); // not a crit
      // a Half-Orc's Savage Attacks adds one more
      const halfOrc = at("Barbarian", 13, ["Brutal Critical"], { race: { racialTraits: [{ definition: { name: "Savage Attacks" } }] } });
      expect(brutal(halfOrc, crit)[0]).toMatchObject({ dice: "3d12" });
    });
  });

  it("Dread Ambusher adds 1d8 (2014) or 2d6 (2024 Dreadful Strike)", () => {
    const ranger = (sourceId: number) => ({ name: "R", stats: [], feats: [],
      classes: [{ definition: { name: "Ranger" }, classFeatures: [{ definition: { name: "Dread Ambusher", sources: [{ sourceId }] } }] }],
    }) as unknown as CharacterData;
    const dice = (c: CharacterData) => resolveEffects(c, rollModel, attackReq, ["ranger-dread-ambusher"]).find((e) => e.label === "Dread Ambusher");
    expect(dice(ranger(27))).toMatchObject({ op: "add-dice", dice: "1d8" });
    expect(dice(ranger(145))).toMatchObject({ op: "add-dice", dice: "2d6" });
  });

  it("2014 and 2024 versions of a feat each get only their own Roll Options", () => {
    const feat = (name: string, sourceId: number) =>
      ({ name: "F", stats: [], classes: [], feats: [{ definition: { name, sourceId } }] }) as unknown as CharacterData;
    const offered = (c: CharacterData) => RULES.filter((r) => r.toggle && r.appliesTo(c, attackReq)).map((r) => r.id);
    // Great Weapon Master: 2014 → -5/+10, 2024 → +Proficiency Bonus damage
    expect(offered(feat("Great Weapon Master", 1))).toContain("great-weapon-master");
    expect(offered(feat("Great Weapon Master", 1))).not.toContain("great-weapon-master-2024");
    expect(offered(feat("Great Weapon Master", 145))).toContain("great-weapon-master-2024");
    expect(offered(feat("Great Weapon Master", 145))).not.toContain("great-weapon-master");
    // Sharpshooter 2024 has no -5/+10
    expect(offered(feat("Sharpshooter", 1))).toContain("sharpshooter");
    expect(offered(feat("Sharpshooter", 145))).not.toContain("sharpshooter");
  });

  it("Superior Critical -> 18-20 crit range; Improved Critical -> 19-20 (Bug 7)", () => {
    const ic = byId("improved-critical")!;
    const withFeature = (name: string): CharacterData =>
      ({
        name: "C",
        stats: [],
        feats: [],
        classes: [{ definition: { name: "Fighter" }, classFeatures: [{ definition: { name } }] }],
      }) as unknown as CharacterData;

    const improved = ic.toEffects(withFeature("Improved Critical"), rollModel, attackReq);
    expect(has(improved, (e) => e.op === "crit-range" && e.range === 19)).toBe(true);

    const superior = ic.toEffects(withFeature("Superior Critical"), rollModel, attackReq);
    expect(has(superior, (e) => e.op === "crit-range" && e.range === 18)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// appliesTo / listAvailableToggles against the real Aldric fixture
// ---------------------------------------------------------------------------

describe("Aldric fixture", () => {
  const data = (aldricFixture as { data: CharacterData }).data;

  it("listAvailableToggles runs without throwing and returns toggle rules", () => {
    const req: RollRequest = { kind: "attack" };
    const toggles = listAvailableToggles(data, rollModel, req);
    expect(Array.isArray(toggles)).toBe(true);
    expect(toggles.every((r) => r.toggle)).toBe(true);
  });

  it("gates a feat-specific toggle correctly (no Sharpshooter feat => not shown)", () => {
    const ss = byId("sharpshooter")!;
    expect(ss.appliesTo(data, { kind: "attack" })).toBe(false);
  });

  it("resolveEffects runs without throwing on the fixture", () => {
    const effects = resolveEffects(data, rollModel, { kind: "attack" }, []);
    expect(Array.isArray(effects)).toBe(true);
  });
});
