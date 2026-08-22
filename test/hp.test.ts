import { describe, it, expect } from "vitest";
import { computeHp } from "../src/engine/hp";
import { computeRollModel } from "../src/engine";
import fx from "./fixtures/aldric-160931906.json";

describe("computeHp", () => {
  const data: any = (fx as any).data;
  const model = computeRollModel(data);

  it("uses overrideHitPoints as max and derives current from removed", () => {
    const hp = computeHp({ ...data, overrideHitPoints: 71, removedHitPoints: 0, temporaryHitPoints: 0 }, model);
    expect(hp.max).toBe(71);
    expect(hp.current).toBe(71);
    expect(hp.temp).toBe(0);
  });

  it("subtracts damage taken and surfaces temp", () => {
    const hp = computeHp({ ...data, overrideHitPoints: 71, removedHitPoints: 20, temporaryHitPoints: 8 }, model);
    expect(hp.current).toBe(51);
    expect(hp.temp).toBe(8);
    expect(hp.removed).toBe(20);
  });

  it("computes max from base + CON×level + bonus when there is no override", () => {
    const con = model.abilities.CON.mod;
    const hp = computeHp(
      { ...data, overrideHitPoints: null, baseHitPoints: 60, bonusHitPoints: 5, removedHitPoints: 0, temporaryHitPoints: 0 },
      model,
    );
    expect(hp.max).toBe(60 + con * model.level + 5);
  });
});
