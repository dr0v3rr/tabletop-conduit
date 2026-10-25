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

/** Whether the inventory item behind a modifier or spell (`componentId`) is in use: equipped, and
 *  attuned when it needs attunement. Item modifiers and spells link to their item by
 *  `componentId === item.definition.id` (also matched against the item's own granted-modifier
 *  componentIds). If no owning item can be identified the answer is yes (conservative — never drop
 *  something we cannot map). Attunement is required when the ITEM's definition says so OR the caller
 *  says so — DDB often leaves `definition.requiresAttunement` unset and flags the modifier instead
 *  (Cloak/Ring of Protection), so an UNATTUNED such item must not grant its attunement-gated bonus. */
export function itemInUse(data: CharacterData, componentId: number | null | undefined, attuneGated = false): boolean {
  if (componentId === undefined || componentId === null) return true;
  const owners = (data.inventory ?? []).filter((it) => {
    if (it?.definition?.id === componentId) return true;
    const gms = it?.definition?.grantedModifiers ?? [];
    return Array.isArray(gms) && gms.some((g) => g?.componentId === componentId);
  });
  if (owners.length === 0) return true; // owner not identifiable -> keep
  // In use if ANY matching item instance is equipped (+ attuned when required).
  return owners.some((it) => {
    if (it?.equipped !== true) return false;
    return (it?.definition?.requiresAttunement || attuneGated) ? it?.isAttuned === true : true;
  });
}

/** Every modifier currently in effect, tagged with its bucket: item modifiers only while their item
 *  is equipped (and attuned when required), and a species' ungranted ability increases dropped when
 *  the background grants them (2024 origins). Shared by the roll model and spellcasting. */
export function activeModifiers(data: CharacterData): Array<Modifier & { _bucket: string }> {
  const itemModifierActive = (m: Modifier): boolean => itemInUse(data, m.componentId, m.requiresAttunement === true);

  // Under the 2024 origin rules ability increases come from the BACKGROUND, and a legacy species ASI is
  // then left in the data flagged isGranted:false and NOT applied (seen live: a Gem Dragonborn's +2 CHA
  // inflating CHA by 2). But isGranted:false alone doesn't mean "off": a species' CHOSEN increases
  // (Half-Elf's +1 to two scores) carry it too and DDB applies them when the background grants no
  // increases (seen live: Acerē, DEX/CON 16 on DDB). So drop them only when the background grants some.
  // A 2024 background's increases sit either in the background bucket or on a background "feat" D&D
  // Beyond tags __INITIAL_ASI ("Charlatan Ability Score Improvements", seen live on a Gem Dragonborn).
  const isScoreBonus = (m: Modifier) => m.type === 'bonus' && /-score$/.test(m.subType || '');
  const buckets = (data.modifiers as Record<string, Modifier[] | undefined> | undefined) ?? {};
  const initialAsiFeats = new Set(
    (data.feats ?? [])
      .filter((f) => ((f?.definition as { categories?: { tagName?: string }[] } | undefined)?.categories ?? []).some((c) => c?.tagName === '__INITIAL_ASI'))
      .map((f) => f?.definition?.id),
  );
  const backgroundGrantsAsi =
    (buckets.background ?? []).some(isScoreBonus) ||
    (buckets.feat ?? []).some((m) => isScoreBonus(m) && initialAsiFeats.has(m.componentId ?? undefined));

  // Multiclassing: a class's starting proficiencies (its saving throws, armour, skills) apply only to
  // the class you started with. D&D Beyond flags those modifiers availableToMulticlass:false, so drop
  // them when their feature belongs to any OTHER class (seen live: a Rogue-first Rogue/Ranger getting
  // Ranger's STR save proficiency).
  const classes = data.classes ?? [];
  const otherClassFeatures = new Set<number>();
  if (classes.length > 1 && classes.some((c) => c?.isStartingClass)) {
    for (const c of classes) {
      if (c?.isStartingClass) continue;
      for (const f of c?.classFeatures ?? []) if (typeof f?.definition?.id === 'number') otherClassFeatures.add(f.definition.id);
    }
  }

  // Flatten all modifiers, tagging bucket for source resolution. `item`-bucket
  // modifiers are dropped unless their owning inventory item is equipped/attuned.
  const mods: Array<Modifier & { _bucket: string }> = [];
  for (const [bucket, arr] of Object.entries(data.modifiers ?? {})) {
    if (Array.isArray(arr)) {
      for (const m of arr) {
        // Feat/background ability bonuses (half-feats, the chosen ASI) stay applied even when DDB flags
        // them isGranted:false — the drop is scoped to race `*-score` bonuses.
        if (backgroundGrantsAsi && m.isGranted === false && bucket === 'race' && isScoreBonus(m)) continue;
        if (bucket === 'item' && !itemModifierActive(m)) continue;
        if (m.availableToMulticlass === false && typeof m.componentId === 'number' && otherClassFeatures.has(m.componentId)) continue;
        mods.push({ ...m, _bucket: bucket });
      }
    }
  }
  return mods;
}

