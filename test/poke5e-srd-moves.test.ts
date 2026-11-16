import { describe, it, expect, vi, afterEach } from "vitest";
import { moveStat, movesMap, srdMoveToLegacy, resetMovesCacheForTests, isKnownDiceClass } from "../src/poke5e/pokemon";
import { composeRoll } from "../src/compose/compose";
import type { RollModel } from "../src/engine/types";

afterEach(() => { vi.unstubAllGlobals(); resetMovesCacheForTests(); });

// SRD entries in the shape poke5e serves at /srd/v1/<edition>/moves.json.
const BUG_BUZZ = {
  id: "bug-buzz", name: "Bug Buzz", type: "bug", power: ["dex", "cha"], time: { unit: "action" }, pp: 3,
  range: { type: "self" }, shape: { type: "emanation", value: 20, unit: "feet" },
  dice: { class: "90", modifier: "MOVE", type: "damage" }, save: { attribute: "con" },
  description: "Creatures within your {shape} must make a {save}, taking {dice} {type} damage on a fail.",
};
const AURA_WHEEL = {
  id: "aura-wheel", name: "Aura Wheel", type: "electric", power: ["dex"], time: { unit: "action" }, pp: 10,
  dice: { class: "110", modifier: "MOVE", type: "damage" }, attack: { scope: "melee" },
  description: "Make a melee attack, doing {dice} {type} damage on a hit.",
};

describe("poke5e SRD moves → the engine's move shape", () => {
  it("expands a dice class into the four level tiers and fills the wording's placeholders", () => {
    const m = srdMoveToLegacy(BUG_BUZZ);
    expect(m.damage).toEqual({ dice: { "1": "2d8", "5": "2d10", "10": "3d10", "17": "4d12" }, modifier: "MOVE", type: ["bug"] });
    expect(m.save).toEqual({ attribute: ["con"], dc: "MOVE" });
    expect(m.description[0]).toBe("Creatures within your 20-foot emanation must make a CON save against your Move DC, taking 2d8 + MOVE bug damage on a fail.");
    expect(m.higherLevels).toBe("The damage dice roll for this move changes to 2d10 at level 5, 3d10 at level 10, and 4d12 at level 17.");
  });

  it("keeps the older file's charge/recharge timing and damage label, which the SRD doesn't carry", () => {
    const srd = { ...BUG_BUZZ, id: "solar-beam", type: "grass", time: { unit: "action" } };
    const legacy = { id: "solar-beam", time: "1 action, charge", range: "Self (80ft line)", damage: { type: ["grass"] } };
    const m = srdMoveToLegacy(srd, legacy);
    expect(m.time).toBe("1 action, charge");
    expect(m.range).toBe("Self (80ft line)");
    const powder = srdMoveToLegacy({ ...AURA_WHEEL, id: "powder", type: "bug" }, { damage: { type: "typeless" } });
    expect(powder.damage.type).toBe("typeless");
  });

  it("maps healing and damage-reduction dice, custom tiers, tables and no-power moves", () => {
    expect(srdMoveToLegacy({ id: "milk-drink", type: "normal", power: ["con"], time: { unit: "action" }, dice: { class: "custom", tiers: ["2d6", "3d6", "5d6", "8d6"], modifier: "MOVE", type: "healing" }, description: "" }).damage)
      .toEqual({ dice: { "1": "2d6", "5": "3d6", "10": "5d6", "17": "8d6" }, modifier: "MOVE", type: "healing" });
    expect(srdMoveToLegacy({ id: "harden", type: "normal", power: ["con"], time: { unit: "bonus action" }, dice: { class: "10", modifier: "MOVE", type: "reduction" }, description: "" }).damage.type).toBe("reduction");
    const acu = srdMoveToLegacy({ id: "acupressure", type: "normal", power: [], time: { unit: "action" }, description: "Roll a d6.", table: { type: "table", rows: [["1", "+1 to attack rolls"]] } }, { power: "none" });
    expect(acu.power).toBe("none");
    expect(acu.description[1]).toMatchObject({ rows: [["1", "+1 to attack rolls"]] });
    expect(isKnownDiceClass("90")).toBe(true);
    expect(isKnownDiceClass("999")).toBe(false);
  });

  it("reads poke5e's SRD moves (the sheet's dice), falling back to the older file when the SRD is down", async () => {
    const legacy = { moves: [{ id: "aura-wheel", name: "Aura Wheel", type: "electric", power: ["dex"], attack: { scope: "melee" }, damage: { dice: { "1": "1d8", "5": "2d6", "10": "2d12", "17": "4d8" }, modifier: "MOVE", type: ["electric"] } }] };
    const stub = (srdUp: boolean) => vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const body = String(u).includes("/srd/v1/2018/moves.json") ? (srdUp ? { values: [AURA_WHEEL] } : null) : legacy;
      return body ? ({ ok: true, json: async () => body } as any) : ({ ok: false, status: 503, json: async () => ({}) } as any);
    }));
    stub(false);
    expect((await movesMap("2018"))["aura-wheel"].damage.dice["1"]).toBe("1d8"); // stale fallback …
    stub(true);
    expect((await movesMap("2018"))["aura-wheel"].damage.dice["1"]).toBe("3d6"); // … not cached, so the SRD wins next time
  });
});

