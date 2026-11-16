import { describe, it, expect } from "vitest";
import { moveStat } from "../src/poke5e/pokemon";
import { MOVE_FIXES, patchMoveData } from "../src/poke5e/move-mechanics";
import { expandAttacks } from "../src/compose";
import type { RollRequest } from "../src/shared/roll-types";

const mon = (type = "normal") => ({
  level: 10, type: [type],
  strength: 14, dexterity: 14, constitution: 12, intelligence: 12, wisdom: 12, charisma: 12,
});

describe("move-mechanics overlay", () => {
  it("heal patch: Milk Drink renders as a heal at its level's dice (5d6 + MOVE at level 10), not a bare cast", () => {
    const s = moveStat({ id: "milk-drink", name: "Milk Drink", type: "normal" }, mon());
    expect(s.casting).toBe("utility");
    expect(s.healDice).toMatch(/^5d6/);
    expect(moveStat({ id: "milk-drink", name: "Milk Drink", type: "normal" }, { ...mon(), level: 1 }).healDice).toMatch(/^2d6/);
    expect(s.damageDice).toBeFalsy();
    expect(s.mechanicNote).toMatch(/Heals/);
  });

  it("level damage: Seismic Toss is its level's dice + the Pokémon's level, with NO STAB (on-type user)", () => {
    const st = { id: "seismic-toss", name: "Seismic Toss", type: "fighting", attack: { scope: "melee" },
      damage: { dice: { "1": "1d6", "5": "2d4", "10": "1d12", "17": "4d4" }, modifier: "LEVEL", type: ["fighting"] } };
    expect(moveStat(st, mon("fighting")).damageDice).toBe("1d12 + 10"); // level 10, no STAB
    expect(moveStat(st, { ...mon("fighting"), level: 3 }).damageDice).toBe("1d6 + 3");
  });

  it("fixed damage: Sonic Boom is a flat 16, no STAB (on-type user)", () => {
    const s = moveStat({ id: "sonic-boom", name: "Sonic Boom", type: "normal", save: { attribute: ["con"] } }, mon("normal"));
    expect(s.damageDice).toBe("16");
  });

  it("re-render: Baneful Bunker drops its bogus to-hit and damage", () => {
    const s = moveStat({ id: "baneful-bunker", name: "Baneful Bunker", type: "poison", attack: { scope: "melee" }, damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["poison"] } }, mon("poison"));
    expect(s.casting).toBe("utility");
    expect(s.damageDice).toBeFalsy();
    expect(s.attackBonus).toBeUndefined();
    expect(s.mechanicNote).toBeTruthy();
  });

  it("autoHit multi-hit: Swift gets the fixed hit count on top of its guaranteed-hit damage", () => {
    // Swift is already an autoHit damage move in the real data (no attack/save); the overlay only adds N.
    const s = moveStat({ id: "swift", name: "Swift", type: "normal", damage: { dice: { "1": "1d4" }, modifier: "MOVE", type: ["normal"] } }, mon());
    expect(s.attacks).toBe(5); // level 10 → 5 projectiles (2 / 4 at 5 / 5 at 10 / 6 at 17)
    expect(moveStat({ id: "swift", name: "Swift", type: "normal", damage: { dice: { "1": "1d4" }, modifier: "MOVE", type: ["normal"] } }, { ...mon(), level: 4 }).attacks).toBe(2);
    expect(s.autoHit).toBe(true);
    expect(s.damageDice).toMatch(/^1d4/);
    expect(s.mechanicNote).toMatch(/6 at level 17/);
  });

  it("note-only move keeps its normal roll but carries a mechanic note", () => {
    const s = moveStat({ id: "fury-attack", name: "Fury Attack", type: "normal", attack: { scope: "melee" }, damage: { dice: { "1": "1d4" }, modifier: "MOVE", type: ["normal"] } }, mon());
    expect(s.casting).toBe("attack");
    expect(s.damageDice).toMatch(/^1d4/);
    expect(s.mechanicNote).toMatch(/d4/);
  });

  it("overlay multi-hit carries STAB-once-per-target (Population Bomb on-type)", () => {
    // 10 hits at 1 + MOVE against ONE target → STAB applies once (first hit), stripped from the rest.
    const s = moveStat({ id: "population-bomb", name: "Population Bomb", type: "normal", power: ["str"], attack: { scope: "melee" } }, mon("normal"));
    expect(s.attacks).toBe(10);
    expect(s.damageDice).toContain(" + "); // includes MOVE + STAB
    expect(s.damageDiceNoStab).toBeTruthy();
    expect(s.damageDiceNoStab).not.toBe(s.damageDice); // repeat hits drop STAB
  });

  it("patchMoveData leaves un-listed moves untouched", () => {
    const move = { id: "tackle", name: "Tackle", type: "normal", attack: { scope: "melee" }, damage: { dice: { "1": "1d6" }, modifier: "MOVE", type: ["normal"] } };
    expect(patchMoveData(move)).toBe(move);
  });

  it("expandAttacks fans a guaranteed-hit (kind:'damage') multi-hit into N cards", () => {
    const req: RollRequest = { kind: "damage", key: "Swift", baseDamage: "1d4", damageType: "normal", attacks: 2 };
    const out = expandAttacks(req);
    expect(out.length).toBe(2);
    expect(out.map((r) => r.key)).toEqual(["Swift (1/2)", "Swift (2/2)"]);
  });

  it("every MOVE_FIXES entry has a non-empty note", () => {
    for (const [id, fix] of Object.entries(MOVE_FIXES)) {
      expect(fix.note, id).toBeTruthy();
    }
  });
});

