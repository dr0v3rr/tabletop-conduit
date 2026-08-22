// Layer-3 rules registry.
//
// Loads reference/roll-options-catalog.json (83 entries from prior Beyond20 analysis),
// normalizes each into a `Rule`, and appends the two feats that analysis found MISSING
// from Beyond20 (Elven Accuracy, Savage Attacker) as first-class rules.
//
// Public API:
//   RULES                 — Rule[] (85 entries)
//   listAvailableToggles  — toggle rules whose appliesTo() is true (what a UI shows)
//   resolveEffects        — RuleEffect[] for automatic rules + enabled toggles

import type { RollRequest, RuleEffect, RollTarget } from "../shared/roll-types.js";
import type { CharacterData, RollModel } from "../engine/types.js";
import type { Rule, RuleKind } from "./types.js";
import rawCatalog from "../../reference/roll-options-catalog.json" with { type: "json" };
import { CONDITIONS } from "../engine/conditions.js";

// ---------------------------------------------------------------------------
// Raw catalog shape
// ---------------------------------------------------------------------------

interface RawEntry {
  id: string;
  name: string;
  kind: string;
  effect: string;
  toggle: boolean;
  condition: string | null;
  notes?: string;
}

const CATALOG = rawCatalog as unknown as RawEntry[];

// ---------------------------------------------------------------------------
// Name-matching helpers (best-effort, apostrophe/case/punctuation tolerant)
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** true if any candidate name matches `target` (equal, or candidate contains target). */
function hasNamed(candidates: string[], target: string): boolean {
  const t = norm(target);
  if (!t) return false;
  return candidates.some((c) => {
    const cn = norm(c);
    return cn === t || cn.includes(t) || t.includes(cn);
  });
}

function featNames(data: CharacterData): string[] {
  return (data.feats ?? [])
    .map((f) => f?.definition?.name)
    .filter((n): n is string => !!n);
}

function featureNames(data: CharacterData): string[] {
  const out: string[] = [];
  for (const c of data.classes ?? []) {
    const sub = c?.subclassDefinition?.name;
    if (sub) out.push(sub);
    for (const f of c?.classFeatures ?? []) {
      const n = f?.definition?.name;
      if (n) out.push(n);
    }
  }
  return out;
}

function traitNames(data: CharacterData): string[] {
  return (data.race?.racialTraits ?? [])
    .map((t) => t?.definition?.name)
    .filter((n): n is string => !!n);
}

function classNames(data: CharacterData): string[] {
  return (data.classes ?? [])
    .map((c) => c?.definition?.name)
    .filter((n): n is string => !!n);
}

/** The character's level in a specific class (0 if they don't have it) — for level-scaled features. */
function classLevel(data: CharacterData, name: string): number {
  for (const c of data.classes ?? []) if (c?.definition?.name === name) return c.level ?? 0;
  return 0;
}

const KNOWN_CLASSES = [
  "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin",
  "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard", "Artificer",
  "Blood Hunter", "Bloodhunter",
];

// ---------------------------------------------------------------------------
// Generic applicability
// ---------------------------------------------------------------------------

