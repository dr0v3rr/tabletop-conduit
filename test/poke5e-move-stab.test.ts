import { describe, it, expect } from "vitest";
import { moveStat } from "../src/poke5e/pokemon";

// A base level-1 Ralts (Psychic/Fairy): STR 9 (−1), DEX 12 (+1), INT 10 (0), WIS 12 (+1), prof +2.
const ralts = () => ({
  level: 1, type: ["psychic", "fairy"],
  strength: 9, dexterity: 12, constitution: 10, intelligence: 10, wisdom: 12, charisma: 10,
});
const dice = { "1": "1d8", "5": "2d6", "10": "4d4", "17": "3d10" };

describe("moveStat — STAB + damage-modifier parsing", () => {
  it("adds STAB (prof) to a type-matching move whose modifier is just 'MOVE' (Confusion)", () => {
    const confusion = { name: "Confusion", type: "psychic", power: ["int", "wis"], attack: { scope: "ranged" }, damage: { dice, modifier: "MOVE", type: ["psychic"] } };
    const s = moveStat(confusion, ralts());
    expect(s.attackBonus).toBe(3);                 // +2 prof + +1 WIS
    expect(s.attackTip).toBe("+2 prof +1 WIS");
    expect(s.damageDice).toBe("1d8 + 3");          // +1 WIS + +2 STAB
    expect(s.damageTip).toBe("1d8 +1 WIS +2 STAB");
  });

  it("does NOT add STAB to an off-type move (Magical Leaf is Grass on a Psychic/Fairy Pokémon)", () => {
    const magicalLeaf = { name: "Magical Leaf", type: "grass", power: ["dex"], damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["grass"] } };
    const s = moveStat(magicalLeaf, ralts());
    expect(s.damageDice).toBe("1d6 + 1");          // just +1 DEX, no STAB
    expect(s.damageTip).toBe("1d6 +1 DEX");
    expect(s.damageTip).not.toContain("STAB");
  });

  it("keeps the flat constant in 'MOVE + N' modifiers (Surging Strikes +5, Wicked Blow +10)", () => {
    const surging = { name: "Surging Strikes", type: "water", power: ["dex"], damage: { dice: { "1": "1d6" }, modifier: "MOVE + 5", type: ["water"] } };
    expect(moveStat(surging, ralts()).damageDice).toBe("1d6 + 6"); // +1 DEX + 5 flat (no STAB, off-type)
    const wicked = { name: "Wicked Blow", type: "dark", power: ["str"], damage: { dice: { "1": "1d12" }, modifier: "MOVE + 10", type: ["dark"] } };
    expect(moveStat(wicked, ralts()).damageDice).toBe("1d12 + 9"); // −1 STR + 10 flat
  });

  it("counts STAB exactly once for an explicit 'MOVE + STAB' move (Revelation Dance)", () => {
    const reveal = { name: "Revelation Dance", type: "varies", power: ["dex", "cha"], damage: { dice: { "1": "2d8" }, modifier: "MOVE + STAB", type: ["varies"] } };
    const s = moveStat(reveal, ralts());
    expect(s.damageDice).toBe("2d8 + 3");          // +1 DEX + +2 STAB, once
    expect((s.damageTip!.match(/STAB/g) || []).length).toBe(1);
  });

  it("does not apply STAB to a healing move even when the type matches", () => {
    const heal = { name: "Life Dew", type: "psychic", power: ["wis"], damage: { dice: { "1": "1d4" }, modifier: "MOVE", type: ["healing"] } };
    const s = moveStat(heal, ralts());
    expect(s.healDice).toBe("1d4 + 1");            // +1 WIS only — no STAB on healing
    expect(s.healDice).not.toContain("3");
  });

  it("Struggle: typeless STR/DEX attack, 2 + MOVE, no STAB", () => {
    const struggle = { name: "Struggle", type: "typeless", power: ["str", "dex"], attack: { scope: "ranged" }, damage: { dice: {}, modifier: "MOVE + 2", type: ["typeless"] } };
    const s = moveStat(struggle, ralts());
    expect(s.casting).toBe("attack");
    expect(s.attackBonus).toBe(3);        // +2 prof + +1 DEX (DEX 12 beats STR 9)
    expect(s.damageDice).toBe("3");       // 2 + DEX(+1), no dice, no STAB (typeless never matches)
    expect(s.damageType).toBe("typeless");
    expect(s.damageTip).not.toContain("STAB");
  });

  it("reads action economy from the move's `time` field", () => {
    const mk = (time: string) => ({ name: "X", type: "normal", power: ["dex"], time, attack: { scope: "melee" }, damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["normal"] } });
    expect(moveStat(mk("1 bonus action"), ralts()).castingTime).toBe("bonus");
    expect(moveStat(mk("1 reaction"), ralts()).castingTime).toBe("reaction");
    expect(moveStat(mk("1 action"), ralts()).castingTime).toBe("action");
    expect(moveStat(mk(""), ralts()).castingTime).toBe("action"); // default
    const recharge = moveStat(mk("1 action, recharge"), ralts());
    expect(recharge.castingTime).toBe("action");
    expect(recharge.note).toMatch(/recharge/);
  });

  it("builds a save-DC breakdown tooltip", () => {
    const move = { name: "Hypnosis", type: "psychic", power: ["wis"], save: { attribute: ["wis"] } };
    const s = moveStat(move, ralts());
    expect(s.saveDc).toBe(11);                     // 8 + 2 prof + 1 WIS
    expect(s.saveTip).toBe("8 base +2 prof +1 WIS");
  });
});
