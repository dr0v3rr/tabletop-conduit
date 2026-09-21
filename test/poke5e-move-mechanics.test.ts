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
  it("heal patch: Milk Drink renders as a heal (2d6 + MOVE), not a bare cast", () => {
    const s = moveStat({ id: "milk-drink", name: "Milk Drink", type: "normal" }, mon());
    expect(s.casting).toBe("utility");
    expect(s.healDice).toMatch(/^2d6/);
    expect(s.damageDice).toBeFalsy();
    expect(s.mechanicNote).toMatch(/Heals/);
  });

  it("fixed damage: Seismic Toss is a flat 1d6 + trainer level with NO STAB (on-type user)", () => {
    const s = moveStat({ id: "seismic-toss", name: "Seismic Toss", type: "fighting", attack: { scope: "melee" } }, mon("fighting"));
    expect(s.damageDice).toBe("1d6 + 10"); // level 10, no dice scaling, no STAB
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
    expect(s.attacks).toBe(2);
    expect(s.autoHit).toBe(true);
    expect(s.damageDice).toMatch(/^1d4/);
    expect(s.mechanicNote).toMatch(/two/i);
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