describe("poke5e combat rules (poke5e.app/rules/combat)", () => {
  // The rules page's worked example: a level 14 Vivillon (Bug/Flying, DEX 17, CHA 10) uses Bug Buzz.
  const vivillon = { level: 14, strength: 10, dexterity: 17, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10, type: ["bug", "flying"] };
  const bugBuzz = srdMoveToLegacy(BUG_BUZZ);

  it("save DC = 8 + move power mod + proficiency (16), damage = level-14 dice + DEX mod + STAB", () => {
    const s18 = moveStat(bugBuzz, vivillon, undefined, "2018");
    expect(s18.saveDc).toBe(16);
    expect(s18.damageDice).toBe("3d10 + 6"); // 3 DEX + 3 STAB (2018: STAB from the levelling table)
    const s24 = moveStat(bugBuzz, vivillon, undefined, "2024");
    expect(s24.damageDice).toBe("3d10 + 8"); // 3 DEX + 5 STAB (2024: STAB = proficiency bonus)
  });

  it("STAB only when the move's type matches; never on healing or damage reduction; never negative", () => {
    expect(moveStat(srdMoveToLegacy(AURA_WHEEL), vivillon, undefined, "2024").damageDice).toBe("6d6 + 3"); // level-10 tier, electric: no STAB
    const custom = { stab_base: "movepower", stab_bonus: -9 };
    expect(moveStat(bugBuzz, { ...vivillon, ...custom }, undefined, "2024").damageDice).toBe("3d10 + 3"); // STAB floors at 0
    const harden = srdMoveToLegacy({ id: "harden", name: "Harden", type: "bug", power: ["con"], time: { unit: "bonus action" }, dice: { class: "10", modifier: "MOVE", type: "reduction" }, description: "Reduce damage by {dice}." });
    const h = moveStat(harden, vivillon, undefined, "2024");
    expect(h.reductionDice).toBe("1d8 + 1"); // CON 12 → +1, no STAB on a reduction
    expect(h.damageDice).toBeFalsy();
  });

  it("applies poke5e's per-move customization: bonuses, another type, other move powers", () => {
    const learned = { to_hit_modifier: 2, damage_modifier: 1, save_dc_modifier: 1, custom_type: "electric", custom_powers: ["cha"] };
    const atk = moveStat(srdMoveToLegacy(AURA_WHEEL), vivillon, learned, "2024");
    expect(atk.attackBonus).toBe(5 + 0 + 2); // prof 5 + CHA 0 (custom power) + 2
    expect(atk.damageDice).toBe("6d6 + 1"); // CHA 0 + custom 1, electric still off-type
    expect(atk.customized).toEqual(expect.arrayContaining(["+2 to hit", "+1 damage", "electric type", "CHA power"]));
    const save = moveStat(bugBuzz, vivillon, { save_dc_modifier: 2, custom_type: "fire" }, "2024");
    expect(save.saveDc).toBe(18);
    expect(save.damageDice).toBe("3d10 + 3"); // now a fire move → no STAB for a Bug/Flying Pokémon
  });

  it("reads a move's crit range from its wording", () => {
    const slash = { id: "slash", name: "Slash", type: "normal", power: ["str"], attack: { scope: "melee" }, damage: { dice: { "1": "1d12" }, modifier: "MOVE", type: ["normal"] }, description: ["Make a melee attack, doing 1d12 + MOVE normal damage on a hit. Slash results in a critical hit on 19s and 20s."] };
    expect(moveStat(slash, vivillon).critRange).toBe(19);
    const frost = { ...slash, id: "frost-breath", description: ["This move scores a critical hit on natural attack rolls of 16 and higher."] };
    expect(moveStat(frost, vivillon).critRange).toBe(16);
    const cross = { ...slash, id: "cross-poison", description: ["On a natural attack roll of 19 or 20, the attack is treated as a critical hit and the target is poisoned."] };
    expect(moveStat(cross, vivillon).critRange).toBe(19);
    const arrows = { ...slash, id: "triple-arrows", description: ["Make three ranged attacks. The first attack critical hits on nat 19s and 20s."] };
    expect(moveStat(arrows, vivillon).critRange).toBeUndefined(); // only the first arrow
  });
});

