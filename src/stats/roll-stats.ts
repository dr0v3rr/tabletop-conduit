// Pure session-statistics over scraped Roll20 roll records. No DOM, no IO — testable.
import type { RollRecord } from "../roll20/log.js";

export interface PlayerStats {
  player: string;
  rolls: number; // all roll records
  d20Rolls: number; // d20-based rolls (attack/save/check/skill/init)
  nat20: number; // natural 20s
  nat1: number; // natural 1s
  critRate: number | null; // nat20 / d20Rolls (0..1)
  avgD20: number | null; // mean of the raw natural d20 die (true luck — trends to 10.5)
  avgD20Total: number | null; // mean of d20 roll totals (incl. modifiers)
  highest: number | null; // best d20 total
  lowest: number | null; // worst d20 total
  luck: number | null; // nat20 − nat1 (crude luck index)
  damage: number; // total damage dice dealt (attacks + damaging spells; healing excluded)
}

export interface SessionStats {
  players: PlayerStats[];
  totalRolls: number;
  totalNat20: number;
  totalNat1: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function aggregate(records: RollRecord[]): SessionStats {
  const byPlayer = new Map<string, RollRecord[]>();
  for (const r of records) {
    const key = r.player || "Unknown";
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(r);
  }

  const players: PlayerStats[] = [];
  for (const [player, recs] of byPlayer) {
    const d20 = recs.filter((r) => r.d20 && r.total != null);
    const totals = d20.map((r) => r.total as number);
    const rawDice = recs.filter((r) => r.d20 && r.rawD20 != null).map((r) => r.rawD20 as number);
    const nat20 = recs.filter((r) => r.crit).length; // crit is only set on d20 nat-20s
    const nat1 = recs.filter((r) => r.fumble).length; // any '1' counts (d20 nat-1 + non-d20 dice)
    players.push({
      player,
      rolls: recs.length,
      d20Rolls: d20.length,
      nat20,
      nat1,
      critRate: d20.length ? Math.round((nat20 / d20.length) * 1000) / 1000 : null,
      avgD20: rawDice.length ? round1(rawDice.reduce((a, b) => a + b, 0) / rawDice.length) : null,
      avgD20Total: totals.length ? round1(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
      highest: totals.length ? Math.max(...totals) : null,
      lowest: totals.length ? Math.min(...totals) : null,
      luck: nat20 - nat1,
      damage: recs.reduce((a, r) => a + (r.damage || 0), 0),
    });
  }
  // busiest roller first
  players.sort((a, b) => b.rolls - a.rolls);

  return {
    players,
    totalRolls: records.length,
    totalNat20: players.reduce((a, p) => a + p.nat20, 0),
    totalNat1: players.reduce((a, p) => a + p.nat1, 0),
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The full session log as CSV. */
export function recordsToCSV(records: RollRecord[]): string {
  const header = ["timestamp", "campaign", "player", "gm", "character", "name", "total", "raw_d20", "damage", "all_totals", "d20", "nat20", "nat1", "breakdown"];
  const rows = records.map((r) =>
    [r.ts ?? "", r.campaign ?? "", r.player, r.isGM, r.character ?? "", r.name, r.total ?? "", r.rawD20 ?? "", r.damage, r.totals.join(" / "), r.d20, r.crit, r.fumble, r.breakdown].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** Per-player stats as CSV. */
export function statsToCSV(stats: SessionStats): string {
  const header = ["player", "rolls", "d20_rolls", "nat20", "nat1", "crit_rate", "avg_d20", "avg_d20_total", "highest", "lowest", "luck", "damage"];
  const rows = stats.players.map((p) =>
    [p.player, p.rolls, p.d20Rolls, p.nat20, p.nat1, p.critRate ?? "", p.avgD20 ?? "", p.avgD20Total ?? "", p.highest ?? "", p.lowest ?? "", p.luck ?? "", p.damage].map(csvCell).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
