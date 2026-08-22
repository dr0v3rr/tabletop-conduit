// Spellcasting computation for the D&D 5e roll engine.
// Pure (JSON in -> SpellcastingInfo out), no DOM / network.
// Consumes the D&D Beyond character-service v5 `data` object (spells.* buckets and
// classSpells[]) plus a computed RollModel, and produces a flat, roll-ready spell list.

import type { Ability, CharacterData, RollModel } from './types';
import { evalDdbTokens } from '../ddb-tokens';

// ---- Local input shapes (fields we read off DDB spell data). ----
// CharacterData (types.ts) intentionally does not declare these, so we describe the
// subset we need here and structurally narrow the incoming `data`.

interface DdbDie {
  diceCount?: number | null;
  diceValue?: number | null;
  diceString?: string | null;
  fixedValue?: number | null;
}

interface HigherLevelDefinition {
  level?: number | null;
  dice?: DdbDie | null;
  value?: number | null;
}

interface SpellDamageModifier {
  type?: string | null;
  subType?: string | null;
  die?: DdbDie | null;
  dice?: DdbDie | null;
  fixedValue?: number | null;
  friendlySubtypeName?: string | null;
  atHigherLevels?: { higherLevelDefinitions?: HigherLevelDefinition[] | null } | null;
}

interface SpellDefinition {
  name?: string;
  level?: number;
  school?: string | null;
  requiresAttackRoll?: boolean | null;
  requiresSavingThrow?: boolean | null;
  saveDcAbilityId?: number | null;
  canCastAtHigherLevel?: boolean | null;
  scaleType?: string | null;
  modifiers?: SpellDamageModifier[] | null;
}

interface SpellEntry {
  definition?: SpellDefinition | null;
  spellCastingAbilityId?: number | null;
}

interface ClassSpellGroup {
  characterClassId?: number | null;
  spells?: SpellEntry[] | null;
}

interface SpellSourceData {
  spells?: Record<string, SpellEntry[] | null> | null;
  classSpells?: ClassSpellGroup[] | null;
}

// ---- Output shapes ----

export interface SpellcastingClassInfo {
  className: string;
  ability: Ability;
  attackBonus: number;
  saveDc: number;
}

export interface SpellDamage {
  dice: string;
  type?: string;
}

export interface Spell {
  name: string;
  level: number;
  school?: string;
  casting: 'attack' | 'save' | 'utility';
  /** healing roll formula (die + caster ability mod), e.g. "2d8 + 4" — for Cure Wounds etc. */
  healDice?: string;
  attackBonus?: number;
  saveAbility?: Ability;
  saveDc?: number;
  damageDice?: string;
  damageType?: string;
  /**
   * Every damage component of the spell (a spell can deal two damage types, e.g. Ice Knife).
   * `damageDice`/`damageType` mirror the first (primary) entry here for back-compat.
   */
  damages?: SpellDamage[];
  scalesWithLevel?: boolean;
  atHigherLevels?: string;
  isCantrip: boolean;
  /** requires Concentration to maintain. */
  concentration?: boolean;
  /** can be cast as a Ritual. */
  ritual?: boolean;
  /** casting time bucket, from DDB activationType (1=action, 3=bonus, 4=reaction). */
  castingTime?: 'action' | 'bonus' | 'reaction' | 'other';
}

export interface SpellcastingInfo {
  classes: SpellcastingClassInfo[];
  spells: Spell[];
}

const STAT_ID_TO_ABILITY: Record<number, Ability> = {
  1: 'STR',
  2: 'DEX',
  3: 'CON',
  4: 'INT',
  5: 'WIS',
  6: 'CHA',
};

// Fallback class -> spellcasting ability when the class definition omits the stat id.
const CLASS_TO_ABILITY: Record<string, Ability> = {
  artificer: 'INT',
  wizard: 'INT',
  cleric: 'WIS',
  druid: 'WIS',
  ranger: 'WIS',
  bard: 'CHA',
  paladin: 'CHA',
  sorcerer: 'CHA',
  warlock: 'CHA',
};

