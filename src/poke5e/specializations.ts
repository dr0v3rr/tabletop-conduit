// poke5e trainer specializations — the part that affects a Pokémon's rolls.
//
// A specialization is tied to a Pokémon type and is stackable (poke5e caps each type at 5). Its
// TRAINER-side effect (an ability-score bump or a skill proficiency/expertise) is already baked into
// the trainer's stored stats by poke5e, so we never re-apply that. The Pokémon-side effect is the
// universal rider: "+1 to all skill checks made by any of your <type>-type Pokémon", per stack,
// summed across the Pokémon's types (matching poke5e's skillModifiersFromSpecializations). It applies
// to skill checks only — never to saving throws, attack rolls, or raw ability checks.

/** The 18 Pokémon types that can carry a trainer specialization (stored as `special_<type>`). */
export const SPEC_TYPES = [
  "normal", "fighting", "flying", "poison", "ground", "rock", "bug", "ghost", "steel",
  "fire", "water", "grass", "electric", "psychic", "ice", "dragon", "dark", "fairy",
] as const;

/** The trainer's specialization counts, read off the raw get_trainer row (per type, capped at 5). */
export function specCounts(trainerRow: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of SPEC_TYPES) {
    const n = Number(trainerRow?.[`special_${t}`]) || 0;
    if (n > 0) out[t] = Math.min(5, n);
  }
  return out;
}

/** The flat skill-check bonus a Pokémon gets from its trainer's specializations: +1 per stack for
 *  each of the Pokémon's types, summed. 0 when nothing matches. */
export function specSkillBonus(counts: Record<string, number>, pokemonTypes: string[]): number {
  const types = new Set((pokemonTypes || []).map((t) => String(t).toLowerCase()));
  return Object.entries(counts).reduce((sum, [type, n]) => sum + (types.has(type) ? (Number(n) || 0) : 0), 0);
}
