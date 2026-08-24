// Static D&D 5e WEAPON / ATTACK computation from a D&D Beyond character-service v5
// `data` object plus the already-computed RollModel. Pure (JSON in -> Weapon[] out),
// no DOM / network. Sources: inventory weapons, custom weapon *actions*, and a
// synthetic Unarmed Strike.
//
// Output maps cleanly onto the compose layer's attack contract:
//   baseAttackMod  <- Weapon.attackMod
//   baseDamage     <- `${damageDice}` (+ damageMod) with damageType
//
// This module NEVER mutates the RollModel or the input data.

import type { Ability, CharacterData, Modifier, RollModel } from './types';

export interface Weapon {
  name: string;
  /** Ability used for the attack/damage (STR, DEX, or — for custom actions — the action's stat). */
  attackAbility: Ability;
  /** Total to-hit bonus: abilityMod + (proficient?prof:0) + magicBonus + fightingStyleAttackBonus. */
  attackMod: number;
  /** Dice portion of damage, e.g. '1d8'. Unarmed Strike is the flat string '1'. */
  damageDice: string;
  /** Flat damage bonus: abilityMod + magicBonus + fightingStyleDamageBonus. */
  damageMod: number;
  damageType: string;
  /** Normalized weapon-property names, e.g. ['Finesse','Light','Thrown']. */
  properties: string[];
  proficient: boolean;
  /** Magic enhancement (+1/+2/+3); added to BOTH attackMod and damageMod. */
  magicBonus: number;
  /** Human-readable range, e.g. '5 ft' or '80/320 ft'. */
  range?: string;
  /** Two-handed damage dice for Versatile weapons, e.g. '1d10'. */
  versatileDamage?: string;
  /** the weapon/action's wording (raw DDB HTML — sanitized at display time) — for "Display in VTT". */
  description?: string;
  source: 'inventory' | 'action' | 'unarmed';
}

// ---- D&D Beyond stat/damage-type id maps ----

const STAT_ID_TO_ABILITY: Record<number, Ability> = {
  1: 'STR',
  2: 'DEX',
  3: 'CON',
  4: 'INT',
  5: 'WIS',
  6: 'CHA',
};

// DDB damageTypeId -> name (verified against the Aldric fixture: 7=Fire, 13=Force).
const DAMAGE_TYPE_BY_ID: Record<number, string> = {
  1: 'Bludgeoning',
  2: 'Piercing',
  3: 'Slashing',
  4: 'Necrotic',
  5: 'Acid',
  6: 'Cold',
  7: 'Fire',
  8: 'Lightning',
  9: 'Thunder',
  10: 'Poison',
  11: 'Psychic',
  12: 'Radiant',
  13: 'Force',
};

