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
  it("contains the 83 catalog entries + 2 feat additions + 6 condition rules", () => {
    const nonCondition = RULES.filter((r) => !/^condition-/.test(r.id));
    expect(nonCondition.length).toBe(85); // 83 catalog + Elven Accuracy + Savage Attacker
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
    const effects = gwf.toEffects(emptyChar, rollModel, { kind: "damage" });
    expect(
      has(effects, (e) => e.op === "reroll" && e.threshold === 2),
    ).toBe(true);
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

  it("Exhaustion (2024) targets ALL d20 rolls (Bug 5)", () => {
    const ex = byId("effects-exhaustion-2024")!;
    const effects = ex.toEffects(emptyChar, rollModel, attackReq);
    expect(has(effects, (e) => e.op === "flat" && e.target === "d20")).toBe(true);
  });

  it("a character with Great Weapon Fighting gets exactly ONE GWF effect: reroll 2, no min-die (Bug 6)", () => {
    const char = {
      name: "GWF",
      stats: [],
      feats: [],
      classes: [
        {
          definition: { name: "Fighter" },
          classFeatures: [{ definition: { name: "Great Weapon Fighting" } }],
        },
      ],
    } as unknown as CharacterData;
    const effects = resolveEffects(char, rollModel, { kind: "damage" }, []);
    const gwf = effects.filter((e) => e.label === "Great Weapon Fighting");
    expect(gwf).toHaveLength(1);
    expect(gwf[0]!.op).toBe("reroll");
    expect(has(effects, (e) => e.op === "min-die")).toBe(false);
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
