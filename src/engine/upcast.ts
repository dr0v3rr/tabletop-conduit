// Up-casting: a spell cast in a slot above its own level deals more damage. This is the pure
// dice-scaling maths, shared by the renderer's spell rows and cast path (and unit-tested here so
// the merge logic isn't only exercised through the untyped electron bundle).

/**
 * Add `extraLevels` copies of a per-slot-level increment die to a base damage string.
 *
 * Merges into the first matching `NdX` term when the faces match — Fireball "8d6" up-cast 6 levels
 * with "1d6" → "14d6". When the increment die's faces don't appear in the base (or the base leads
 * with a flat/other term), the increment is appended as its own term — "2d8 + 3" + 2×"1d6" →
 * "2d8 + 3 + 2d6". A zero/absent increment or non-positive level delta returns the base unchanged.
 */
export function scaleDamageDice(baseDice: string, incDie: string | undefined, extraLevels: number): string {
  if (!incDie || extraLevels <= 0 || !baseDice) return baseDice;
  const m = incDie.match(/^(\d+)d(\d+)$/);
  if (!m) return baseDice;
  const [, countStr, faces] = m;
  if (!countStr || !faces) return baseDice;
  const addCount = Number(countStr) * extraLevels;
  if (addCount <= 0) return baseDice;
  const re = new RegExp(`(^|[^\\d])(\\d+)d${faces}\\b`);
  if (re.test(baseDice)) return baseDice.replace(re, (_all, pre: string, n: string) => `${pre}${Number(n) + addCount}d${faces}`);
  return `${baseDice} + ${addCount}d${faces}`;
}
