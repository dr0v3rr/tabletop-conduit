import { describe, it, expect } from "vitest";
import { ppItemSpec, restoredPp, ppItemEffect, PP_ITEMS } from "../src/poke5e/pp-items";

describe("poke5e PP-restore items", () => {
  it("maps the Ether family to the right amount + scope", () => {
    expect(ppItemSpec("ether")).toEqual({ restore: 5, scope: "one" });
    expect(ppItemSpec("max-ether")).toEqual({ restore: 10, scope: "one" });
    expect(ppItemSpec("elixir")).toEqual({ restore: 5, scope: "all" });
    expect(ppItemSpec("max-elixir")).toEqual({ restore: 10, scope: "all" });
    expect(ppItemSpec("leppa-berry")).toEqual({ restore: 10, scope: "one" });
  });

  it("returns null for non-PP items", () => {
    expect(ppItemSpec("potion")).toBeNull();
    expect(ppItemSpec("pp-up")).toBeNull(); // vitamin (raises max PP) — not a restore item
    expect(ppItemSpec(null)).toBeNull();
    expect(ppItemSpec(undefined)).toBeNull();
  });

  it("clamps restored PP to [0, max]", () => {
    expect(restoredPp(3, 5, 5)).toBe(5);   // 3 + 5 → capped at 5
    expect(restoredPp(0, 20, 10)).toBe(10);
    expect(restoredPp(15, 20, 10)).toBe(20);
    expect(restoredPp(-3, 5, 5)).toBe(5);  // negative current floored to 0 first
  });

  it("describes an item's effect for the picker", () => {
    expect(ppItemEffect(PP_ITEMS["ether"]!)).toBe("+5 PP to one move");
    expect(ppItemEffect(PP_ITEMS["max-elixir"]!)).toBe("+10 PP to all moves");
  });
});
