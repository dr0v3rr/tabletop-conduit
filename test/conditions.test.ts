import { describe, it, expect } from "vitest";
import { computeConditions, CONDITION_BY_ID, exhaustionEffects, exhaustionSpeed } from "../src/engine/conditions";
import { buildRoll20Command } from "../src/compose/compose";
import { computeRollModel } from "../src/engine";
import fx from "./fixtures/aldric-160931906.json";

describe("conditions", () => {
  const data: any = (fx as any).data;

  it("reads active conditions from data.conditions with correct names", () => {
    const active = computeConditions({ ...data, conditions: [{ id: 11, level: null }, { id: 5, level: null }] });
    expect(active.map((c) => c.slug).sort()).toEqual(["frightened", "poisoned"]);
    expect(CONDITION_BY_ID.get(11)?.name).toBe("Poisoned");
  });

  it("ignores unknown condition ids", () => {
    expect(computeConditions({ ...data, conditions: [{ id: 999, level: null }] })).toHaveLength(0);
  });

  it("Poisoned applies disadvantage to an attack via the condition rule", () => {
    const model = computeRollModel(data);
    const normal = buildRoll20Command(model, { kind: "attack", key: "Fire Bolt", baseAttackMod: 11, baseDamage: "3d10" });
    const poisoned = buildRoll20Command(model, { kind: "attack", key: "Fire Bolt", baseAttackMod: 11, baseDamage: "3d10", effects: [{ op: "advantage", target: "attack", mode: "disadvantage", label: "Poisoned" }] });
    expect(normal).toContain("{{normal=1}}");
    expect(poisoned).toContain("{{disadvantage=1}}");
  });
});

describe("exhaustion levels", () => {
  it("2024: -2 per level to every d20 Test", () => {
    expect(exhaustionEffects(0, "2024")).toEqual([]);
    expect(exhaustionEffects(1, "2024")).toEqual([{ op: "flat", target: "d20", value: -2, label: "Exhaustion 1" }]);
    expect(exhaustionEffects(3, "2024")[0]).toMatchObject({ target: "d20", value: -6 });
    expect(exhaustionEffects(9, "2024")[0]).toMatchObject({ value: -12 }); // capped at level 6
  });
  it("2014: disadvantage on checks, then attacks and saves from level 3", () => {
    expect(exhaustionEffects(2, "2014").map((e: any) => e.target)).toEqual(["check"]);
    expect(exhaustionEffects(3, "2014").map((e: any) => e.target).sort()).toEqual(["attack", "check", "save"]);
    expect(exhaustionEffects(3, "2014").every((e: any) => e.mode === "disadvantage")).toBe(true);
  });
  it("speed: -5 ft per level (2024); halved at 2 and 0 at 5 (2014)", () => {
    expect(exhaustionSpeed(30, 2, "2024")).toBe(20);
    expect(exhaustionSpeed(30, 6, "2024")).toBe(0);
    expect(exhaustionSpeed(30, 1, "2014")).toBe(30);
    expect(exhaustionSpeed(30, 2, "2014")).toBe(15);
    expect(exhaustionSpeed(30, 5, "2014")).toBe(0);
  });
  it("the 2024 penalty lands on the d20 roll, scaled by level", () => {
    const model = computeRollModel(data0());
    const cmd = buildRoll20Command(model, { kind: "save", key: "DEX", effects: exhaustionEffects(2, "2024") });
    const base = buildRoll20Command(model, { kind: "save", key: "DEX" });
    const mod = (c: string) => Number(/\{\{mod=([+-]?\d+)\}\}/.exec(c)![1]);
    expect(mod(cmd)).toBe(mod(base) - 4);
  });
});
function data0(): any { return (fx as any).data; }
