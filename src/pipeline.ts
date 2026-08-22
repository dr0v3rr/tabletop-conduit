// End-to-end pipeline: D&D Beyond character JSON + a roll request → a Roll20 chat command.
// Wires the four validated layers together.
import { computeRollModel } from "./engine/index.js";
import type { CharacterData, RollModel } from "./engine/types.js";
import { resolveEffects, listAvailableToggles } from "./rules/index.js";
import { buildRoll20Command, composeRoll } from "./compose/index.js";
import { computeWeapons } from "./engine/weapons.js";
import type { Weapon } from "./engine/weapons.js";
import { computeSpells } from "./engine/spells.js";
import type { Spell, SpellcastingInfo } from "./engine/spells.js";
import { computeSpellSlots } from "./engine/spell-slots.js";
import type { SlotLevel } from "./engine/spell-slots.js";
import { computeHitDice } from "./engine/hit-dice.js";
import type { HitDice } from "./engine/hit-dice.js";
import { computeInventory } from "./engine/inventory.js";
import type { InventoryEntry } from "./engine/inventory.js";
import { computeHp } from "./engine/hp.js";
import type { HpState } from "./engine/hp.js";
import { computeConditions } from "./engine/conditions.js";
import { computeDefenses, type Defenses } from "./engine/defenses.js";
import type { ActiveCondition } from "./engine/conditions.js";
import type { RollRequest } from "./shared/roll-types.js";

export interface RollResult {
  model: RollModel;
  request: RollRequest;
  command: string;
}

/**
 * Compute a Roll20 chat command from raw character-service `data` and a roll request.
 * @param data              character-service v5 `data` object
 * @param request           what to roll (kind/key/advantage/etc.)
 * @param enabledToggleIds  ids of user-enabled roll-time options (Sharpshooter, Bless, …)
 */
export function rollFrom(
  data: CharacterData,
  request: RollRequest,
  enabledToggleIds: string[] = [],
  precomputed?: RollModel,
): RollResult {
  // Non-DDB sources (poke5e trainers, Open5e monsters) carry no raw DDB `data`, so they supply a
  // precomputed model and we skip the DDB rule-effect resolution (which reads data.modifiers).
  const model = precomputed ?? computeRollModel(data);
  const hasDdbData = !!(data && (data as { stats?: unknown }).stats);
  const auto = hasDdbData ? resolveEffects(data, model, request, enabledToggleIds) : [];
  const merged: RollRequest = {
    ...request,
    effects: [...(request.effects ?? []), ...auto],
    speakingAs: request.speakingAs ?? model.name,
    // Universal template by default so rolls render in ANY campaign; callers with the
    // D&D 5e sheet installed can pass templateStyle:'sheet' for the prettier templates.
    templateStyle: request.templateStyle ?? "default",
  };
  return { model, request: merged, command: buildRoll20Command(model, merged) };
}

/** Which roll-time toggles a UI should offer for this character + roll. */
export function availableToggles(data: CharacterData, request: RollRequest) {
  const model = computeRollModel(data);
  return listAvailableToggles(data, model, request);
}

export interface Character {
  model: RollModel;
  weapons: Weapon[];
  spellcasting: SpellcastingInfo;
  spellSlots: SlotLevel[];
  hitDice: HitDice;
  inventory: InventoryEntry[];
  hp: HpState;
  conditions: ActiveCondition[];
  defenses: Defenses;
}

/** Compute the full character view: roll model + weapons + spellcasting + spell slots + hit dice + inventory + HP. */
export function buildCharacter(data: CharacterData): Character {
  const model = computeRollModel(data);
  return {
    model,
    weapons: computeWeapons(data, model),
    spellcasting: computeSpells(data, model),
    spellSlots: computeSpellSlots(data),
    hitDice: computeHitDice(data, model),
    inventory: computeInventory(data),
    hp: computeHp(data, model),
    conditions: computeConditions(data),
    defenses: computeDefenses(data),
  };
}

/** Translate a rollable inventory item into a roll request. Utility items aren't rollable → null. */
export function itemToRequest(item: InventoryEntry): RollRequest | null {
  if (item.kind === "heal" && item.dice) {
    return { kind: "damage", key: `${item.name} (heal)`, baseDamage: item.dice };
  }
  if (item.kind === "damage" && item.dice) {
    return { kind: "damage", key: item.name, baseDamage: item.dice, damageType: item.damageType };
  }
  return null;
}

/** Translate a parsed Weapon into an attack RollRequest. */
export function weaponToRequest(w: Weapon, advantage?: RollRequest["advantage"]): RollRequest {
  const dmg = w.damageMod
    ? `${w.damageDice} ${w.damageMod >= 0 ? "+" : "-"} ${Math.abs(w.damageMod)}`
    : w.damageDice;
  return { kind: "attack", key: w.name, baseAttackMod: w.attackMod, baseDamage: dmg, damageType: w.damageType, advantage };
}

/** Translate a parsed Spell into a roll request (attack spells roll to-hit+damage; save spells roll damage labelled with the DC). Returns null for utility spells. */
export function spellToRequest(sp: Spell, advantage?: RollRequest["advantage"]): RollRequest | null {
  if (sp.casting === "attack") {
    return { kind: "attack", key: sp.name, baseAttackMod: sp.attackBonus ?? 0, baseDamage: sp.damageDice ?? "", damageType: sp.damageType, advantage };
  }
  if (sp.casting === "save") {
    if (!sp.damageDice) return { kind: "cast", key: `${sp.name} (${sp.saveAbility ?? ""} DC ${sp.saveDc ?? "?"} save)`.replace(/\s+/g, " ") };
    const label = `${sp.name} (DC ${sp.saveDc ?? "?"} ${sp.saveAbility ?? ""})`.trim();
    return { kind: "damage", key: label, baseDamage: sp.damageDice, damageType: sp.damageType };
  }
  // healing spell (Cure Wounds, Healing Word …) → roll the healing dice
  if (sp.healDice) return { kind: "damage", key: `${sp.name} (heal)`, baseDamage: sp.healDice };
  // utility spell → a cast announcement (no dice)
  return { kind: "cast", key: sp.name };
}

export { computeRollModel, composeRoll, buildRoll20Command };
export type { CharacterData, RollModel, RollRequest, Weapon, Spell, SpellcastingInfo, SlotLevel, InventoryEntry };
