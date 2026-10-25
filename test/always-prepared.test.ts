import { describe, it, expect } from "vitest";
import { alwaysPreparedRequests, alwaysPreparedUrl, mergeAlwaysPrepared } from "../src/ddb/always-prepared";

// A Paladin 6 (Oath of Vengeance): D&D Beyond serves the Oath spells from a separate endpoint, per
// class and subclass — they are not in the character JSON.
const paladin = {
  classes: [{ id: 501, level: 6, definition: { id: 4, name: "Paladin" }, subclassDefinition: { id: 42, name: "Oath of Vengeance" } }],
  classSpells: [{ characterClassId: 501, spells: [{ definition: { name: "Shield of Faith", level: 1 }, prepared: true }] }],
};
const oath = [
  { definition: { name: "Bane", level: 1 } },
  { definition: { name: "Hunter's Mark", level: 1 } },
  { definition: { name: "Shield of Faith", level: 1 } }, // already listed → not duplicated
];

describe("always-prepared spells", () => {
  it("looks up each class and subclass at the class's level", () => {
    expect(alwaysPreparedRequests(paladin)).toEqual([
      { classEntryId: 501, defId: 4, level: 6 },
      { classEntryId: 501, defId: 42, level: 6 },
    ]);
    expect(alwaysPreparedUrl(42, 6)).toContain("always-prepared-spells?classId=42&classLevel=6");
  });

  it("adds them to the class's spells, marked always prepared, without duplicates or mutation", () => {
    const merged = mergeAlwaysPrepared(paladin, new Map([[501, oath]]));
    const names = merged.classSpells[0]!.spells.map((s: any) => s.definition.name);
    expect(names).toEqual(["Shield of Faith", "Bane", "Hunter's Mark"]);
    expect(merged.classSpells[0]!.spells[1]).toMatchObject({ alwaysPrepared: true });
    expect(paladin.classSpells[0]!.spells).toHaveLength(1);
  });

  it("creates the class's group when it has no other spells", () => {
    const merged = mergeAlwaysPrepared({ ...paladin, classSpells: [] }, new Map([[501, oath.slice(0, 1)]]));
    expect(merged.classSpells).toEqual([{ characterClassId: 501, spells: [{ definition: { name: "Bane", level: 1 }, alwaysPrepared: true }] }]);
  });
});
