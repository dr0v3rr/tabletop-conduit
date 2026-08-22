import { describe, it, expect } from "vitest";
import { computeHitDice } from "../src/engine/hit-dice";
import { computeRollModel } from "../src/engine";
import fx from "./fixtures/aldric-160931906.json";

describe("computeHitDice", () => {
  const data: any = (fx as any).data;
  const hd = computeHitDice(data, computeRollModel(data));
  it("Artificer 11 → 11d8, CON mod +2", () => {
    expect(hd.pools).toEqual([{ die: 8, total: 11, used: 0 }]);
    expect(hd.conMod).toBe(2);
  });
  it("groups multiclass hit dice by die size and sums used", () => {
    const multi: any = { stats: [{ id: 3, value: 14 }], classes: [
      { level: 5, hitDiceUsed: 2, definition: { name: "Fighter", hitDice: 10 } },
      { level: 3, hitDiceUsed: 1, definition: { name: "Rogue", hitDice: 8 } },
      { level: 2, hitDiceUsed: 0, definition: { name: "Ranger", hitDice: 10 } },
    ] };
    const m = computeRollModel({ ...data, ...multi });
    const r = computeHitDice(multi, m);
    // d10: Fighter 5 + Ranger 2 = 7 total, 2 used; d8: Rogue 3 total, 1 used; largest die first
    expect(r.pools).toEqual([{ die: 10, total: 7, used: 2 }, { die: 8, total: 3, used: 1 }]);
  });
});