describe("moves that roll what their wording says", () => {
  const mon = { level: 10, strength: 14, dexterity: 14, constitution: 14, intelligence: 14, wisdom: 14, charisma: 14, type: ["normal"] };
  const atk = (id: string, extra: any = {}) => ({ id, name: id, type: "ground", power: ["str"], attack: { scope: "melee" }, damage: { dice: { "1": "2d8" }, modifier: "MOVE", type: ["ground"] }, description: [""], ...extra });

  it("two-turn strikes are rolled with advantage; retaliations with disadvantage", () => {
    expect(moveStat(atk("dig"), mon).advantage).toBe("advantage");
    expect(moveStat(atk("fly"), mon).advantage).toBe("advantage");
    expect(moveStat(atk("revenge", { damage: undefined }), mon).advantage).toBe("disadvantage");
    expect(moveStat(atk("tackle"), mon).advantage).toBeUndefined();
  });

  it("Electrify and Spore force a CON save instead of an attack roll", () => {
    const e = moveStat({ id: "electrify", name: "Electrify", type: "electric", power: ["dex"], attack: { scope: "melee" }, description: [""] }, mon);
    expect(e.casting).toBe("save");
    expect(e.saveAbility).toBe("CON");
  });

  it("rolls a move's own dice: Sing's hit-point pool by level, Spite's PP drain, Hidden Power's type", () => {
    const sing = { id: "sing", name: "Sing", type: "normal", power: "none", description: ["Roll 5d8."] };
    expect(moveStat(sing, { ...mon, level: 1 }).rollDie).toBe("5d8");
    expect(moveStat(sing, mon).rollDie).toBe("6d12");
    expect(moveStat(sing, mon).rollLabel).toMatch(/sleep/);
    const hp = moveStat({ ...atk("hidden-power"), type: "normal" }, mon);
    expect(hp.extraRolls?.[0]).toMatchObject({ dice: "1d20" });
  });

  it("Scale Shot adds MOVE once; Draco Power rolls its second damage on its own line", () => {
    const ss = moveStat({ ...atk("scale-shot"), type: "dragon", damage: { dice: { "1": "1d4" }, modifier: "MOVE", type: ["dragon"] }, description: ["Make five ranged attacks against one target in range."] }, mon);
    expect(ss.attacks).toBe(5);
    expect(ss.damageDice).toBe("1d4 + 2");
    expect(ss.damageDiceNoStab).toBe("1d4");
    const dp = moveStat({ ...atk("draco-power"), type: "dragon", damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["dragon"] } }, { ...mon, type: ["dragon"] });
    expect(dp.damageDice).toBe("1d6 + 6"); // MOVE 2 + STAB 4 on the dragon half
    expect(dp.extraRolls).toEqual([{ label: expect.stringMatching(/fire, water, grass or electric/), dice: "1d6 + 2" }]);
  });
});

describe("extra roll lines on the Roll20 card", () => {
  const model = { name: "Mon", abilities: {}, skills: {}, saves: {} } as unknown as RollModel;
  it("adds each as its own line on the default card, and keeps them to plain dice", () => {
    const cmd = composeRoll(model, { kind: "attack", key: "Dire Claw", baseAttackMod: 4, baseDamage: "2d6 + 2", templateStyle: "default",
      extraRolls: [{ label: "Status d6 {{x}}", dice: "1d6" }, { label: "Bad", dice: "1d6]] {{evil=1" }] }).command;
    expect(cmd).toContain("{{Status d6 x=[[1d6]]}}");
    expect(cmd).not.toContain("evil");
    const cast = composeRoll(model, { kind: "cast", key: "Protect", verb: "Uses", templateStyle: "default", extraRolls: [{ label: "d20 later use", dice: "1d20" }] }).command;
    expect(cast).toBe("&{template:default} {{name=Uses Protect}} {{d20 later use=[[1d20]]}}");
  });
  it("a move's crit range and another crit range don't stack — the widest counts", () => {
    const r = composeRoll(model, { kind: "attack", key: "Slash", baseAttackMod: 4, baseDamage: "1d12", templateStyle: "default",
      effects: [{ op: "crit-range", target: "attack", range: 19 }, { op: "crit-range", target: "attack", range: 20 }] });
    expect(r.critRange).toBe(19);
  });
});