// DDB weapon categoryId -> proficiency subType.
const CATEGORY_ID_TO_PROF: Record<number, string> = {
  1: 'simple-weapons',
  2: 'martial-weapons',
};

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * DDB display names are comma-inverted ("Crossbow, Light", "Crossbow, Hand"),
 * but proficiency subTypes use natural order ("light-crossbow"). Reorder a
 * single comma-inverted name into natural order ("Crossbow, Light" -> "Light
 * Crossbow") so it kebab-matches the proficiency subType. Names without a comma
 * pass through unchanged.
 */
function uninvertName(name: string): string {
  const idx = name.indexOf(',');
  if (idx < 0) return name;
  const base = name.slice(0, idx).trim();
  const qualifier = name.slice(idx + 1).trim();
  if (!base || !qualifier) return name.replace(/,/g, ' ').trim();
  return `${qualifier} ${base}`;
}

/** Flatten every modifier bucket into a single list (all buckets scanned). */
function allModifiers(data: CharacterData): Modifier[] {
  const out: Modifier[] = [];
  for (const arr of Object.values(data.modifiers ?? {})) {
    if (Array.isArray(arr)) out.push(...arr);
  }
  return out;
}

/** Set of every `proficiency` subType the character has (weapon categories + specific weapons). */
function weaponProficiencySet(data: CharacterData): Set<string> {
  const set = new Set<string>();
  for (const m of allModifiers(data)) {
    if (m.type === 'proficiency' && typeof m.subType === 'string') set.add(m.subType);
  }
  return set;
}

interface FightingStyles {
  archery: boolean;
  dueling: boolean;
  greatWeaponFighting: boolean;
  twoWeaponFighting: boolean;
  defense: boolean;
}

/** Detect fighting styles by name across modifiers, options, features, and feats. */
function detectFightingStyles(data: CharacterData): FightingStyles {
  const names: string[] = [];
  const push = (s?: string | null) => {
    if (typeof s === 'string' && s) names.push(s.toLowerCase());
  };

  for (const m of allModifiers(data)) {
    push(m.subType);
    push(m.friendlySubtypeName);
  }
  // options / features / feats are loosely-typed extras on the DDB payload.
  const anyData = data as unknown as Record<string, unknown>;
  const scanDefs = (v: unknown) => {
    if (!v) return;
    const arrs: unknown[] = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const entry of arrs) {
      if (Array.isArray(entry)) {
        for (const e of entry) push((e as { definition?: { name?: string } })?.definition?.name);
      } else {
        push((entry as { definition?: { name?: string } })?.definition?.name);
      }
    }
  };
  scanDefs(anyData.options);
  scanDefs(anyData.features);
  scanDefs(anyData.feats);

  const has = (needle: string) => names.some((n) => n.includes(needle));
  return {
    archery: has('archery'),
    dueling: has('dueling'),
    greatWeaponFighting: has('great weapon fighting') || has('great-weapon-fighting'),
    twoWeaponFighting: has('two-weapon fighting') || has('two-weapon-fighting'),
    defense: has('defense'),
  };
}

/** Normalize a DDB properties[] array (each `{name}`) to a string[]. */
function normalizeProperties(props: unknown): string[] {
  if (!Array.isArray(props)) return [];
  const out: string[] = [];
  for (const p of props) {
    const name = (p as { name?: string })?.name;
    if (typeof name === 'string' && name) out.push(name);
  }
  return out;
}

function hasProp(props: string[], name: string): boolean {
  return props.some((p) => p.toLowerCase() === name.toLowerCase());
}

/** Versatile two-handed dice live in the Versatile property's `notes`. */
function versatileFrom(props: unknown): string | undefined {
  if (!Array.isArray(props)) return undefined;
  for (const p of props) {
    const pp = p as { name?: string; notes?: string };
    if (pp?.name?.toLowerCase() === 'versatile' && typeof pp.notes === 'string' && pp.notes.trim()) {
      return pp.notes.trim();
    }
  }
  return undefined;
}

/**
 * Magic enhancement of an inventory item. A DDB +N weapon carries the
 * enhancement exactly once: it may surface as a granted `bonus`/`magic`
 * modifier OR as a numeric `def.bonus`, and on some items BOTH are populated
 * with the same value. Use the granted-modifier total when present, otherwise
 * fall back to `def.bonus` — never sum the two (that double-counts).
 */
function itemMagicBonus(def: Record<string, unknown>): number {
  let grantedBonus = 0;
  let sawGranted = false;
  const granted = def.grantedModifiers;
  if (Array.isArray(granted)) {
    for (const m of granted) {
      const mm = m as { type?: string; subType?: string; value?: number };
      if (mm.type === 'bonus' && mm.subType === 'magic' && typeof mm.value === 'number') {
        grantedBonus += mm.value;
        sawGranted = true;
      }
    }
  }
  if (sawGranted) return grantedBonus;
  if (typeof def.bonus === 'number') return def.bonus;
  return 0;
}

/** Pick the attack ability for an inventory weapon per 5e rules. */
function weaponAbility(
  isRanged: boolean,
  isFinesse: boolean,
  model: RollModel,
): Ability {
  if (isFinesse) {
    // Finesse: use whichever of STR/DEX has the higher modifier.
    return model.abilities.DEX.mod >= model.abilities.STR.mod ? 'DEX' : 'STR';
  }
  return isRanged ? 'DEX' : 'STR';
}

