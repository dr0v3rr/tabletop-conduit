import { describe, it, expect } from "vitest";
import { computeHitDice, longRestUsed, hitDieHealFormula } from "../src/engine/hit-dice";
import { computeRollModel } from "../src/engine";
import fx from "./fixtures/aldric-160931906.json";

const data: any = (fx as any).data;

describe("computeHitDice", () => {
  const hd = computeHitDice(data, computeRollModel(data));
  it("Artificer 11 → one 11d8 pool, CON mod +2", () => {
    expect(hd.pools).toEqual([{ cls: "Artificer", die: 8, total: 11, used: 0 }]);
    expect(hd.conMod).toBe(2);
  });
  it("reads the sheet's long-rest rule (Aldric: longRestType 2 → recover all, 2024)", () => {
    expect(hd.longRest).toBe("all");
    expect(computeHitDice({ ...data, preferences: { ...data.preferences, longRestType: 1 } }, computeRollModel(data)).longRest).toBe("half");
    expect(computeHitDice({ ...data, preferences: {} }, computeRollModel(data)).longRest).toBe("all"); // default: 2024
  });
  it("keeps multiclass pools per class (D&D Beyond tracks hitDiceUsed per class), even with the same die", () => {
    const multi: any = { stats: [{ id: 3, value: 14 }], classes: [
      { level: 5, hitDiceUsed: 2, definition: { name: "Fighter", hitDice: 10 } },
      { level: 3, hitDiceUsed: 1, definition: { name: "Rogue", hitDice: 8 } },
      { level: 2, hitDiceUsed: 0, definition: { name: "Ranger", hitDice: 10 } },
    ] };
    const r = computeHitDice(multi, computeRollModel({ ...data, ...multi }));
    expect(r.pools).toEqual([
      { cls: "Fighter", die: 10, total: 5, used: 2 },
      { cls: "Rogue", die: 8, total: 3, used: 1 },
      { cls: "Ranger", die: 10, total: 2, used: 0 },
    ]);
  });
  it("doubles hit-die healing only while a Periapt of Wound Closure is attuned", () => {
    const periapt = (isAttuned: boolean) => ({ ...data, inventory: [{ isAttuned, definition: { name: "Periapt of Wound Closure" } }] });
    expect(computeHitDice(periapt(true), computeRollModel(data)).healMultiplier).toBe(2);
    expect(computeHitDice(periapt(false), computeRollModel(data)).healMultiplier).toBe(1);
  });
});

describe("longRestUsed", () => {
  const pools = [
    { cls: "Sorcerer", die: 6, total: 17, used: 12 },
    { cls: "Warlock", die: 8, total: 3, used: 3 },
  ];
  it("2024 rules: every spent die comes back", () => {
    expect(longRestUsed(pools, "all")).toEqual([0, 0]);
  });
  it("2014 rules: half the character's TOTAL dice (20 → 10), largest dice first", () => {
    // 10 back: all 3 d8 (Warlock), then 7 of the 12 spent d6 → Sorcerer still has 5 spent
    expect(longRestUsed(pools, "half")).toEqual([5, 0]);
  });
  it("2014 rules: at least one die back for a level-1 character", () => {
    expect(longRestUsed([{ cls: "Wizard", die: 6, total: 1, used: 1 }], "half")).toEqual([0]);
  });
});

describe("hitDieHealFormula", () => {
  it("adds CON (positive, negative or zero) and doubles for the Periapt", () => {
    expect(hitDieHealFormula(6, 3)).toBe("1d6 + 3");
    expect(hitDieHealFormula(8, -1)).toBe("1d8 - 1");
    expect(hitDieHealFormula(10, 0)).toBe("1d10");
    expect(hitDieHealFormula(6, 3, 2)).toBe("(1d6 + 3) * 2");
  });
});
