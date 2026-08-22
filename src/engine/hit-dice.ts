// Hit Dice — spent on a short rest to heal (roll the class hit die + CON mod each). A character
// has one hit die per class level, of that class's die type; a long rest restores half (min 1).
import type { CharacterData, RollModel } from "./types.js";

export interface HitDicePool {
  die: number; // die size, e.g. 8 for d8
  total: number; // total dice (sum of levels in classes with this die)
  used: number; // dice already spent (from the character's tracked state)
}

export interface HitDice {
  pools: HitDicePool[]; // one per distinct die size, largest first
  conMod: number; // added to each hit-die heal roll
}

export function computeHitDice(data: CharacterData, model: RollModel): HitDice {
  const byDie = new Map<number, { total: number; used: number }>();
  for (const c of (data as any).classes ?? []) {
    const die = c?.definition?.hitDice;
    if (!die) continue;
    const e = byDie.get(die) ?? { total: 0, used: 0 };
    e.total += c.level ?? 0;
    e.used += c.hitDiceUsed ?? 0;
    byDie.set(die, e);
  }
  const pools = [...byDie.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([die, e]) => ({ die, total: e.total, used: e.used }));
  return { pools, conMod: model.abilities.CON.mod };
}