function rangeString(range: unknown, longRange: unknown): string | undefined {
  const r = typeof range === 'number' ? range : undefined;
  const lr = typeof longRange === 'number' ? longRange : undefined;
  if (r == null) return undefined;
  if (lr != null && lr !== r) return `${r}/${lr} ft`;
  return `${r} ft`;
}

// ---- Inventory weapons ----

function computeInventoryWeapons(data: CharacterData, model: RollModel): Weapon[] {
  const inventory = (data as unknown as { inventory?: unknown[] }).inventory ?? [];
  const profSet = weaponProficiencySet(data);
  const styles = detectFightingStyles(data);
  const out: Weapon[] = [];

  for (const rawItem of inventory) {
    const item = rawItem as { definition?: Record<string, unknown> };
    const def = item.definition;
    if (!def) continue;

    const isWeapon =
      def.filterType === 'Weapon' ||
      /weapon/i.test(String(def.type ?? '')) ||
      /weapon/i.test(String(def.subType ?? ''));
    if (!isWeapon) continue;

    const damage = def.damage as { diceString?: string } | null | undefined;
    const diceString = damage?.diceString;
    // Skip non-attacking weapon-filtered items (ammunition like "Crossbow Bolts").
    if (!diceString) continue;

    const properties = normalizeProperties(def.properties);
    const isFinesse = hasProp(properties, 'Finesse');
    // attackType: 1 = melee, 2 = ranged. Also treat Ammunition/Range as ranged.
    const isRanged =
      def.attackType === 2 ||
      hasProp(properties, 'Ammunition') ||
      hasProp(properties, 'Range');

    const ability = weaponAbility(isRanged, isFinesse, model);
    const abilityMod = model.abilities[ability].mod;

    // Proficiency: weapon-category match, firearm match, or specific weapon name.
    const categoryProf = CATEGORY_ID_TO_PROF[Number(def.categoryId)];
    const rawName = String(def.name ?? '');
    // Match the specific-weapon proficiency against BOTH the literal display
    // name and its comma-uninverted form ("Crossbow, Light" -> "light-crossbow").
    const nameKebabs = new Set<string>([kebab(rawName), kebab(uninvertName(rawName))]);
    const tags = Array.isArray(def.tags) ? (def.tags as unknown[]).map((t) => String(t)) : [];
    const looksFirearm =
      tags.some((t) => /firearm/i.test(t)) ||
      /firearm/i.test(String(def.type ?? '')) ||
      /firearm/i.test(String(def.subType ?? ''));
    const proficient =
      (categoryProf != null && profSet.has(categoryProf)) ||
      (looksFirearm && profSet.has('firearms')) ||
      [...nameKebabs].some((nk) => profSet.has(nk));

    const magicBonus = itemMagicBonus(def);

    // Fighting-style bonuses that deterministically apply.
    let fsAttack = 0;
    let fsDamage = 0;
    if (styles.archery && isRanged) fsAttack += 2;
    // Dueling: one-handed melee weapon (not Two-Handed). "No other weapon" is loadout-
    // dependent; apply the deterministic melee/one-handed portion.
    if (styles.dueling && !isRanged && !hasProp(properties, 'Two-Handed')) fsDamage += 2;

    const attackMod =
      abilityMod + (proficient ? model.profBonus : 0) + magicBonus + fsAttack;
    const damageMod = abilityMod + magicBonus + fsDamage;

    const damageType =
      typeof def.damageType === 'string' && def.damageType ? String(def.damageType) : 'Untyped';

    const w: Weapon = {
      name: String(def.name ?? 'Weapon'),
      attackAbility: ability,
      attackMod,
      damageDice: diceString,
      damageMod,
      damageType,
      properties,
      proficient,
      magicBonus,
      source: 'inventory',
    };
    const rng = rangeString(def.range, def.longRange);
    if (rng) w.range = rng;
    const wDef = def as unknown as { description?: string; snippet?: string };
    const wText = wDef.description || wDef.snippet;
    if (wText && String(wText).trim()) w.description = String(wText);
    if (hasProp(properties, 'Versatile')) {
      const vd = versatileFrom(def.properties);
      if (vd) w.versatileDamage = vd;
    }
    out.push(w);
  }
  return out;
}

