// Hit Point Dice — spent on a Short Rest to heal (roll the class's die + CON mod each). A character has
// one die per class level, of that class's die type. Pools are kept PER CLASS (not merged by die size)
// because D&D Beyond tracks `hitDiceUsed` per class and its Short Rest pane stages dice per class row.
//
// Long Rest recovery depends on the sheet's rules, which D&D Beyond stores as preferences.longRestType:
//   2 = "Recover all Hit Dice" (5.5e / 2024 rules) — the default when it's missing
//   1 = "Recover 1/2 Hit Dice" (5e / 2014 rules) — up to half the character's TOTAL dice (min 1)
import type { CharacterData, RollModel } from "./types.js";

export interface HitDicePool {
  cls: string; // class name, e.g. "Sorcerer" — matches the D&D Beyond Short Rest row
  die: number; // die size, e.g. 8 for d8
  total: number; // dice in this class (= its level)
  used: number; // dice already spent (from the character's tracked state)
}

export type LongRestRule = "all" | "half";

export interface HitDice {
  pools: HitDicePool[]; // one per class, in the sheet's class order
  conMod: number; // added to each hit-die heal roll
  longRest: LongRestRule;
  /** ×2 while a Periapt of Wound Closure is attuned ("double the HP a Hit Point Die restores"). */
  healMultiplier: number;
}

export function computeHitDice(data: CharacterData, model: RollModel): HitDice {
  const pools: HitDicePool[] = [];
  for (const c of (data as any).classes ?? []) {
    const die = c?.definition?.hitDice;
    if (!die) continue;
    pools.push({ cls: String(c.definition.name ?? `d${die}`), die, total: c.level ?? 0, used: c.hitDiceUsed ?? 0 });
  }
  const longRest: LongRestRule = (data as any).preferences?.longRestType === 1 ? "half" : "all";
  const periapt = ((data as any).inventory ?? []).some(
    (it: any) => it?.isAttuned && /^periapt of wound closure$/i.test(String(it?.definition?.name ?? "")),
  );
  return { pools, conMod: model.abilities.CON.mod, longRest, healMultiplier: periapt ? 2 : 1 };
}

/** How many dice each pool regains on a Long Rest, given what's currently spent. "all" restores every
 *  spent die. "half" restores up to half the character's total dice (rounded down, min 1) — the player
 *  picks which, so default to the largest dice first (they heal the most). Returns a used-count per pool. */
export function longRestUsed(pools: HitDicePool[], rule: LongRestRule): number[] {
  if (rule === "all") return pools.map(() => 0);
  const total = pools.reduce((a, p) => a + p.total, 0);
  let budget = Math.max(1, Math.floor(total / 2));
  const used = pools.map((p) => p.used);
  const order = pools.map((_, i) => i).sort((a, b) => pools[b]!.die - pools[a]!.die);
  for (const i of order) {
    const back = Math.min(used[i]!, budget);
    used[i] = used[i]! - back;
    budget -= back;
  }
  return used;
}

/** Roll20 formula for spending one Hit Point Die (die + CON, doubled by a Periapt of Wound Closure). */
export function hitDieHealFormula(die: number, conMod: number, multiplier = 1): string {
  const base = conMod > 0 ? `1d${die} + ${conMod}` : conMod < 0 ? `1d${die} - ${-conMod}` : `1d${die}`;
  return multiplier > 1 ? `(${base}) * ${multiplier}` : base;
}
