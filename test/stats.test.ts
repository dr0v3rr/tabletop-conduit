import { describe, it, expect } from "vitest";
import { aggregate, recordsToCSV, statsToCSV } from "../src/stats/roll-stats";
import type { RollRecord } from "../src/roll20/log";

function rec(p: Partial<RollRecord>): RollRecord {
  return { id: Math.random().toString(36), campaign: null, player: "P", isGM: false, character: null, name: "Roll", total: 10, totals: [10], damage: 0, d20: true, rawD20: null, crit: false, fumble: false, breakdown: "", ts: null, ...p };
}

describe("roll-stats aggregate", () => {
  const records: RollRecord[] = [
    rec({ player: "Alice", name: "Perception", total: 25, d20: true, crit: true }),
    rec({ player: "Alice", name: "DEX Save", total: 8, d20: true }),
    rec({ player: "Alice", name: "Fireball dmg", total: 24, d20: false }), // damage — not a d20 roll
    rec({ player: "Bob", name: "Attack", total: 3, d20: true, fumble: true }),
    rec({ player: "Bob", name: "Attack", total: 18, d20: true }),
  ];
  const stats = aggregate(records);

  it("counts rolls and d20 rolls per player", () => {
    const alice = stats.players.find((p) => p.player === "Alice")!;
    expect(alice.rolls).toBe(3);
    expect(alice.d20Rolls).toBe(2); // the Fireball damage roll is excluded
  });

  it("counts nat20 (d20) and nat1 (any '1')", () => {
    const alice = stats.players.find((p) => p.player === "Alice")!;
    const bob = stats.players.find((p) => p.player === "Bob")!;
    expect(alice.nat20).toBe(1);
    expect(alice.nat1).toBe(0);
    expect(bob.nat1).toBe(1);
    expect(bob.luck).toBe(-1);
    expect(alice.luck).toBe(1);
  });

  it("nat1 also counts a '1' on a non-d20 roll (potion/damage die)", () => {
    const rs = aggregate([
      rec({ player: "X", name: "Potion", d20: false, fumble: true }), // a d4 came up 1
      rec({ player: "X", name: "Attack", d20: true, fumble: true }), // a d20 nat 1
      rec({ player: "X", name: "Fireball dmg", d20: false, fumble: false }),
    ]);
    expect(rs.players[0]!.nat1).toBe(2); // both fumbles count, regardless of d20
  });

  it("computes avg/high/low over d20 totals", () => {
    const alice = stats.players.find((p) => p.player === "Alice")!;
    expect(alice.avgD20Total).toBe(16.5); // (25+8)/2
    expect(alice.highest).toBe(25);
    expect(alice.lowest).toBe(8);
  });

  it("session totals + sorted busiest-first", () => {
    expect(stats.totalRolls).toBe(5);
    expect(stats.totalNat20).toBe(1);
    expect(stats.totalNat1).toBe(1);
    expect(stats.players[0]!.player).toBe("Alice"); // 3 rolls > Bob's 2
  });

  it("computes true average d20 (raw die) and crit rate", () => {
    const rs = aggregate([
      rec({ player: "Cara", d20: true, rawD20: 20, crit: true }),
      rec({ player: "Cara", d20: true, rawD20: 10 }),
      rec({ player: "Cara", d20: true, rawD20: 6 }),
      rec({ player: "Cara", d20: false, rawD20: null }), // damage — ignored for luck
    ]);
    const cara = rs.players[0]!;
    expect(cara.avgD20).toBe(12); // (20+10+6)/3
    expect(cara.critRate).toBeCloseTo(0.333, 3); // 1 nat20 of 3 d20 rolls (rounded)
  });

  it("sums damage dealt per player", () => {
    const rs = aggregate([
      rec({ player: "Bru", name: "Greataxe", d20: true, damage: 12 }),
      rec({ player: "Bru", name: "Greataxe", d20: true, damage: 9 }),
      rec({ player: "Bru", name: "Cure Wounds", d20: false, damage: 0 }), // healing excluded upstream
      rec({ player: "Mage", name: "Fireball", d20: false, damage: 24 }),
    ]);
    expect(rs.players.find((p) => p.player === "Bru")!.damage).toBe(21);
    expect(rs.players.find((p) => p.player === "Mage")!.damage).toBe(24);
  });

  it("CSV export has a header row and one row per record", () => {
    const csv = recordsToCSV(records);
    expect(csv.split("\n").length).toBe(records.length + 1);
    expect(csv.split("\n")[0]).toContain("player");
    expect(statsToCSV(stats).split("\n")[0]).toContain("nat20");
  });
});
