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
import { editionOf, type Edition, type SourcedDef } from "../engine/edition.js";

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

/** true if any candidate name matches `target`: equal, or the candidate contains the target as whole
 *  words ("Brutal Critical (2 dice)" has "Brutal Critical"). Whole words, so "Aura of Courage" doesn't
 *  have "Rage". With `either`, the target may also contain the candidate — only for species traits,
 *  whose catalog names carry the species ("Bugbear Surprise Attack" ↔ trait "Surprise Attack"). It is
 *  NOT used for class features: "Improved Divine Smite" contains "Divine Smite", which every Paladin has. */
function hasNamed(candidates: string[], target: string, either = false): boolean {
  const t = norm(target);
  if (!t) return false;
  const within = (outer: string, inner: string) => ` ${outer} `.includes(` ${inner} `);
  return candidates.some((c) => {
    const cn = norm(c);
    return !!cn && (within(cn, t) || (either && within(t, cn)));
  });
}

/** A catalog ownership name, cleaned: a compound "Hunter's Prey: Colossus Slayer" names the chosen
 *  option (the last part), and a trailing "(paladin-sacred-weapon" style note is dropped. */
function catalogName(raw: string): string {
  const parts = raw.replace(/\s*\(.*$/, "").split(":");
  return parts[parts.length - 1]!.trim();
}

// ---------------------------------------------------------------------------
// Owned feats / features / options, with their rules edition (see engine/edition.ts)
// ---------------------------------------------------------------------------
interface Named { name: string; edition: Edition }

function named(defs: Array<SourcedDef | null | undefined>): Named[] {
  return defs.filter((d): d is SourcedDef => !!d?.name).map((d) => ({ name: d.name!, edition: editionOf(d) }));
}

/** Names of the owned items that fit `edition` (null = either). */
function ofEdition(items: Named[], edition: Edition | null): string[] {
  return items.filter((i) => !edition || i.edition === edition).map((i) => i.name);
}

function feats(data: CharacterData): Named[] {
  return named((data.feats ?? []).map((f) => f?.definition as SourcedDef | undefined));
}

/** Class and subclass features the character HAS. D&D Beyond lists every feature of the class up to
 *  20th level, so keep only those at or below the class's level — otherwise a 6th-level Paladin "has"
 *  Improved Divine Smite (11th) and a 3rd-level Champion "has" Superior Critical (15th). */
function features(data: CharacterData): Named[] {
  // Tasha's optional class features: D&D Beyond records each one taken and the feature it REPLACES
  // (Favored Foe for Favored Enemy, Deft Explorer for Natural Explorer). The replaced feature is gone;
  // the chosen one's definition isn't in the character data, but its action is, under its name.
  const optional = (data as { optionalClassFeatures?: { classFeatureId?: number; affectedClassFeatureId?: number | null }[] }).optionalClassFeatures ?? [];
  const replaced = new Set(optional.map((o) => o.affectedClassFeatureId).filter((n): n is number => typeof n === "number"));
  const defs: Array<SourcedDef | null | undefined> = [];
  for (const c of data.classes ?? []) {
    defs.push(c?.subclassDefinition as SourcedDef | undefined);
    for (const f of c?.classFeatures ?? []) {
      const def = f?.definition as (SourcedDef & { id?: number; requiredLevel?: number }) | undefined;
      if (typeof def?.requiredLevel === "number" && def.requiredLevel > (c.level ?? 0)) continue;
      if (typeof def?.id === "number" && replaced.has(def.id)) continue;
      defs.push(def);
    }
  }
  const chosen = new Set(optional.map((o) => o.classFeatureId));
  const actions = (data as { actions?: Record<string, { componentId?: number; name?: string }[] | null> }).actions ?? {};
  const optionalNamed: Named[] = Object.values(actions).flatMap((arr) => arr ?? [])
    .filter((a) => chosen.has(a.componentId) && a.name)
    .map((a) => ({ name: a.name!, edition: "2014" as Edition })); // optional class features are Tasha's (2014)
  return [...named(defs), ...optionalNamed];
}

/** Chosen options (a 2014 Fighting Style is an option of the "Fighting Style" feature). */
function options(data: CharacterData): Named[] {
  const opts = (data as unknown as { options?: Record<string, Array<{ definition?: SourcedDef | null } | null> | null> }).options ?? {};
  return named(Object.values(opts).flatMap((arr) => (arr ?? []).map((o) => o?.definition)));
}

function featNames(data: CharacterData): string[] {
  return feats(data).map((f) => f.name);
}

function featureNames(data: CharacterData): string[] {
  return features(data).map((f) => f.name);
}

// Catalog entries for the 2014 version of a feat/feature whose 2024 version shares its name (or
// has no catalog entry because it works differently, e.g. 2024 Sharpshooter has no -5/+10).
const LEGACY_RULES = new Set([
  "great-weapon-master",
  "sharpshooter",
  "champion-remarkable-athlete", // 2024: advantage on Initiative and Athletics instead
  "rogue-assassinate",
  "cleric-blessed-strikes-tasha",
  "cleric-divine-strike", // 2024: the Blessed Strikes option of the same name
]);

/** The rules edition a catalog entry is written for (null = both), and its ownership name minus
 *  any "2024" tag ("Great Weapon Master 2024" → "Great Weapon Master"). */
function ruleEdition(entry: RawEntry, name?: string): Edition | null {
  if (/-2024$/.test(entry.id) || (name && /\b2024\b/.test(name))) return "2024";
  if (/-2014$/.test(entry.id) || LEGACY_RULES.has(entry.id)) return "2014";
  return null;
}
const untagged = (name: string) => name.replace(/\b2024\b/g, " ").replace(/\s+/g, " ").trim();

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
  if (featM && featM[1]) return hasNamed(ofEdition(feats(data), ruleEdition(entry, featM[1])), untagged(featM[1]));

  // Great Weapon Fighting: a 2014 Fighting Style option (reroll 1s and 2s) or a 2024 Fighting Style
  // feat (1s and 2s count as 3). Each catalog entry applies only to its own edition, so a character
  // gets exactly one of them.
  if (/hasGreatWeaponFighting/i.test(cond)) {
    const owned = [...feats(data), ...features(data), ...options(data)];
    return hasNamed(ofEdition(owned, ruleEdition(entry)), "Great Weapon Fighting");
  }

  // Class features include chosen options (Hunter's Prey → Colossus Slayer, Blessed Strikes → Divine
  // Strike), since the catalog often names the option.
  const cfM = cond.match(/hasClassFeature\s*\(?\s*['"]?([^'")]+)/i);
  if (cfM && cfM[1]) {
    const owned = ofEdition([...features(data), ...options(data)], ruleEdition(entry, cfM[1]));
    return hasNamed(owned, catalogName(untagged(cfM[1])));
  }

  const rtM = cond.match(/hasRacialTrait\s*\(?\s*['"]?([^'")]+)/i);
  if (rtM && rtM[1]) return hasNamed(traitNames(data), rtM[1], true);

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
    if (/racial trait/i.test(cond)) return quoted.some((q) => hasNamed(traitNames(data), q, true));
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

// What a roll's weapon is (see RollRequest.weapon) — absent for spells and other attacks.
const twoHandedMelee = (r: RollRequest) => !!r.weapon?.melee && r.weapon.twoHanded;
const strengthAttack = (r: RollRequest) => r.weapon?.ability === "STR";
/** The weapon's damage die size, from its damage formula ("1d12 + 4" → 12). */
const weaponDie = (r: RollRequest) => Number(/\d*d(\d+)/.exec(r.baseDamage ?? "")?.[1] ?? 0);
/** Dice that grow with a class level: [[minLevel, dice], …] highest first. */
const byLevel = (lvl: number, steps: [number, string][]) => steps.find(([min]) => lvl >= min)?.[1] ?? steps[steps.length - 1]![1];

const SPECIAL_EFFECTS: Record<string, EffectBuilder> = {
  // Rage: +2/+3/+4 damage (Barbarian 1/9/16) on attacks using Strength — not spells or DEX weapons.
  "barbarian-rage": (data, _m, request) => {
    const lvl = classLevel(data, "Barbarian");
    if (!lvl || !strengthAttack(request)) return [];
    return [{ op: "flat", target: "damage", value: lvl >= 16 ? 4 : lvl >= 9 ? 3 : 2, label: "Rage" }];
  },
  // Zealot's Divine Fury: 1d6 + half your Barbarian level, first hit each turn while raging.
  "barbarian-divine-fury": (data) => {
    const lvl = classLevel(data, "Barbarian");
    return [
      { op: "add-dice", target: "damage", dice: "1d6", label: "Divine Fury" },
      { op: "flat", target: "damage", value: Math.floor(lvl / 2), label: "Divine Fury" },
    ];
  },
  // Brutal Strike (2024): 1d10, 2d10 from Improved Brutal Strike at Barbarian 17.
  "brutal-strike": (data) => [
    { op: "add-dice", target: "damage", dice: byLevel(classLevel(data, "Barbarian"), [[17, "2d10"], [0, "1d10"]]), label: "Brutal Strike" },
  ],
  // Divine Strike (2014 domains) and the 2024 Blessed Strikes option: 1d8, 2d8 at Cleric 14.
  "cleric-divine-strike": (data) => [
    { op: "add-dice", target: "damage", dice: byLevel(classLevel(data, "Cleric"), [[14, "2d8"], [0, "1d8"]]), label: "Divine Strike" },
  ],
  "cleric-blessed-strikes": (data) => [
    { op: "add-dice", target: "damage", dice: byLevel(classLevel(data, "Cleric"), [[14, "2d8"], [0, "1d8"]]), label: "Divine Strike" },
  ],
  // Rune Knight's Giant's Might: 1d6, 1d8 at Fighter 10, 1d10 at 18.
  "fighter-giant-might": (data) => [
    { op: "add-dice", target: "damage", dice: byLevel(classLevel(data, "Fighter"), [[18, "1d10"], [10, "1d8"], [0, "1d6"]]), label: "Giant's Might" },
  ],
  // Favored Foe (Tasha's): 1d4, 1d6 at Ranger 6, 1d8 at 14.
  "ranger-favored-foe": (data) => [
    { op: "add-dice", target: "damage", dice: byLevel(classLevel(data, "Ranger"), [[14, "1d8"], [6, "1d6"], [0, "1d4"]]), label: "Favored Foe" },
  ],
  // Charger: 2014 +5 damage; 2024 +1d8 (once per turn).
  "charger-feat": (data) => {
    const f = feats(data).find((n) => hasNamed([n.name], "Charger"));
    return f?.edition === "2014"
      ? [{ op: "flat", target: "damage", value: 5, label: "Charger" }]
      : [{ op: "add-dice", target: "damage", dice: "1d8", label: "Charger" }];
  },
  // Lifedrinker (Pact of the Blade invocation) on a pact-weapon hit: 2014 +CHA necrotic; 2024 +1d6
  // necrotic/psychic/radiant once per turn. Its catalog condition only names "Warlock", so check the
  // invocation is actually taken; weapon attacks only.
  "eldritch-invocation-lifedrinker": (data, rollModel, request) => {
    const inv = options(data).find((o) => hasNamed([o.name], "Lifedrinker"));
    if (!inv || !request.weapon) return [];
    return inv.edition === "2014"
      ? [{ op: "flat", target: "damage", value: rollModel.abilities.CHA.mod, label: "Lifedrinker" }]
      : [{ op: "add-dice", target: "damage", dice: "1d6", label: "Lifedrinker" }];
  },
  // Assassinate (2024): advantage in the first round, and a Sneak Attack hit then adds your Rogue level.
  "rogue-assassinate-2024": (data) => [
    { op: "advantage", target: "attack", mode: "advantage", label: "Assassinate" },
    { op: "flat", target: "damage", value: classLevel(data, "Rogue"), label: "Assassinate" },
  ],
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
  // Great Weapon Fighting only touches a melee weapon held in two hands — not spells, bows or a
  // one-handed swing.
  "great-weapon-fighting-2014": (_d, _m, request) => twoHandedMelee(request) ? [
    { op: "reroll", target: "damage", threshold: 2, label: "Great Weapon Fighting" },
  ] : [],
  "great-weapon-fighting-2024": (_d, _m, request) => twoHandedMelee(request) ? [
    { op: "min-die", target: "damage", min: 3, label: "Great Weapon Fighting" },
  ] : [],
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
  // Gloom Stalker's extra hit: 2014 Dread Ambusher adds 1d8; the 2024 Dreadful Strike adds 2d6 Psychic.
  // One catalog entry covers both, and the generic mapper read its prose as 1d6 — so pick by edition.
  "ranger-dread-ambusher": (data) => {
    const f = features(data).find((n) => hasNamed([n.name], "Dread Ambusher"));
    return [{ op: "add-dice", target: "damage", dice: f?.edition === "2014" ? "1d8" : "2d6", label: "Dread Ambusher" }];
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

// Brutal Critical (2014 Barbarian 9/13/17: 1/2/3 dice) and Savage Attacks (2014 Half-Orc: 1 die) add
// extra WEAPON damage dice to a melee crit — rolled once, on the crit only. Automatic: it applies
// whenever you roll a crit, rather than being a box to remember to tick.
const BRUTAL_CRITICAL: Rule = {
  id: "brutal-critical-auto",
  name: "Brutal Critical / Savage Attacks",
  kind: "add-dice",
  target: "damage",
  toggle: false,
  condition: "hasClassFeature('Brutal Critical') or hasRacialTrait('Savage Attacks'), on a melee weapon crit",
  appliesTo(data, request) {
    return !!request.crit && !!request.weapon?.melee && brutalDice(data) > 0;
  },
  toEffects(data, _m, request) {
    const n = brutalDice(data), die = weaponDie(request);
    return n && die ? [{ op: "add-dice", target: "damage", dice: `${n}d${die}`, critOnly: true, label: "Brutal Critical" }] : [];
  },
};
function brutalDice(data: CharacterData): number {
  const lvl = classLevel(data, "Barbarian");
  const brutal = hasNamed(ofEdition(features(data), "2014"), "Brutal Critical") ? (lvl >= 17 ? 3 : lvl >= 13 ? 2 : 1) : 0;
  return brutal + (hasNamed(traitNames(data), "Savage Attacks") ? 1 : 0);
}

export const RULES: Rule[] = [
  ...CATALOG.map(toRule),
  ELVEN_ACCURACY,
  SAVAGE_ATTACKER,
  BRUTAL_CRITICAL,
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
  "brutal-critical", // replaced by the automatic BRUTAL_CRITICAL rule (crit-only weapon dice)
  // Exhaustion comes from the character's Exhaustion condition and its level (exhaustionEffects in
  // engine/conditions.ts); a separate level-less toggle would double-count it.
  "effects-exhaustion-2024",
  "effects-exhaustion-2014",
  "versatile-choice",
  "toll-choice",
  // These add-dice features have no parseable die in their catalog prose, so the generic mapper
  // would inject a phantom 1d6. They either SPEND dice (add none) or use an off-prose die — hide
  // them rather than roll a wrong bonus. (Sneak Attack is modeled correctly in SPECIAL_EFFECTS.)
  "rogue-cunning-strike",   // spends sneak-attack dice — adds nothing
  "bard-psychic-blades",    // variable, spends Bardic Inspiration
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
