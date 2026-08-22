// Pure, deterministic D&D 5e roll-model computation from a
// D&D Beyond character-service v5 `data` object. No DOM / network.

import type {
  Ability,
  CharacterData,
  Condition,
  ConditionalEffect,
  Modifier,
  RollModel,
  SaveValue,
  SkillKey,
  SkillValue,
} from './types';

const STAT_ID_TO_ABILITY: Record<number, Ability> = {
  1: 'STR',
  2: 'DEX',
  3: 'CON',
  4: 'INT',
  5: 'WIS',
  6: 'CHA',
};

const STAT_ID_TO_KEY: Record<number, string> = {
  1: 'strength',
  2: 'dexterity',
  3: 'constitution',
  4: 'intelligence',
  5: 'wisdom',
  6: 'charisma',
};

const ABILITY_TO_STAT_ID: Record<Ability, number> = {
  STR: 1,
  DEX: 2,
  CON: 3,
  INT: 4,
  WIS: 5,
  CHA: 6,
};

// kebab skill subType -> stat id
const SKILL_TO_STAT_ID: Record<SkillKey, number> = {
  acrobatics: 2,
  'animal-handling': 5,
  arcana: 4,
  athletics: 1,
  deception: 6,
  history: 4,
  insight: 5,
  intimidation: 6,
  investigation: 4,
  medicine: 5,
  nature: 4,
  perception: 5,
  performance: 6,
  persuasion: 6,
  religion: 4,
  'sleight-of-hand': 2,
  stealth: 2,
  survival: 5,
};

