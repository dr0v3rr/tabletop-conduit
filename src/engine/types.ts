// Static D&D 5e roll-engine types (Tier 1-2, deterministic).
// Derived from D&D Beyond character-service v5 JSON (`data` object).

export type Ability = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

export type SkillKey =
  | 'acrobatics'
  | 'animal-handling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleight-of-hand'
  | 'stealth'
  | 'survival';

/** A flagged advantage/disadvantage or otherwise conditional effect. */
export interface Condition {
  /** Human-readable source (feat/feature/trait/item name, or bucket). */
  source: string;
  /** Free-text restriction from the modifier (empty => unconditional). */
  restriction: string;
}

/** An entry in RollModel.conditional[] — an effect NOT baked into base numbers. */
export interface ConditionalEffect {
  source: string;
  type: string;
  subType: string;
  restriction: string;
  value?: number;
}

// ---- Input shape (only the fields the engine reads) ----

export interface StatEntry {
  id: number; // 1..6
  name: string | null;
  value: number | null;
}

export interface Modifier {
  type: string; // bonus|proficiency|expertise|half-proficiency|advantage|disadvantage|set|...
  subType: string; // kebab, e.g. 'intelligence-score', 'sleight-of-hand'
  value?: number | null;
  dice?: { diceString?: string } | null;
  statId?: number | null;
  componentId?: number | null;
  componentTypeId?: number | null;
  restriction?: string | null;
  friendlyTypeName?: string | null;
  friendlySubtypeName?: string | null;
}

export interface ClassDefinition {
  id?: number;
  name?: string;
  canCastSpells?: boolean;
  spellCastingAbilityId?: number | null;
}

export interface CharacterClass {
  level: number;
  definition?: ClassDefinition | null;
  subclassDefinition?: { name?: string } | null;
  classFeatures?: Array<{ definition?: { id?: number; name?: string } | null }> | null;
}

/** An inventory item's definition (only the fields the engine reads). */
export interface ItemDefinition {
  id?: number;
  name?: string;
  /** Whether the item must be attuned to grant its effects. */
  requiresAttunement?: boolean | null;
  /** Modifiers this item grants; their componentIds link back to `modifiers.item`. */
  grantedModifiers?: Modifier[] | null;
  /** Human category, e.g. 'Potion', 'Wondrous item', 'Weapon'. */
  type?: string | null;
  filterType?: string | null;
  /** True for magic items. */
  magic?: boolean | null;
  /** Single-use item (potion, scroll, thrown vial …). */
  isConsumable?: boolean | null;
  canEquip?: boolean | null;
  /** Offensive-item damage dice (Alchemist's Fire, Acid Vial, thrown vials). */
  damage?: { diceString?: string | null } | null;
  damageType?: string | null;
}

/** A single inventory entry (D&D Beyond `data.inventory[]`). */
export interface InventoryItem {
  /** Item instance id. */
  id?: number;
  quantity?: number | null;
  equipped?: boolean | null;
  isAttuned?: boolean | null;
  /** DDB flag: this item is rolled as an attack (thrown/offensive consumable). */
  displayAsAttack?: boolean | null;
  definition?: ItemDefinition | null;
  entityTypeId?: number | null;
}

export interface CharacterData {
  name: string;
  /** Hit points (DDB): current = max − removedHitPoints; max = overrideHitPoints ?? base+CON×lvl+bonus. */
  removedHitPoints?: number | null;
  temporaryHitPoints?: number | null;
  baseHitPoints?: number | null;
  bonusHitPoints?: number | null;
  overrideHitPoints?: number | null;
  stats: StatEntry[];
  bonusStats?: StatEntry[];
  overrideStats?: StatEntry[];
  classes: CharacterClass[];
  inventory?: InventoryItem[] | null;
  modifiers?: Record<string, Modifier[]> | null;
  feats?: Array<{ definition?: { id?: number; name?: string } | null }> | null;
  race?: {
    fullName?: string;
    racialTraits?: Array<{ definition?: { id?: number; name?: string } | null }> | null;
  } | null;
  background?: { definition?: { id?: number; name?: string } | null } | null;
}

// ---- Output shape ----

export interface AbilityValue {
  score: number;
  mod: number;
}

export interface SaveValue {
  mod: number;
  proficient: boolean;
  advantage?: Condition[];
  disadvantage?: Condition[];
}

export interface SkillValue {
  mod: number;
  ability: Ability;
  proficient: boolean;
  expertise: boolean;
  advantage?: Condition[];
  disadvantage?: Condition[];
}

export interface Spellcasting {
  ability: Ability;
  saveDc: number;
  attackBonus: number;
}

export interface RollModel {
  name: string;
  level: number;
  profBonus: number;
  abilities: Record<Ability, AbilityValue>;
  saves: Record<Ability, SaveValue>;
  skills: Record<SkillKey, SkillValue>;
  passives: { perception: number; investigation: number; insight: number };
  initiative: number;
  /** Primary speed in feet (walking if the creature has it, else its leading movement mode). */
  speed: number;
  /** All movement modes, when known (poke5e species can have walking/climbing/swimming/flying/
   *  hover/burrowing). Present only when there's structured data; the sheet can offer to show them. */
  speeds?: { type: string; value: number }[];
  conditional: ConditionalEffect[];
}
