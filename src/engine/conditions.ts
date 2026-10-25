// Conditions layer.
//
// D&D Beyond stores active conditions at `data.conditions` = [{ id, level }] and mutates them via
// PUT/DELETE /character/v5/condition. The ids are DDB's canonical condition numbering (verified:
// Poisoned = 11). Each condition maps to roll effects (RuleEffect) for the character's OWN rolls;
// GM-side effects ("attacks against you have advantage") and non-roll effects aren't modelled.
// Exhaustion is handled by the existing exhaustion rules, not here.

import type { RuleEffect } from "../shared/roll-types.js";
import type { CharacterData } from "./types.js";

export interface ConditionDef {
  id: number;      // DDB condition id
  slug: string;    // stable slug → used to build the registry rule id `condition-<slug>`
  name: string;
  /** Effects on THIS character's own rolls while the condition is active (may be empty). */
  effects: RuleEffect[];
}

const dis = (target: "attack" | "check" | "save", label: string): RuleEffect =>
  ({ op: "advantage", target, mode: "disadvantage", label });
const adv = (target: "attack" | "check" | "save", label: string): RuleEffect =>
  ({ op: "advantage", target, mode: "advantage", label });

// Only conditions that modify the character's own d20 rolls carry effects; the rest are tracked
// (shown, synced) but don't auto-adjust a roll (Restrained's DEX-save disadvantage is omitted
// because the effect model can't target a single save ability, and over-applying would be wrong).
export const CONDITIONS: ConditionDef[] = [
  { id: 1, slug: "blinded", name: "Blinded", effects: [dis("attack", "Blinded")] },
  { id: 2, slug: "charmed", name: "Charmed", effects: [] },
  { id: 3, slug: "deafened", name: "Deafened", effects: [] },
  { id: 4, slug: "exhaustion", name: "Exhaustion", effects: [] }, // handled by the exhaustion rules
  { id: 5, slug: "frightened", name: "Frightened", effects: [dis("attack", "Frightened"), dis("check", "Frightened")] },
  { id: 6, slug: "grappled", name: "Grappled", effects: [] },
  { id: 7, slug: "incapacitated", name: "Incapacitated", effects: [] },
  { id: 8, slug: "invisible", name: "Invisible", effects: [adv("attack", "Invisible")] },
  { id: 9, slug: "paralyzed", name: "Paralyzed", effects: [] },
  { id: 10, slug: "petrified", name: "Petrified", effects: [] },
  { id: 11, slug: "poisoned", name: "Poisoned", effects: [dis("attack", "Poisoned"), dis("check", "Poisoned")] },
  { id: 12, slug: "prone", name: "Prone", effects: [dis("attack", "Prone")] },
  { id: 13, slug: "restrained", name: "Restrained", effects: [dis("attack", "Restrained")] },
  { id: 14, slug: "stunned", name: "Stunned", effects: [] },
  { id: 15, slug: "unconscious", name: "Unconscious", effects: [] },
];

export const CONDITION_BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

export interface ActiveCondition { id: number; slug: string; name: string; level: number | null; }

/** The character's currently-active conditions (from DDB's data.conditions). */
export function computeConditions(data: CharacterData): ActiveCondition[] {
  const raw = (data as { conditions?: { id: number; level?: number | null }[] | null }).conditions ?? [];
  const out: ActiveCondition[] = [];
  for (const c of raw) {
    const def = CONDITION_BY_ID.get(c.id);
    if (def) out.push({ id: def.id, slug: def.slug, name: def.name, level: c.level ?? null });
  }
  return out;
}

// ── Exhaustion ──────────────────────────────────────────────────────────────────────────────────
// Exhaustion stacks in levels (1-6; level 6 is death), and the two rule sets differ:
//   2024: each level is -2 to every d20 Test (attack, check, save, initiative) and -5 ft speed.
//   2014: 1 = disadvantage on checks, 2 = speed halved, 3 = disadvantage on attacks and saves,
//         4 = HP max halved (not modelled), 5 = speed 0.
export const EXHAUSTION_ID = 4;
export const EXHAUSTION_MAX = 6;
export type ExhaustionRules = "2024" | "2014";

/** Roll effects for an Exhaustion level (0 or less → none). */
export function exhaustionEffects(level: number, rules: ExhaustionRules): RuleEffect[] {
  const lvl = Math.min(EXHAUSTION_MAX, Math.max(0, Math.floor(level)));
  if (!lvl) return [];
  const label = `Exhaustion ${lvl}`;
  if (rules === "2024") return [{ op: "flat", target: "d20", value: -2 * lvl, label }];
  const out: RuleEffect[] = [dis("check", label)];
  if (lvl >= 3) out.push(dis("attack", label), dis("save", label));
  return out;
}

/** Speed after Exhaustion (never below 0). */
export function exhaustionSpeed(speed: number, level: number, rules: ExhaustionRules): number {
  const lvl = Math.min(EXHAUSTION_MAX, Math.max(0, Math.floor(level)));
  if (!lvl) return speed;
  if (rules === "2024") return Math.max(0, speed - 5 * lvl);
  if (lvl >= 5) return 0;
  return lvl >= 2 ? Math.floor(speed / 2) : speed;
}