describe("escalating / table damage moves roll real dice", () => {
  const R = { "1": "Rd6", "5": "Rd8", "10": "Rd10", "17": "Rd12" };
  const at = (level: number) => ({ ...mon("ground"), level });

  it("Rollout rolls its first hit as one die of the level's size (not the literal 'Rd8')", () => {
    const rollout = { id: "rollout", name: "Rollout", type: "rock", attack: { scope: "melee" }, damage: { dice: R, modifier: "MOVE", type: ["rock"] } };
    expect(moveStat(rollout, at(1)).damageDice).toMatch(/^1d6(?: \+ \d+)?$/);
    expect(moveStat(rollout, at(8)).damageDice).toMatch(/^1d8(?: \+ \d+)?$/);
    expect(moveStat(rollout, at(17)).damageDice).toMatch(/^1d12(?: \+ \d+)?$/);
    expect(moveStat(rollout, at(8)).mechanicNote).toMatch(/double the number of dice/);
  });

  it("Outrage keeps its level-scaled die (d8 at level 5), auto-hit", () => {
    const outrage = { id: "outrage", name: "Outrage", type: "dragon", damage: { dice: R, modifier: "MOVE", type: ["dragon"] } };
    const s = moveStat(outrage, { ...at(5), type: ["normal"] });
    expect(s.damageDice).toMatch(/^1d8(?: \+ \d+)?$/);
    expect(s.autoHit).toBe(true);
  });

  it("Magnitude is a DEX save that rolls its d100 (its damage table can't be one roll)", () => {
    const mag = { id: "magnitude", name: "Magnitude", type: "ground", save: { attribute: ["dex"], dc: "MOVE" },
      damage: { dice: { "1": "dice", "5": "2×dice", "10": "3×dice", "17": "4×dice" }, modifier: "MOVE", type: ["ground"] } };
    const s = moveStat(mag, at(10));
    expect(s.casting).toBe("save");
    expect(s.saveDc).toBeGreaterThan(0);
    expect(s.damageDice).toBeFalsy(); // never the bogus "3×dice + 2"
    expect(s.rollDie).toBe("1d100");
    expect(s.mechanicNote).toMatch(/1-5: 1d4/);
  });
});

