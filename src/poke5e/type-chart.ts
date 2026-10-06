// Pokémon type effectiveness (the standard Gen-6+ chart poke5e uses — poke5e ships no machine-
// readable chart, and pokemon.json carries only a Pokémon's own `type`). Used to type poke5e damage
// by the 18 Pokémon types and apply super-effective / not-very-effective / immune multipliers when
// damage is dealt to a Pokémon (whose defending type(s) we know from its sheet).

export const POKE_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const;
export type PokeType = (typeof POKE_TYPES)[number];

// Per ATTACKING type: which defender types it is super-effective (2×), not-very-effective (½×),
// or has no effect on (0×). Everything unlisted is neutral (1×).
const SE: Record<string, string[]> = {
  normal: [], fire: ['grass', 'ice', 'bug', 'steel'], water: ['fire', 'ground', 'rock'],
  electric: ['water', 'flying'], grass: ['water', 'ground', 'rock'], ice: ['grass', 'ground', 'flying', 'dragon'],
  fighting: ['normal', 'ice', 'rock', 'dark', 'steel'], poison: ['grass', 'fairy'],
  ground: ['fire', 'electric', 'poison', 'rock', 'steel'], flying: ['grass', 'fighting', 'bug'],
  psychic: ['fighting', 'poison'], bug: ['grass', 'psychic', 'dark'], rock: ['fire', 'ice', 'flying', 'bug'],
  ghost: ['psychic', 'ghost'], dragon: ['dragon'], dark: ['psychic', 'ghost'],
  steel: ['ice', 'rock', 'fairy'], fairy: ['fighting', 'dragon', 'dark'],
};
const NVE: Record<string, string[]> = {
  normal: ['rock', 'steel'], fire: ['fire', 'water', 'rock', 'dragon'], water: ['water', 'grass', 'dragon'],
  electric: ['electric', 'grass', 'dragon'], grass: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],
  ice: ['fire', 'water', 'ice', 'steel'], fighting: ['poison', 'flying', 'psychic', 'bug', 'fairy'],
  poison: ['poison', 'ground', 'rock', 'ghost'], ground: ['grass', 'bug'], flying: ['electric', 'rock', 'steel'],
  psychic: ['psychic', 'steel'], bug: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
  rock: ['fighting', 'ground', 'steel'], ghost: ['dark'], dragon: ['steel'], dark: ['fighting', 'dark', 'fairy'],
  steel: ['fire', 'water', 'electric', 'steel'], fairy: ['fire', 'poison', 'steel'],
};
const NO: Record<string, string[]> = {
  normal: ['ghost'], electric: ['ground'], fighting: ['ghost'], poison: ['steel'],
  ground: ['flying'], psychic: ['dark'], ghost: ['normal'], dragon: ['fairy'],
};

/** Effectiveness of one attacking type against one defending type (2 / 1 / 0.5 / 0). */
export function typeFactor(attack: string, defender: string): number {
  const a = attack.toLowerCase(), d = defender.toLowerCase();
  if ((NO[a] ?? []).includes(d)) return 0;
  if ((SE[a] ?? []).includes(d)) return 2;
  if ((NVE[a] ?? []).includes(d)) return 0.5;
  return 1;
}

/** poke5e effectiveness of an attacking type vs a defender's type(s). poke5e uses D&D-style
 *  resistance/vulnerability — per its rules, "there is no 'double vulnerability' or 'double
 *  resistance' due to dual types." The raw product across both defending types only sets the
 *  DIRECTION; the applied multiplier is then CAPPED: ×0 (immune) / ×½ (resistant) / ×2 (vulnerable)
 *  / ×1 (normal). (This matches poke5e's own client, which buckets by e===0 / 0<e<1 / e>1.)
 *  So Rock/Electric vs Ground is ×2 here, not ×4; Psychic/Fairy vs Fighting is ×½, not ×¼; and a
 *  type that's weak on one half but resisted on the other (product 1) is normal. Empty defender → 1. */
export function typeMultiplier(attack: string, defenderTypes: string[]): number {
  const product = (defenderTypes ?? []).reduce((m, t) => m * typeFactor(attack, t), 1);
  if (product === 0) return 0; // immune (dominates)
  if (product > 1) return 2;   // vulnerable (capped — no ×4)
  if (product < 1) return 0.5; // resistant (capped — no ×¼)
  return 1;                    // normal
}

/** A Pokémon's defensive type matchup (poke5e model): which attacking types it's Vulnerable to (×2),
 *  Resistant to (×½), or Immune to (×0). Normal (×1) types are omitted. Each list is in POKE_TYPES
 *  order. There is no ×4 / ×¼ — dual types never double a vulnerability or resistance. */
export interface TypeMatchup {
  vulnerable: PokeType[]; // ×2
  resist: PokeType[];     // ×½
  immune: PokeType[];     // ×0
}

/** Bucket all 18 attacking types by poke5e effectiveness against a defender's type(s). */
export function typeMatchup(defenderTypes: string[]): TypeMatchup {
  const out: TypeMatchup = { vulnerable: [], resist: [], immune: [] };
  for (const atk of POKE_TYPES) {
    const m = typeMultiplier(atk, defenderTypes);
    if (m === 0) out.immune.push(atk);
    else if (m === 2) out.vulnerable.push(atk);
    else if (m === 0.5) out.resist.push(atk);
  }
  return out;
}

/** A short label for a poke5e effectiveness multiplier, or null for normal (×1). */
export function effectivenessLabel(mult: number): string | null {
  if (mult === 0) return 'immune (×0)';
  if (mult === 2) return 'super effective ×2';
  if (mult === 0.5) return 'not very effective ×½';
  return null; // ×1 normal
}
