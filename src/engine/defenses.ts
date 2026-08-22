// Damage defenses — resistances / immunities / vulnerabilities from D&D Beyond.
// DDB expresses these as modifiers with type 'resistance' | 'immunity' | 'vulnerability'
// and a subType that is the damage type (e.g. 'fire', 'poison'). They live in the same
// `data.modifiers` buckets (race / class / feat / item / background / condition) the rest
// of the engine reads. We collect them so the HP tracker can halve/zero/double incoming
// damage of a given type.

import type { CharacterData } from "./types";

/** The 13 standard 5e damage types (kebab, matching DDB subTypes). */
export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

export interface Defenses {
  /** Half damage. */
  resist: DamageType[];
  /** No damage. */
  immune: DamageType[];
  /** Double damage. */
  vulnerable: DamageType[];
}

const TYPES = new Set<string>(DAMAGE_TYPES);

/** Scan every modifier bucket for damage resistances / immunities / vulnerabilities. */
export function computeDefenses(data: CharacterData): Defenses {
  const resist = new Set<DamageType>();
  const immune = new Set<DamageType>();
  const vulnerable = new Set<DamageType>();
  for (const arr of Object.values(data.modifiers ?? {})) {
    for (const m of arr ?? []) {
      const sub = (m.subType || "").toLowerCase();
      if (!TYPES.has(sub)) continue;
      const dt = sub as DamageType;
      // Immunity dominates resistance which dominates vulnerability if a type appears twice.
      if (m.type === "immunity") immune.add(dt);
      else if (m.type === "resistance") resist.add(dt);
      else if (m.type === "vulnerability") vulnerable.add(dt);
    }
  }
  // A type can technically be flagged twice; immunity > resistance > vulnerability.
  for (const dt of immune) { resist.delete(dt); vulnerable.delete(dt); }
  for (const dt of resist) vulnerable.delete(dt);
  return { resist: [...resist].sort(), immune: [...immune].sort(), vulnerable: [...vulnerable].sort() };
}

/** Apply a defense to a raw damage amount for a given type. Returns the adjusted amount and a
 *  short label describing what happened (or null for untyped / no applicable defense). */
export function applyDefense(
  amount: number,
  type: DamageType | null,
  def: Defenses,
): { amount: number; effect: "immune" | "resist" | "vulnerable" | null } {
  if (!type) return { amount, effect: null };
  if (def.immune.includes(type)) return { amount: 0, effect: "immune" };
  if (def.resist.includes(type)) return { amount: Math.floor(amount / 2), effect: "resist" };
  if (def.vulnerable.includes(type)) return { amount: amount * 2, effect: "vulnerable" };
  return { amount, effect: null };
}
