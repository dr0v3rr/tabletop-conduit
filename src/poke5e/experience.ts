// poke5e Pokémon experience. EXP is a single incremental number on the Pokémon row (`_exp`). These
// are the cumulative thresholds to REACH each level (index = level − 1), straight from poke5e's
// ExperienceNeededPerLevel; leveling up itself is done on poke5e (HP roll / ASI / feats / moves).

export const EXP_PER_LEVEL = [
  0, 200, 800, 2000, 6000, 12000, 20000, 30000, 44000, 62000,
  82000, 104000, 128000, 158000, 194000, 234000, 278000, 326000, 382000, 450000,
];
export const MAX_LEVEL = EXP_PER_LEVEL.length; // 20

/** Cumulative EXP required to be at `level` (clamped to 1..MAX_LEVEL). */
export function expNeededAtLevel(level: number): number {
  return EXP_PER_LEVEL[Math.max(1, Math.min(MAX_LEVEL, Math.floor(level || 1))) - 1] ?? 0;
}

/** EXP still needed to reach the next level (0 at max level). */
export function expUntilLevelUp(exp: number, level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, expNeededAtLevel(level + 1) - (Number(exp) || 0));
}

/** Comma-formatted EXP, e.g. 12340 → "12,340". */
export function formatExp(exp: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.round(Number(exp) || 0)));
}

/** Progress within the current level band, plus whether the Pokémon has enough EXP to level up. */
export function expProgress(exp: number, level: number): { pct: number; readyToLevel: boolean; nextAt: number; curBase: number } {
  const e = Math.max(0, Number(exp) || 0);
  const lvl = Math.max(1, Math.floor(level || 1));
  const curBase = expNeededAtLevel(lvl);
  const nextAt = lvl >= MAX_LEVEL ? curBase : expNeededAtLevel(lvl + 1);
  const band = Math.max(1, nextAt - curBase);
  const pct = lvl >= MAX_LEVEL ? 1 : Math.max(0, Math.min(1, (e - curBase) / band));
  return { pct, readyToLevel: lvl < MAX_LEVEL && e >= nextAt, nextAt, curBase };
}
