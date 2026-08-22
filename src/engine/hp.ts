// Hit-point state.
//
// D&D Beyond stores HP as: a max (either an explicit override, or base + CON×level + bonus),
// the damage taken so far (`removedHitPoints`), and temporary HP. Current = max − removed.
// Writing HP back uses PUT /character/v5/life/hp/damage-taken with the removed + temp totals.

import type { CharacterData, RollModel } from "./types.js";

export interface HpState {
  current: number;
  max: number;
  temp: number;
  /** damage taken so far (the value DDB persists); current = max − removed. */
  removed: number;
}

export function computeHp(data: CharacterData, model: RollModel): HpState {
  const d = data as unknown as {
    removedHitPoints?: number | null;
    temporaryHitPoints?: number | null;
    baseHitPoints?: number | null;
    bonusHitPoints?: number | null;
    overrideHitPoints?: number | null;
  };
  const removed = d.removedHitPoints ?? 0;
  const temp = d.temporaryHitPoints ?? 0;
  let max: number;
  if (d.overrideHitPoints != null) {
    max = d.overrideHitPoints;
  } else {
    const base = d.baseHitPoints ?? 0;
    const bonus = d.bonusHitPoints ?? 0;
    max = base + model.abilities.CON.mod * model.level + bonus;
  }
  return { current: max - removed, max, temp, removed };
}