export function computeRollModel(data: CharacterData): RollModel {
  const mods = activeModifiers(data);

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
  // A bonus "equal to your <ability> modifier" (Aura of Protection's CHA to saves) comes with no
  // numeric value and a `statId` naming the ability instead; it resolves once the scores are known
  // (a score bonus never takes this form, so the score pass below doesn't need it).
  let statMod: ((id: number) => number) | null = null;
  const sumBonus = (sub: string): number => {
    let total = 0;
    for (const m of modsBy('bonus', sub)) {
      if (hasRestriction(m)) {
        pushConditional(m);
        continue;
      }
      if (typeof m.value === 'number') total += m.value;
      else if (m.statId && statMod) total += statMod(m.statId);
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
    // An ability-score increase is never situational: text on it ("That you do not have Saving Throw
    // Proficiency in" on Resilient) describes which score you could pick, so count it regardless.
    for (const m of modsBy('bonus', `${STAT_ID_TO_KEY[i]}-score`)) v += m.value ?? 0;
    // `set` score mods (Gauntlets of Ogre Power / Headband of Intellect) floor-set the
    // score: apply as max(current, setValue), BEFORE any absolute overrideStats win.
    const setVal = maxSet(`${STAT_ID_TO_KEY[i]}-score`);
    if (setVal !== undefined) v = Math.max(v, setVal);
    const ov = override[i];
    if (ov !== undefined && ov !== null) v = ov;
    scores[i] = v;
  }
  const scoreOf = (id: number): number => scores[id] ?? 0;
  statMod = (id) => abilityMod(scoreOf(id));

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

  // ---- Speed ----
  // The species' base speeds, raised by any "your speed is N" (`set innate-speed-<mode>`, e.g. Fleet of
  // Foot's 35 ft; no value = equal to your walking speed), then flat bonuses (`bonus speed` such as
  // Mobile's +10 for walking, `bonus speed-<mode>` for one mode). Monk Unarmored Movement only counts
  // with no armour or shield on. Conditional ones (Cloak of the Bat "in dim light") are left out.
  const SPEED_MODES = ['walking', 'flying', 'swimming', 'climbing', 'burrowing'] as const;
  const RACE_KEY: Record<string, string> = { walking: 'walk', flying: 'fly', swimming: 'swim', climbing: 'climb', burrowing: 'burrow' };
  const raceSpeeds = (data as { race?: { weightSpeeds?: { normal?: Record<string, number | null> } } }).race?.weightSpeeds?.normal ?? {};
  const unconditional = (type: string, sub: string) => modsBy(type, sub).filter((m) => !hasRestriction(m));
  const flatBonus = (sub: string) => unconditional('bonus', sub).reduce((t, m) => t + (typeof m.value === 'number' ? m.value : 0), 0);
  const armoured = (data.inventory ?? []).some((it) => it?.equipped && typeof (it.definition as { armorTypeId?: number } | undefined)?.armorTypeId === 'number');
  const baseWalk = Math.max(raceSpeeds.walk ?? 30, ...unconditional('set', 'innate-speed-walking').map((m) => m.value ?? 0));
  const walk = baseWalk + flatBonus('speed') + flatBonus('speed-walking') + (armoured ? 0 : flatBonus('unarmored-movement'));
  // A speed the player typed on the sheet (D&D Beyond "Speeds" override) replaces the computed one.
  const MOVEMENT_ID: Record<number, string> = { 1: 'walking', 2: 'burrowing', 3: 'climbing', 4: 'flying', 5: 'swimming' };
  const custom = new Map<string, number>();
  for (const c of (data as { customSpeeds?: { movementId?: number; distance?: number | null }[] | null }).customSpeeds ?? []) {
    const mode = MOVEMENT_ID[c?.movementId ?? 0];
    if (mode && typeof c.distance === 'number') custom.set(mode, c.distance);
  }
  const speeds: { type: string; value: number }[] = [];
  for (const mode of SPEED_MODES) {
    if (mode === 'walking') { speeds.push({ type: mode, value: custom.get(mode) ?? walk }); continue; }
    const set = unconditional('set', `innate-speed-${mode}`).map((m) => (typeof m.value === 'number' ? m.value : walk));
    const base = Math.max(raceSpeeds[RACE_KEY[mode]!] ?? 0, ...set);
    const value = custom.get(mode) ?? (base > 0 ? base + flatBonus(`speed-${mode}`) : 0);
    if (value > 0) speeds.push({ type: mode, value });
  }

  const model: RollModel = {
    name: data.name,
    level: totalLevel,
    profBonus,
    abilities,
    saves,
    skills,
    passives,
    initiative,
    speed: speeds[0]!.value,
    ...(speeds.length > 1 ? { speeds } : {}),
    conditional,
  };
  return model;
}