/** Best-effort: parse the condition string and check character ownership. */
function genericAppliesTo(entry: RawEntry, data: CharacterData): boolean {
  const cond = entry.condition;
  if (!cond) return true; // null condition => generic user-controlled toggle

  const featM = cond.match(/hasFeat\s*\(?\s*['"]?([^'")]+)/i);
  if (featM && featM[1]) return hasNamed(featNames(data), featM[1]);

  // Fighting-style helper in the catalog notes/condition. BOTH the 2014 and 2024
  // catalog entries carry this token, so if we accepted both a character with the
  // style would stack reroll (2014) AND min-die (2024). Keep only ONE — the 2014
  // reroll-2 variant — by declining the 2024 entry here.
  if (/hasGreatWeaponFighting/i.test(cond)) {
    if (/2024/.test(cond)) return false;
    return hasNamed(featureNames(data), "Great Weapon Fighting");
  }

  const cfM = cond.match(/hasClassFeature\s*\(?\s*['"]?([^'")]+)/i);
  if (cfM && cfM[1]) return hasNamed(featureNames(data), cfM[1]);

  const rtM = cond.match(/hasRacialTrait\s*\(?\s*['"]?([^'")]+)/i);
  if (rtM && rtM[1]) return hasNamed(traitNames(data), rtM[1]);

  // Bare class-name references (e.g. "Barbarian", "Warlock with Lifedrinker …").
  const owned = classNames(data);
  for (const c of KNOWN_CLASSES) {
    if (new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(cond)) {
      return hasNamed(owned, c);
    }
  }

  // Plain-English ownership references, e.g. "Character has racial trait 'Lucky'",
  // "requires feat 'Alert'", "class feature 'Sneak Attack'". Not every catalog
  // condition is in hasX() function form, so a character who LACKS the named
  // trait/feat/feature would otherwise fall through to the permissive
  // `return entry.toggle` below and be shown an option that can never apply to
  // them (the bug that surfaced a non-Halfling seeing "Lucky").
  const quoted = [...cond.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((q): q is string => !!q);
  if (quoted.length) {
    if (/racial trait/i.test(cond)) return quoted.some((q) => hasNamed(traitNames(data), q));
    if (/\bfeat\b/i.test(cond)) return quoted.some((q) => hasNamed(featNames(data), q));
    if (/class feature|\bfeature\b/i.test(cond)) return quoted.some((q) => hasNamed(featureNames(data), q));
  }

  // No ownership token could be parsed. Purely situational conditions are fine for
  // user toggles (the user decides); automatic rules stay off unless confirmed.
  return entry.toggle;
}

// ---------------------------------------------------------------------------
// Effect-string parsing helpers
// ---------------------------------------------------------------------------

function parseDice(s: string): string | undefined {
  const m = s.match(/([+-]?\s*\d*d\d+)/i);
  if (!m || !m[1]) return undefined;
  let dice = m[1].replace(/\s+/g, "");
  if (/^[+-]?d/i.test(dice)) dice = dice.replace(/d/i, "1d"); // "d6" -> "1d6"
  return dice;
}

function parseFlat(s: string): number | undefined {
  const m = s.match(/([+-]\s*\d+)/);
  if (!m || !m[1]) return undefined;
  return parseInt(m[1].replace(/\s+/g, ""), 10);
}

function parseReroll(s: string): number {
  const m = s.match(/ro\s*<?=?\s*(\d+)/i);
  if (m && m[1]) return parseInt(m[1], 10);
  if (/1s and 2s/i.test(s)) return 2;
  return 1;
}

function parseCritRange(s: string): number | undefined {
  if (/18-20/.test(s) || /to 18/i.test(s)) return 18;
  if (/19-20/.test(s) || /to 19/i.test(s)) return 19;
  return undefined;
}

// ---------------------------------------------------------------------------
// Default target per kind
// ---------------------------------------------------------------------------

function defaultTarget(kind: string, entry: RawEntry): RollTarget {
  switch (kind) {
    case "attack-mod":
      return "attack";
    case "damage-mod":
      return "damage";
    case "add-dice":
      return "damage";
    case "save-mod":
      return "save";
    case "reroll":
      return "damage";
    case "advantage": {
      const t = `${entry.effect} ${entry.name}`.toLowerCase();
      if (t.includes("save")) return "save";
      if (t.includes("check")) return "check";
      return "attack";
    }
    case "flat":
    default:
      return "check";
  }
}

// ---------------------------------------------------------------------------
// Per-id special-case effect builders (semantics the generic mapper can't infer)
// ---------------------------------------------------------------------------

type EffectBuilder = (
  data: CharacterData,
  rollModel: RollModel,
  request: RollRequest,
) => RuleEffect[];

const SPECIAL_EFFECTS: Record<string, EffectBuilder> = {
  sharpshooter: () => [
    { op: "flat", target: "attack", value: -5, label: "Sharpshooter" },
    { op: "flat", target: "damage", value: 10, label: "Sharpshooter" },
  ],
  "great-weapon-master": () => [
    { op: "flat", target: "attack", value: -5, label: "Great Weapon Master" },
    { op: "flat", target: "damage", value: 10, label: "Great Weapon Master" },
  ],
  "great-weapon-master-2024": (_d, rollModel) => [
    { op: "flat", target: "damage", value: rollModel.profBonus, label: "Heavy Weapon Mastery" },
  ],
  "effects-bless": () => [
    { op: "add-dice", target: "attack", dice: "1d4", label: "Bless" },
    { op: "add-dice", target: "save", dice: "1d4", label: "Bless" },
  ],
  "effects-bane": () => [
    { op: "add-dice", target: "attack", dice: "-1d4", label: "Bane" },
    { op: "add-dice", target: "save", dice: "-1d4", label: "Bane" },
  ],
  "great-weapon-fighting-2014": () => [
    { op: "reroll", target: "damage", threshold: 2, label: "Great Weapon Fighting" },
  ],
  "great-weapon-fighting-2024": () => [
    { op: "min-die", target: "damage", min: 3, label: "Great Weapon Fighting" },
  ],
  // Halfling Lucky rerolls a natural 1 on EVERY d20 (attack/check/save/initiative),
  // so it targets 'd20' (all d20 rolls), not just attacks.
  "halfling-lucky": () => [
    { op: "reroll", target: "d20", threshold: 1, label: "Lucky" },
  ],
  // Exhaustion (2024): -2 x level applies to ALL d20 rolls, so it targets 'd20'
  // (attack + save + check + skill + initiative), not just 'check'.
  "effects-exhaustion-2024": () => [
    { op: "flat", target: "d20", value: -2, label: "Exhaustion (2024)" },
  ],
  // Silver Tongue and Reliable Talent are "treat a <10 roll as 10" floors on specific
  // ability checks — NOT advantage/reroll. They have no native Roll20 encoding here, so
  // emit no effects (rather than corrupting attacks/damage as before).
  "silver-tongue": () => [],
  "reliable-talent": () => [],
  // Exhaustion (2014) is disadvantage, not advantage. The generic 'advantage' builder can only emit
  // advantage (and defaultTarget mis-picked 'save'), which handed the character a *beneficial* roll.
  // Model the always-true level-1 effect: disadvantage on ability checks. (Attack/save disadvantage
  // only kicks in at level 3, which we don't track — the 2024 exhaustion toggle covers d20 penalties.)
  "effects-exhaustion-2014": () => [
    { op: "advantage", target: "check", mode: "disadvantage", label: "Exhaustion (2014)" },
  ],
  // Trance of Order is a "treat a d20 of 9 or lower as 10" floor — NOT advantage. Same bug class as
  // silver-tongue/reliable-talent: emit nothing rather than a spurious attack advantage.
  "sorcerer-trance-of-order": () => [],
  // Sneak Attack scales as ceil(RogueLevel/2)d6. The generic add-dice mapper mis-parses the prose to
  // a flat 1d6 (a Rogue 20 would get 1d6 instead of 10d6), so compute the real dice from the level.
  "rogue-sneak-attack": (data) => {
    const lvl = classLevel(data, "Rogue");
    if (lvl <= 0) return [];
    return [{ op: "add-dice", target: "damage", dice: `${Math.ceil(lvl / 2)}d6`, label: "Sneak Attack" }];
  },
  // One catalog entry covers BOTH Improved Critical (19-20 -> 19) and Superior Critical
  // (18-20 -> 18). Derive the range from whichever feature the character actually has
  // instead of hardcoding 19.
  "improved-critical": (data) => {
    const feats = featureNames(data);
    const superior = hasNamed(feats, "Superior Critical");
    const range = superior ? 18 : 19;
    const label = superior ? "Superior Critical" : "Improved Critical";
    return [{ op: "crit-range", target: "attack", range, label }];
  },
  "paladin-invincible-conqueror": () => [
    { op: "crit-range", target: "attack", range: 19, label: "Invincible Conqueror" },
  ],
  // Hexblade's Curse adds a FLAT proficiency-bonus to damage vs the cursed target (not 1d6),
  // and expands the crit range to 19-20.
  "warlock-hexblade-curse": (_d, rollModel) => [
    { op: "flat", target: "damage", value: rollModel.profBonus, label: "Hexblade's Curse" },
    { op: "crit-range", target: "attack", range: 19, label: "Hexblade's Curse" },
  ],
};

// ---------------------------------------------------------------------------
// Generic effect builder
// ---------------------------------------------------------------------------

function genericEffects(entry: RawEntry, rollModel: RollModel): RuleEffect[] {
  const target = defaultTarget(entry.kind, entry);
  const label = entry.name;

  switch (entry.kind) {
    case "attack-mod": {
      const crit = parseCritRange(entry.effect);
      if (crit !== undefined) return [{ op: "crit-range", target: "attack", range: crit, label }];
      const v = parseFlat(entry.effect);
      if (v !== undefined) return [{ op: "flat", target: "attack", value: v, label }];
      return [];
    }
    case "save-mod": {
      const v = parseFlat(entry.effect);
      return [{ op: "flat", target: "save", value: v ?? 0, label }];
    }
    case "flat": {
      const v = parseFlat(entry.effect);
      const t = target === "attack" || target === "damage" || target === "check" || target === "save"
        ? target
        : "check";
      return [{ op: "flat", target: t, value: v ?? 0, label }];
    }
    case "damage-mod": {
      const dice = parseDice(entry.effect);
      if (dice) return [{ op: "add-dice", target: "damage", dice, label }];
      const v = parseFlat(entry.effect);
      if (v !== undefined) return [{ op: "flat", target: "damage", value: v, label }];
      return [];
    }
    case "add-dice": {
      const dice = parseDice(entry.effect) ?? "1d6";
      const t = target === "attack" || target === "damage" || target === "check" || target === "save"
        ? target
        : "damage";
      return [{ op: "add-dice", target: t, dice, label }];
    }
    case "advantage": {
      const t = target === "attack" || target === "check" || target === "save" ? target : "attack";
      return [{ op: "advantage", target: t, mode: "advantage", label }];
    }
    case "reroll": {
      const threshold = parseReroll(entry.effect);
      return [{ op: "reroll", target: "damage", threshold, label }];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Build a Rule from a catalog entry
// ---------------------------------------------------------------------------

function toRule(entry: RawEntry): Rule {
  const kind = entry.kind as RuleKind;
  return {
    id: entry.id,
    name: entry.name,
    kind,
    target: defaultTarget(entry.kind, entry),
    toggle: entry.toggle,
    condition: entry.condition ?? undefined,
    appliesTo(data) {
      return genericAppliesTo(entry, data);
    },
    toEffects(data, rollModel, request) {
      const special = SPECIAL_EFFECTS[entry.id];
      if (special) return special(data, rollModel, request);
      return genericEffects(entry, rollModel);
    },
  };
}

// ---------------------------------------------------------------------------
// The two feats prior analysis found MISSING from Beyond20
// ---------------------------------------------------------------------------

const ELVEN_ACCURACY: Rule = {
  id: "elven-accuracy",
  name: "Feat: Elven Accuracy",
  kind: "advantage",
  target: "attack",
  toggle: false, // automatic when you already have advantage with a qualifying ability
  condition:
    "hasFeat('Elven Accuracy') AND you have advantage on an attack using DEX, INT, WIS, or CHA (reroll one of the two d20s)",
  appliesTo(data, request) {
    if (!hasNamed(featNames(data), "Elven Accuracy")) return false;
    // Only meaningful when the attack already has advantage.
    if (request.kind !== "attack") return false;
    return request.advantage === "advantage";
  },
  toEffects(_data, _rollModel, request) {
    if (request.advantage !== "advantage") return [];
    return [{ op: "advantage", target: "attack", mode: "elven-accuracy", label: "Elven Accuracy" }];
  },
};

const SAVAGE_ATTACKER: Rule = {
  id: "savage-attacker",
  name: "Feat: Savage Attacker",
  kind: "reroll",
  target: "damage",
  toggle: true, // once per turn — user opts in when they use it
  condition:
    "hasFeat('Savage Attacker') — once per turn, reroll the weapon's damage dice and use either total",
  appliesTo(data) {
    return hasNamed(featNames(data), "Savage Attacker");
  },
  toEffects() {
    return [{ op: "reroll-keep-higher", target: "damage", label: "Savage Attacker" }];
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Active conditions apply their effects like always-on toggles: the conditions UI adds the
// active `condition-<slug>` ids to the enabled set on every roll (they're hidden from the
// Roll Options list — see listAvailableToggles — since they have their own chip UI).
const CONDITION_RULES: Rule[] = CONDITIONS.filter((c) => c.effects.length > 0).map((c) => ({
  id: `condition-${c.slug}`,
  name: `Condition: ${c.name}`,
  kind: "advantage" as RuleKind,
  target: "attack" as RollTarget,
  toggle: true,
  appliesTo: () => true,
  toEffects: () => c.effects,
}));

export const RULES: Rule[] = [
  ...CATALOG.map(toRule),
  ELVEN_ACCURACY,
  SAVAGE_ATTACKER,
  ...CONDITION_RULES,
];

// Beyond20 "options-page" entries that need a user-supplied VALUE (a formula, a
// threshold, a global mode) rather than a per-roll on/off. As bare checkboxes they
// either do nothing or apply a placeholder — e.g. the custom-* dice entries carry no
// dice in their effect text, so the generic mapper injects a phantom "1d6", silently
// corrupting rolls. They belong on a settings screen, not the per-roll toggle list.
export const CONFIG_ONLY_IDS = new Set<string>([
  "custom-roll-dice",
  "custom-damage-dice",
  "custom-ability-modifier",
  "custom-critical-limit",
  "critical-homebrew",
  "roll-type-global", // duplicates the app's own Adv / Normal / Dis control
  "versatile-choice",
  "toll-choice",
  // These add-dice features have no parseable die in their catalog prose, so the generic mapper
  // would inject a phantom 1d6. They either SPEND dice (add none) or use an off-prose die — hide
  // them rather than roll a wrong bonus. (Sneak Attack is modeled correctly in SPECIAL_EFFECTS.)
  "rogue-cunning-strike",   // spends sneak-attack dice — adds nothing
  "bard-psychic-blades",    // variable, spends Bardic Inspiration
  "ranger-favored-foe",     // 1d4, not derivable from prose
  "ranger-planar-warrior",  // 1d8, not derivable from prose
  "ranger-gathered-swarm",  // 1d4, not derivable from prose
]);

/** Toggle rules this character+roll can enable (what a UI would present). */
export function listAvailableToggles(
  data: CharacterData,
  rollModel: RollModel,
  request: RollRequest,
): Rule[] {
  return RULES.filter((r) => {
    if (!r.toggle || CONFIG_ONLY_IDS.has(r.id)) return false;
    if (/^condition-/.test(r.id)) return false; // conditions have their own chip UI, not Roll Options
    if (!r.appliesTo(data, request)) return false;
    // Safety net: hide any toggle that resolves to no real effect for this roll,
    // so a checkbox never appears that would visibly do nothing when ticked.
    try {
      return r.toEffects(data, rollModel, request).length > 0;
    } catch {
      return false;
    }
  });
}

/**
 * Resolve concrete effects for a roll:
 *   (a) automatic rules (toggle=false) whose appliesTo() is true, plus
 *   (b) explicitly enabled toggles (by id).
 */
export function resolveEffects(
  data: CharacterData,
  rollModel: RollModel,
  request: RollRequest,
  enabledToggleIds: string[],
): RuleEffect[] {
  const enabled = new Set(enabledToggleIds);
  const effects: RuleEffect[] = [];

  for (const rule of RULES) {
    if (rule.toggle) {
      // (b) user-enabled toggles — trust the explicit enable, but never resolve a
      // config-only placeholder (see CONFIG_ONLY_IDS) even if one is somehow enabled.
      if (enabled.has(rule.id) && !CONFIG_ONLY_IDS.has(rule.id)) {
        effects.push(...rule.toEffects(data, rollModel, request));
      }
    } else {
      // (a) automatic rules — only when they apply to this character+roll.
      if (rule.appliesTo(data, request)) {
        effects.push(...rule.toEffects(data, rollModel, request));
      }
    }
  }

  return effects;
}
