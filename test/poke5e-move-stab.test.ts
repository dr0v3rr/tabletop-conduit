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

describe("moveStat — FIXED multi-attack count parsed from prose", () => {
  const atk = (name: string, description: string) =>
    ({ name, type: "water", power: ["dex"], attack: { scope: "ranged" }, damage: { dice: { "1": "1d4" }, modifier: 0, type: ["water"] }, description });

  it("Bubble → 3 separate attacks", () => {
    const s = moveStat(atk("Bubble", "You shoot a series of quickly moving bubbles at a target. Make three ranged attacks, doing 1d4 water damage on each successful hit."), ralts());
    expect(s.attacks).toBe(3);
    expect(s.casting).toBe("attack");
    expect(s.damageDice).toBe("1d4"); // per-attack dice unchanged (modifier 0, off-type → no STAB)
  });

  it("counts two / three / five across the fixed family", () => {
    expect(moveStat(atk("Double Kick", "You strike twice with two devastating kicks. Make two melee attack rolls, doing 1d6 fighting damage on each successful hit."), ralts()).attacks).toBe(2);
    expect(moveStat(atk("Surging Strikes", "Make three melee attacks against a single target, dealing damage on each hit."), ralts()).attacks).toBe(3);
    expect(moveStat(atk("Scale Shot", "Make five ranged attacks against one target, doing 1d4 dragon damage on each hit."), ralts()).attacks).toBe(5);
  });

  it("multi-TARGET wording does not inflate the count (Dragon Darts stays 2)", () => {
    expect(moveStat(atk("Dragon Darts", "Make two ranged attacks against up to two creatures in range, each dealing 1d8 dragon damage on hit."), ralts()).attacks).toBe(2);
  });

  it("VARIABLE 'roll a d4 to continue' moves stay single (Fury Attack)", () => {
    expect(moveStat(atk("Fury Attack", "Make a ranged attack roll, doing 1d4 damage on a hit. After successfully hitting a target, roll a d4. On a 3 or 4 you may attack again."), ralts()).attacks).toBeUndefined();
  });

  it("plain single-hit and Struggle stay single", () => {
    expect(moveStat(atk("Pound", "Make a melee attack roll, doing 1d4 normal damage on a hit."), ralts()).attacks).toBeUndefined();
    const struggle = { name: "Struggle", type: "typeless", power: ["str", "dex"], attack: { scope: "ranged" }, damage: { dice: {}, modifier: "MOVE + 2", type: ["typeless"] }, description: "Make a melee or ranged attack roll against a creature within range." };
    expect(moveStat(struggle, ralts()).attacks).toBeUndefined();
  });

  // On-type users get STAB; STAB is once per target, first instance. Since the app can't know how the
  // hits split across targets, it auto-applies STAB to the FIRST hit only for EVERY multi-attack (a
  // STAB-stripped `damageDiceNoStab` drives the 2nd+ hits); a multi-target move just prompts the player
  // to add STAB back for each additional target they hit.
  const water = () => ({ level: 1, type: ["water"], strength: 10, dexterity: 14, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 });

  it("single-target on-type Bubble: STAB on the first hit only", () => {
    const s = moveStat(atk("Bubble", "You shoot bubbles at a target. Make three ranged attacks, doing 1d4 water damage on each successful hit."), water());
    expect(s.attacks).toBe(3);
    expect(s.multiTarget).toBeFalsy();
    expect(s.damageDice).toBe("1d4 + 2");   // first hit: +2 STAB
    expect(s.damageDiceNoStab).toBe("1d4"); // 2nd/3rd hits: STAB stripped
  });

  it("drops ONLY STAB on the 2nd+ hit, keeping the per-hit ability mod (Double Kick on-type)", () => {
    const fighting = { level: 1, type: ["fighting"], strength: 14, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 };
    const dk = { name: "Double Kick", type: "fighting", power: ["str"], attack: { scope: "melee" }, damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["fighting"] }, description: "Make two melee attack rolls, doing 1d6 + MOVE fighting damage on each successful hit." };
    const s = moveStat(dk, fighting);
    expect(s.damageDice).toBe("1d6 + 4");      // +2 STR (MOVE) + 2 STAB
    expect(s.damageDiceNoStab).toBe("1d6 + 2"); // keep +2 STR, drop +2 STAB
  });

  it("multi-target on-type still auto-applies STAB to the 1st hit only (add per extra target)", () => {
    const dragon = { level: 1, type: ["dragon"], strength: 14, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 };
    const dd = { name: "Dragon Darts", type: "dragon", power: ["str", "dex"], attack: { scope: "ranged" }, damage: { dice: { "1": "1d8" }, modifier: "MOVE", type: ["dragon"] }, description: "Make two ranged attacks against up to two creatures in range, each dealing 1d8 + MOVE dragon damage on hit." };
    const s = moveStat(dd, dragon);
    expect(s.attacks).toBe(2);
    expect(s.multiTarget).toBe(true);
    expect(s.damageDice).toBe("1d8 + 4");       // 1st hit: +2 STR (MOVE) + 2 STAB
    expect(s.damageDiceNoStab).toBe("1d8 + 2"); // 2nd hit: keep +2 STR, drop STAB (player adds it per new target)
  });

  it("off-type multi-attack has no STAB and no no-STAB variant", () => {
    const s = moveStat(atk("Bubble", "You shoot bubbles at a target. Make three ranged attacks, doing 1d4 water damage on each successful hit."), ralts());
    expect(s.damageDice).toBe("1d4");
    expect(s.damageDiceNoStab).toBeUndefined();
  });
});
