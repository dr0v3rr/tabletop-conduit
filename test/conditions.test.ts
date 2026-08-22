import { describe, it, expect } from "vitest";
import { computeConditions, CONDITION_BY_ID } from "../src/engine/conditions";
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