function abilityForStatId(id: number | null | undefined): Ability | undefined {
  return id == null ? undefined : STAT_ID_TO_ABILITY[id];
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Resolve a class's spellcasting ability from its definition stat id, else the name table. */
function classSpellcastingAbility(
  name: string,
  spellCastingAbilityId: number | null | undefined,
): Ability | undefined {
  return abilityForStatId(spellCastingAbilityId) ?? CLASS_TO_ABILITY[name.toLowerCase()];
}

/** Every damage modifier for a spell (each `type: 'damage'` entry), in declaration order. */
function allDamage(def: SpellDefinition): SpellDamageModifier[] {
  return (def.modifiers ?? []).filter((m): m is SpellDamageModifier => m?.type === 'damage');
}

/** The primary damage modifier for a spell (first `type: 'damage'` entry), if any. */
function primaryDamage(def: SpellDefinition): SpellDamageModifier | undefined {
  return allDamage(def)[0];
}

/** Healing modifier — DDB encodes healing as `type:'bonus', subType:'hit-points'` with a die. */
function primaryHeal(def: SpellDefinition): SpellDamageModifier | undefined {
  return (def.modifiers ?? []).find(
    (m): m is SpellDamageModifier =>
      m?.type === 'bonus' && (m as { subType?: string }).subType === 'hit-points' && !!(m as { die?: DdbDie }).die,
  );
}

function dieString(die: DdbDie | null | undefined): string | undefined {
  if (!die) return undefined;
  if (typeof die.diceString === 'string' && die.diceString.trim() !== '') return die.diceString;
  if (typeof die.diceCount === 'number' && typeof die.diceValue === 'number') {
    return `${die.diceCount}d${die.diceValue}`;
  }
  return undefined;
}

/**
 * Cantrip damage die at a given CHARACTER level. DDB encodes the scaling as
 * `characterlevel` higher-level-definitions keyed by absolute level (5/11/17).
 * Picks the highest applicable definition, else the base die.
 */
function cantripDamageDice(
  mod: SpellDamageModifier,
  characterLevel: number,
  base: string | undefined,
): string | undefined {
  const defs = mod.atHigherLevels?.higherLevelDefinitions ?? [];
  let best: string | undefined = base;
  let bestLevel = 0;
  for (const hl of defs) {
    const lvl = hl?.level ?? 0;
    if (lvl <= characterLevel && lvl >= bestLevel) {
      const ds = dieString(hl.dice);
      if (ds) {
        best = ds;
        bestLevel = lvl;
      }
    }
  }
  return best;
}

/** Build human-readable at-higher-levels text for a leveled (`spellscale`) spell. */
function higherLevelText(def: SpellDefinition, mod: SpellDamageModifier | undefined): string | undefined {
  const level = def.level ?? 0;
  const perLevel = mod?.atHigherLevels?.higherLevelDefinitions?.[0];
  const inc = dieString(perLevel?.dice);
  if (inc) {
    return `Deals an extra ${inc} damage for each slot level above ${ordinal(level)}.`;
  }
  if (def.canCastAtHigherLevel) {
    return `Can be cast using a spell slot of ${ordinal(level + 1)} level or higher.`;
  }
  return undefined;
}

function titleCase(s: string): string {
  return s.replace(/(^|[-\s])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function damageType(mod: SpellDamageModifier): string | undefined {
  if (mod.friendlySubtypeName && mod.friendlySubtypeName.trim() !== '') return mod.friendlySubtypeName;
  if (mod.subType && mod.subType.trim() !== '') return titleCase(mod.subType);
  return undefined;
}

/** A collected spell entry plus the casting class it came from (when derivable). */
interface CollectedSpell {
  entry: SpellEntry;
  /** Name of the class this spell is cast by, from its `classSpells[]` group (else undefined). */
  className?: string;
}

/**
 * Collect every spell entry across the DDB `spells.*` buckets and `classSpells[]`.
 * `classSpells[]` groups are keyed by `characterClassId`; we resolve that to the class name via
 * `classIdToName` so each spell can later be scored with its OWN class's focus bonus. Entries in
 * the `spells.*` buckets carry no class id, so their class is left to ability-based resolution.
 */
function collectSpellEntries(
  data: SpellSourceData,
  classIdToName: Map<number, string>,
): CollectedSpell[] {
  const out: CollectedSpell[] = [];
  for (const arr of Object.values(data.spells ?? {})) {
    if (Array.isArray(arr)) for (const entry of arr) out.push({ entry });
  }
  for (const group of data.classSpells ?? []) {
    const className =
      group?.characterClassId != null ? classIdToName.get(group.characterClassId) : undefined;
    if (Array.isArray(group?.spells)) for (const entry of group.spells) out.push({ entry, className });
  }
  return out;
}

/**
 * Sum flat item/feature bonuses to spell attack or save DC — e.g. a "+3 spellcasting focus"
 * (All-Purpose Tool, Rod of the Pact Keeper) grants `bonus / <class>-spell-attacks` and
 * `bonus / <class>-spell-save-dc`, or the generic `spell-attacks` / `spell-save-dc`.
 */
function spellFocusBonus(
  data: CharacterData,
  kind: 'spell-attacks' | 'spell-save-dc',
  className: string,
): number {
  const cls = className.toLowerCase();
  let total = 0;
  const buckets = (data as unknown as { modifiers?: Record<string, any[]> }).modifiers ?? {};
  for (const arr of Object.values(buckets)) {
    for (const m of arr ?? []) {
      if (m?.type !== 'bonus') continue;
      const st = String(m.subType ?? '');
      if (st === kind || st === `${cls}-${kind}`) total += m.value ?? 0;
    }
  }
  return total;
}

export function computeSpells(data: CharacterData, model: RollModel): SpellcastingInfo {
  const src = data as unknown as SpellSourceData;

  // ---- Per-class spellcasting stat block ----
  const classes: SpellcastingClassInfo[] = [];
  for (const c of data.classes ?? []) {
    const def = c.definition;
    if (!def) continue;
    const name = def.name ?? '';
    if (!def.canCastSpells && def.spellCastingAbilityId == null) continue;
    const ability = classSpellcastingAbility(name, def.spellCastingAbilityId);
    if (!ability) continue;
    const mod = model.abilities[ability].mod;
    classes.push({
      className: name,
      ability,
      attackBonus: model.profBonus + mod + spellFocusBonus(data, 'spell-attacks', name),
      saveDc: 8 + model.profBonus + mod + spellFocusBonus(data, 'spell-save-dc', name),
    });
  }

  // Default spellcasting ability (used for spells whose entry has no explicit stat id):
  // prefer the first casting class, else fall back to INT.
  const defaultAbility: Ability = classes[0]?.ability ?? 'INT';
  const primaryClass = classes[0]?.className ?? '';

  // Resolve a spell's casting class name from its ability, so a spell with no class-group
  // association (a `spells.*` bucket entry) still maps back to the right class's focus item.
  const abilityToClassName = new Map<Ability, string>();
  for (const c of classes) if (!abilityToClassName.has(c.ability)) abilityToClassName.set(c.ability, c.className);

  // Map DDB `characterClassId` -> class name, for `classSpells[]` group association.
  const classIdToName = new Map<number, string>();
  for (const c of data.classes ?? []) {
    const id = (c as unknown as { id?: number }).id;
    if (id != null && c.definition?.name) classIdToName.set(id, c.definition.name);
  }

  // Item/feature spell focus bonuses are per-CLASS (e.g. a wizard's +3 rod must not leak onto
  // cleric spells). Compute each spell's bonus from its OWN casting class, memoized by name.
  const focusCache = new Map<string, { atk: number; dc: number }>();
  const focusFor = (className: string): { atk: number; dc: number } => {
    let hit = focusCache.get(className);
    if (!hit) {
      hit = {
        atk: spellFocusBonus(data, 'spell-attacks', className),
        dc: spellFocusBonus(data, 'spell-save-dc', className),
      };
      focusCache.set(className, hit);
    }
    return hit;
  };

  // Token context reused for resolving any {{...}} tokens embedded in damage strings.
  const abilityMods: Record<Ability, number> = {
    STR: model.abilities.STR.mod,
    DEX: model.abilities.DEX.mod,
    CON: model.abilities.CON.mod,
    INT: model.abilities.INT.mod,
    WIS: model.abilities.WIS.mod,
    CHA: model.abilities.CHA.mod,
  };

  // ---- Flat spell list ----
  const spells: Spell[] = [];
  const seen = new Set<string>();
  // Resolve one damage modifier to a final dice string (cantrip scaling + token eval).
  const resolveDamageDice = (mod: SpellDamageModifier, isCantrip: boolean): string | undefined => {
    const base = dieString(mod.die ?? mod.dice);
    if (!base) return undefined;
    const dice = isCantrip ? cantripDamageDice(mod, model.level, base) ?? base : base;
    return evalDdbTokens(dice, { abilityMods, proficiency: model.profBonus, level: model.level });
  };

  for (const collected of collectSpellEntries(src, classIdToName)) {
    const { entry } = collected;
    const def = entry.definition;
    if (!def || !def.name) continue;

    const level = def.level ?? 0;
    const isCantrip = level === 0;

    // De-dupe by name + level (a spell may appear in multiple buckets).
    const key = `${def.name}|${level}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Which of the caster's abilities powers this spell (drives attack bonus / save DC).
    // Note: def.saveDcAbilityId is the TARGET's save ability, not the caster's.
    const ability = abilityForStatId(entry.spellCastingAbilityId) ?? defaultAbility;
    const abilMod = model.abilities[ability].mod;
    // The class whose focus item applies is the spell's own class: prefer its `classSpells[]`
    // group, else the class matching the spell's casting ability, else the primary class.
    const spellClass =
      collected.className ?? abilityToClassName.get(ability) ?? primaryClass;
    const focus = focusFor(spellClass);
    const attackBonus = model.profBonus + abilMod + focus.atk;
    const saveDc = 8 + model.profBonus + abilMod + focus.dc;

    let casting: Spell['casting'] = 'utility';
    if (def.requiresAttackRoll) casting = 'attack';
    else if (def.requiresSavingThrow) casting = 'save';

    const dmg = primaryDamage(def);
    const baseDice = dmg ? dieString(dmg.die ?? dmg.dice) : undefined;

    // All damage components (a spell may deal two types — e.g. Ice Knife's pierce + cold).
    const damages: SpellDamage[] = [];
    for (const m of allDamage(def)) {
      const dice = resolveDamageDice(m, isCantrip);
      if (!dice) continue;
      const dt = damageType(m);
      damages.push(dt ? { dice, type: dt } : { dice });
    }

    let damageDice: string | undefined;
    let scalesWithLevel = false;
    let atHigherLevels: string | undefined;

    if (dmg && baseDice) {
      damageDice = damages[0]?.dice;
      if (!isCantrip && (def.canCastAtHigherLevel || (dmg.atHigherLevels?.higherLevelDefinitions?.length ?? 0) > 0)) {
        scalesWithLevel = true;
        atHigherLevels = higherLevelText(def, dmg);
      }
    } else if (!isCantrip && def.canCastAtHigherLevel) {
      scalesWithLevel = true;
      atHigherLevels = higherLevelText(def, dmg);
    }

    const spell: Spell = {
      name: def.name,
      level,
      casting,
      isCantrip,
    };
    if (def.school) spell.school = def.school;
    if (casting === 'attack') spell.attackBonus = attackBonus;
    if (casting === 'save') {
      const saveAbility = abilityForStatId(def.saveDcAbilityId);
      if (saveAbility) spell.saveAbility = saveAbility;
      spell.saveDc = saveDc;
    }
    if (damageDice) {
      spell.damageDice = damageDice;
      if (dmg) {
        const dt = damageType(dmg);
        if (dt) spell.damageType = dt;
      }
      if (damages.length > 0) spell.damages = damages;
    }
    // Healing spells (Cure Wounds, Healing Word …) roll a die + the caster's ability mod.
    const heal = primaryHeal(def);
    if (heal) {
      const hd = dieString((heal as { die?: DdbDie }).die);
      if (hd) spell.healDice = abilMod ? `${hd} + ${abilMod}` : hd;
    }
    if (scalesWithLevel) spell.scalesWithLevel = true;
    if (atHigherLevels) spell.atHigherLevels = atHigherLevels;
    const anyDef = def as unknown as { concentration?: boolean; ritual?: boolean; activation?: { activationType?: number } };
    if (anyDef.concentration) spell.concentration = true;
    if (anyDef.ritual) spell.ritual = true;
    const at = anyDef.activation?.activationType;
    spell.castingTime = at === 3 ? 'bonus' : at === 4 ? 'reaction' : at === 1 ? 'action' : 'other';

    spells.push(spell);
  }

  return { classes, spells };
}