const SKILL_KEYS = Object.keys(SKILL_TO_STAT_ID) as SkillKey[];
const ABILITIES: Ability[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function abilityForStatId(id: number): Ability | undefined {
  return STAT_ID_TO_ABILITY[id];
}

function hasRestriction(m: Modifier): boolean {
  return typeof m.restriction === 'string' && m.restriction.trim() !== '';
}

export function computeRollModel(data: CharacterData): RollModel {
  const inventory = data.inventory ?? [];

  // Resolve whether an `item`-bucket modifier's owning inventory item is currently
  // active: the item must be `equipped`, and (if it requires attunement) `isAttuned`.
  // Item modifiers link to their inventory item by `componentId === item.definition.id`
  // (also matched against the item's own granted-modifier componentIds). If no owning
  // item can be positively identified, the modifier is KEPT (conservative — never
  // regress a golden by dropping a modifier we cannot map).
  const itemModifierActive = (m: Modifier): boolean => {
    const cid = m.componentId;
    if (cid === undefined || cid === null) return true;
    const owners = inventory.filter((it) => {
      if (it?.definition?.id === cid) return true;
      const gms = it?.definition?.grantedModifiers ?? [];
      return Array.isArray(gms) && gms.some((g) => g?.componentId === cid);
    });
    if (owners.length === 0) return true; // owner not identifiable -> keep
    // Keep if ANY matching item instance is equipped (+ attuned when required).
    return owners.some((it) => {
      if (it?.equipped !== true) return false;
      return it?.definition?.requiresAttunement ? it?.isAttuned === true : true;
    });
  };

  // Flatten all modifiers, tagging bucket for source resolution. `item`-bucket
  // modifiers are dropped unless their owning inventory item is equipped/attuned.
  const mods: Array<Modifier & { _bucket: string }> = [];
  for (const [bucket, arr] of Object.entries(data.modifiers ?? {})) {
    if (Array.isArray(arr)) {
      for (const m of arr) {
        if (bucket === 'item' && !itemModifierActive(m)) continue;
        mods.push({ ...m, _bucket: bucket });
      }
    }
  }

  // componentId -> friendly source name (feats, class features, racial traits, background).
  const sourceById = new Map<number, string>();
  const register = (id: number | undefined, name: string | undefined) => {
    if (typeof id === 'number' && name) sourceById.set(id, name);
  };
  for (const f of data.feats ?? []) register(f.definition?.id, f.definition?.name);
  for (const t of data.race?.racialTraits ?? []) register(t.definition?.id, t.definition?.name);
  for (const c of data.classes ?? []) {
    for (const f of c.classFeatures ?? []) register(f.definition?.id, f.definition?.name);
  }
  register(data.background?.definition?.id, data.background?.definition?.name);

  const sourceOf = (m: Modifier & { _bucket: string }): string => {
    if (typeof m.componentId === 'number' && sourceById.has(m.componentId)) {
      return sourceById.get(m.componentId)!;
    }
    // Fallback: capitalize the bucket name.
    return m._bucket.charAt(0).toUpperCase() + m._bucket.slice(1);
  };

  const modsBy = (type: string, sub: string) =>
    mods.filter((m) => m.type === type && m.subType === sub);

  const conditional: ConditionalEffect[] = [];
  const pushConditional = (m: Modifier & { _bucket: string }) => {
    conditional.push({
      source: sourceOf(m),
      type: m.type,
      subType: m.subType,
      restriction: (m.restriction ?? '').trim(),
      value: typeof m.value === 'number' ? m.value : undefined,
    });
  };

  // Sum of `bonus` mods for a subType, applying only unconditional ones.
  // Conditional (restriction-bearing) bonuses are emitted to conditional[] instead.
  const sumBonus = (sub: string): number => {
    let total = 0;
    for (const m of modsBy('bonus', sub)) {
      if (hasRestriction(m)) {
        pushConditional(m);
        continue;
      }
      total += m.value ?? 0;
    }
    return total;
  };

  // Largest `set`-type value for a subType (floor-set, e.g. Gauntlets of Ogre Power
  // "your STR is 21"). Returns undefined when no such (unconditional) mod exists.
  // Item-bucket `set` mods are already equipped/attunement-gated via the flatten filter.
  const maxSet = (sub: string): number | undefined => {
    let best: number | undefined;
    for (const m of mods) {
      if (m.type !== 'set' || m.subType !== sub) continue;
      if (hasRestriction(m)) continue;
      if (typeof m.value === 'number') best = best === undefined ? m.value : Math.max(best, m.value);
    }
    return best;
  };

  // ---- Ability scores ----
  const base: Record<number, number> = {};
  for (const s of data.stats) base[s.id] = s.value ?? 0;
  const bonus: Record<number, number> = {};
  for (const s of data.bonusStats ?? []) bonus[s.id] = s.value ?? 0;
  const override: Record<number, number | null> = {};
  for (const s of data.overrideStats ?? []) override[s.id] = s.value;

  const scores: Record<number, number> = {};
  for (let i = 1; i <= 6; i++) {
    let v = (base[i] ?? 0) + (bonus[i] ?? 0);
    v += sumBonus(`${STAT_ID_TO_KEY[i]}-score`);
    // `set` score mods (Gauntlets of Ogre Power / Headband of Intellect) floor-set the
    // score: apply as max(current, setValue), BEFORE any absolute overrideStats win.
    const setVal = maxSet(`${STAT_ID_TO_KEY[i]}-score`);
    if (setVal !== undefined) v = Math.max(v, setVal);
    const ov = override[i];
    if (ov !== undefined && ov !== null) v = ov;
    scores[i] = v;
  }
  const scoreOf = (id: number): number => scores[id] ?? 0;

  const abilities = {} as RollModel['abilities'];
  for (const ab of ABILITIES) {
    const id = ABILITY_TO_STAT_ID[ab];
    abilities[ab] = { score: scoreOf(id), mod: abilityMod(scoreOf(id)) };
  }

  // ---- Proficiency bonus ----
  const totalLevel = (data.classes ?? []).reduce((sum, c) => sum + (c.level ?? 0), 0);
  const profBonus = Math.ceil(totalLevel / 4) + 1;

  // ---- Advantage / disadvantage flag collection ----
  // Returns {unconditional flags} and emits conditional ones to conditional[].
  const collectAdvDis = (sub: string) => {
    const advantage: Condition[] = [];
    const disadvantage: Condition[] = [];
    for (const m of mods) {
      if (m.subType !== sub) continue;
      if (m.type !== 'advantage' && m.type !== 'disadvantage') continue;
      if (hasRestriction(m)) {
        pushConditional(m);
        continue;
      }
      const cond: Condition = { source: sourceOf(m), restriction: '' };
      if (m.type === 'advantage') advantage.push(cond);
      else disadvantage.push(cond);
    }
    return { advantage, disadvantage };
  };

  // ---- Saving throws ----
  const saves = {} as RollModel['saves'];
  for (const ab of ABILITIES) {
    const id = ABILITY_TO_STAT_ID[ab];
    const key = STAT_ID_TO_KEY[id];
    const sub = `${key}-saving-throws`;
    const proficient = modsBy('proficiency', sub).length > 0;
    let mod = abilityMod(scoreOf(id)) + (proficient ? profBonus : 0);
    // Per-ability bonus PLUS the generic "bonus to all saving throws" DDB encodes as the bare
    // `saving-throws` subType (Ring/Cloak of Protection, Paladin aura, etc.).
    mod += sumBonus(sub) + sumBonus('saving-throws');
    const { advantage, disadvantage } = collectAdvDis(sub);
    const sv: SaveValue = { mod, proficient };
    if (advantage.length) sv.advantage = advantage;
    if (disadvantage.length) sv.disadvantage = disadvantage;
    saves[ab] = sv;
  }

  // ---- Global half-proficiency (Jack of All Trades / Remarkable Athlete) ----
  // Encoded as a single `half-proficiency` modifier whose subType is NOT a specific
  // skill name (e.g. 'ability-checks' or ''). When present it grants floor(prof/2) to
  // every ability check (all skills not already proficient/expert) and to initiative.
  const SKILL_SET = new Set<string>(SKILL_KEYS);
  const globalHalfProf = mods.some(
    (m) => m.type === 'half-proficiency' && !hasRestriction(m) && !SKILL_SET.has(m.subType),
  );
  const halfProfBonus = Math.floor(profBonus / 2);

  // ---- Skills ----
  const skills = {} as RollModel['skills'];
  for (const sk of SKILL_KEYS) {
    const statId = SKILL_TO_STAT_ID[sk];
    const ability = abilityForStatId(statId) ?? 'STR';
    const expertise = modsBy('expertise', sk).length > 0;
    const proficient = modsBy('proficiency', sk).length > 0;
    const half = modsBy('half-proficiency', sk).length > 0;

    let profComponent = 0;
    if (expertise) profComponent = profBonus * 2;
    else if (proficient) profComponent = profBonus;
    else if (half) profComponent = halfProfBonus;
    // Global JoAT/Remarkable Athlete: half-prof for skills with no proficiency of their
    // own. Mutually exclusive with the branches above, so it never double-applies.
    else if (globalHalfProf) profComponent = halfProfBonus;

    // Flat bonus keyed by the skill kebab, PLUS the generic "bonus to all ability checks".
    let mod = abilityMod(scoreOf(statId)) + profComponent + sumBonus(sk) + sumBonus('ability-checks');

    const { advantage, disadvantage } = collectAdvDis(sk);
    const skv: SkillValue = {
      mod,
      ability,
      proficient: proficient || expertise,
      expertise,
    };
    if (advantage.length) skv.advantage = advantage;
    if (disadvantage.length) skv.disadvantage = disadvantage;
    skills[sk] = skv;
  }

  // ---- Passives (10 + skill total; +5 unconditional advantage, −5 unconditional disadvantage) ----
  const passiveOf = (sk: SkillKey): number => {
    const s = skills[sk];
    return 10 + s.mod + (s.advantage?.length ? 5 : 0) - (s.disadvantage?.length ? 5 : 0);
  };
  const passives = {
    perception: passiveOf('perception'),
    investigation: passiveOf('investigation'),
    insight: passiveOf('insight'),
  };

  // ---- Initiative ----
  let initiative = abilityMod(scoreOf(ABILITY_TO_STAT_ID.DEX)) + sumBonus('initiative');
  // Jack of All Trades / Remarkable Athlete also add half-proficiency to initiative.
  if (globalHalfProf) initiative += halfProfBonus;

  const model: RollModel = {
    name: data.name,
    level: totalLevel,
    profBonus,
    abilities,
    saves,
    skills,
    passives,
    initiative,
    speed: (data as { race?: { weightSpeeds?: { normal?: { walk?: number } } } }).race?.weightSpeeds?.normal?.walk ?? 30,
    conditional,
  };
  return model;
}
