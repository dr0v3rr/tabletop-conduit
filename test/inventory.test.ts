import { describe, it, expect } from "vitest";
import { computeInventory } from "../src/engine/inventory";
import { itemToRequest } from "../src/pipeline";
import fx from "./fixtures/aldric-160931906.json";

describe("computeInventory", () => {
  const data: any = (fx as any).data;
  const inv = computeInventory(data);

  it("surfaces Potion of Healing as a heal item with its dice", () => {
    const poh = inv.find((i) => i.name === "Potion of Healing");
    expect(poh).toBeTruthy();
    expect(poh!.kind).toBe("heal");
    expect(poh!.dice).toBe("2d4 + 2");
    expect(poh!.consumable).toBe(true);
  });

  it("stacks the three identical Potions of Healing into one line, quantity 3", () => {
    const potions = inv.filter((i) => i.name === "Potion of Healing");
    expect(potions).toHaveLength(1);
    expect(potions[0]!.quantity).toBe(3);
  });

  it("carries the underlying DDB inventory row ids for quantity write-back", () => {
    const poh = inv.find((i) => i.name === "Potion of Healing")!;
    // three separate rows, each qty 1, each with a numeric DDB id
    expect(poh.entries).toHaveLength(3);
    expect(poh.entries.every((e) => typeof e.id === "number" && e.quantity === 1)).toBe(true);
    expect(poh.entries.reduce((a, e) => a + e.quantity, 0)).toBe(poh.quantity);
  });

  it("keeps magic equipment (utility) but drops mundane gear", () => {
    expect(inv.some((i) => i.name === "Bag of Holding" && i.kind === "utility")).toBe(true);
    // rope / rations / pitons are non-magic, non-rollable → excluded
    expect(inv.some((i) => /Rope|Rations|Piton|Torch|Waterskin/.test(i.name))).toBe(false);
  });

  it("excludes weapons (they live in the Attacks section)", () => {
    expect(inv.some((i) => /Dagger|Longsword|Quarterstaff/.test(i.name))).toBe(false);
  });

  it("keeps a non-rollable magic potion as utility (no dice)", () => {
    const fire = inv.find((i) => i.name === "Potion of Fire Resistance");
    expect(fire).toBeTruthy();
    expect(fire!.kind).toBe("utility");
    expect(fire!.dice).toBeUndefined();
  });

  it("orders rollable items ahead of utility gear", () => {
    const firstUtilityIdx = inv.findIndex((i) => i.kind === "utility");
    const lastRollableIdx = [...inv].map((i) => i.kind).lastIndexOf("heal");
    expect(lastRollableIdx).toBeLessThan(firstUtilityIdx);
  });

  it("itemToRequest builds a heal damage-roll for potions and null for utility", () => {
    const poh = inv.find((i) => i.name === "Potion of Healing")!;
    expect(itemToRequest(poh)).toEqual({ kind: "damage", key: "Potion of Healing (heal)", baseDamage: "2d4 + 2" });
    const bag = inv.find((i) => i.name === "Bag of Holding")!;
    expect(itemToRequest(bag)).toBeNull();
  });

  it("parses an offensive consumable (Alchemist's Fire) as a damage item", () => {
    const synthetic: any = {
      ...data,
      inventory: [
        {
          quantity: 2,
          displayAsAttack: true,
          definition: {
            name: "Alchemist's Fire",
            type: "Adventuring Gear",
            isConsumable: true,
            damage: { diceString: "1d4" },
            damageType: "Fire",
          },
        },
      ],
    };
    const r = computeInventory(synthetic);
    const af = r.find((i) => i.name === "Alchemist's Fire")!;
    expect(af.kind).toBe("damage");
    expect(af.dice).toBe("1d4");
    expect(af.damageType).toBe("Fire");
    expect(itemToRequest(af)).toEqual({ kind: "damage", key: "Alchemist's Fire", baseDamage: "1d4", damageType: "Fire" });
  });
});