// ---- Custom weapon actions ----

function computeActionWeapons(data: CharacterData, model: RollModel): Weapon[] {
  const actions = (data as unknown as { actions?: Record<string, unknown[]> }).actions ?? {};
  const out: Weapon[] = [];

  for (const arr of Object.values(actions)) {
    if (!Array.isArray(arr)) continue;
    for (const rawAction of arr) {
      const a = rawAction as Record<string, unknown>;
      const dice = a.dice as { diceString?: string } | null | undefined;
      const diceString = dice?.diceString;
      // Only real attack-roll actions: a to-hit (attackTypeRange 1=melee, 2=ranged),
      // damage dice, AND a real damage type. Support actions that merely grant a
      // benefit (e.g. "Eldritch Cannon: Protector" -> Temp HP) carry dice and a
      // range flag but no damageTypeId, and must NOT be emitted as fake attacks.
      const atr = a.attackTypeRange;
      if (!diceString || (atr !== 1 && atr !== 2) || a.damageTypeId == null) continue;

      const statId = typeof a.abilityModifierStatId === 'number' ? a.abilityModifierStatId : undefined;
      const ability: Ability = (statId != null && STAT_ID_TO_ABILITY[statId]) || 'DEX';
      const abilityMod = model.abilities[ability].mod;
      const proficient = a.isProficient === true;

      // Custom action to-hit. `fixedToHit` is DDB's authored TOTAL to-hit override;
      // when present it REPLACES the ability+prof computation (do not add to it).
      // Otherwise: ability mod + prof (if proficient). Damage is the dice as
      // authored (DDB does not auto-add the ability mod to cannon damage).
      const attackMod =
        typeof a.fixedToHit === 'number'
          ? a.fixedToHit
          : abilityMod + (proficient ? model.profBonus : 0);
      const damageMod = 0;

      const damageType = DAMAGE_TYPE_BY_ID[Number(a.damageTypeId)] ?? 'Untyped';
      const rangeObj = a.range as { range?: number; longRange?: number } | null | undefined;

      const w: Weapon = {
        name: String(a.name ?? 'Action'),
        attackAbility: ability,
        attackMod,
        damageDice: diceString,
        damageMod,
        damageType,
        properties: [],
        proficient,
        magicBonus: 0,
        source: 'action',
      };
      const rng = rangeString(rangeObj?.range, rangeObj?.longRange);
      if (rng) w.range = rng;
      const aText = (a as unknown as { description?: string; snippet?: string });
      const aWording = aText.description || aText.snippet;
      if (aWording && String(aWording).trim()) w.description = String(aWording);
      out.push(w);
    }
  }
  return out;
}

// ---- Unarmed Strike ----

function unarmedStrike(model: RollModel): Weapon {
  const strMod = model.abilities.STR.mod;
  // Unarmed Strike: 1 + STR mod bludgeoning; every character is proficient.
  return {
    name: 'Unarmed Strike',
    attackAbility: 'STR',
    attackMod: strMod + model.profBonus,
    damageDice: '1',
    damageMod: strMod,
    damageType: 'Bludgeoning',
    properties: [],
    proficient: true,
    magicBonus: 0,
    range: '5 ft',
    source: 'unarmed',
  };
}

// TODO: Two-Weapon Fighting / off-hand damage is not modeled — it needs a
// main-/off-hand loadout concept the engine doesn't yet have. Great Weapon
// Fighting (dice-level reroll) is likewise deferred and handled in the compose
// layer. Dueling-on-versatile is an accepted approximation and left as-is.

/**
 * Compute the full weapon/attack list for a character.
 * Pure: does not mutate `data` or `model`.
 */
export function computeWeapons(data: CharacterData, model: RollModel): Weapon[] {
  return [
    ...computeInventoryWeapons(data, model),
    ...computeActionWeapons(data, model),
    unarmedStrike(model),
  ];
}
