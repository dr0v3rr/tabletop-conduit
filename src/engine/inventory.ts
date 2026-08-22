// Inventory / equipment layer.
//
// Surfaces the character's items so the UI can offer the ROLLABLE ones (potions that
// heal, thrown vials that deal damage) as click-to-roll, plus notable magic equipment
// for reference. Mundane, non-rollable gear (rope, rations, torches) is filtered out to
// keep the panel useful rather than a 46-line dump.
//
// Healing potions encode their dice exactly like healing spells do — a granted modifier
// `type:'bonus', subType:'hit-points'` with a `dice` — so this mirrors spells.ts's
// primaryHeal(). Offensive consumables carry `definition.damage.diceString` + damageType.

import type { CharacterData, InventoryItem, Modifier } from "./types.js";

export type ItemRollKind = "heal" | "damage" | "utility";

export interface InventoryEntry {
  /** Display name, e.g. "Potion of Healing". */
  name: string;
  kind: ItemRollKind;
  /** Roll formula for heal/damage items, e.g. "2d4 + 2" (undefined for utility). */
  dice?: string;
  /** Damage type for `kind:'damage'`, e.g. "Fire". */
  damageType?: string;
  magic: boolean;
  consumable: boolean;
  /** Total count across stacked/duplicate entries. */
  quantity: number;
  /** The underlying D&D Beyond inventory rows backing this (grouped) line — targets for the
   *  quantity write-back API. A single item may map to one stacked row (Torch ×10) or several
   *  duplicate rows (three separate Potion of Healing rows). */
  entries: { id: number; quantity: number }[];
  /** True if any matching entry is equipped. */
  equipped: boolean;
  /** True if any matching entry is attuned. */
  attuned: boolean;
  /** Category label, e.g. "Potion", "Wondrous item". */
  typeName: string;
}

/** DdbDie-ish → "2d4 + 2" (prefers the ready-made diceString DDB provides). */
function diceString(d: { diceString?: string | null; diceCount?: number | null; diceValue?: number | null } | null | undefined): string | undefined {
  if (!d) return undefined;
  if (typeof d.diceString === "string" && d.diceString.trim() !== "") return d.diceString.trim();
  if (typeof d.diceCount === "number" && typeof d.diceValue === "number") return `${d.diceCount}d${d.diceValue}`;
  return undefined;
}

/** Healing dice from a `bonus / hit-points` granted modifier (potions, healing kits). */
function healDice(mods: Modifier[] | null | undefined): string | undefined {
  for (const m of mods ?? []) {
    if (m?.type === "bonus" && m?.subType === "hit-points") {
      const dm = m as Modifier & { die?: { diceString?: string | null } | null };
      const s = diceString(m.dice) ?? diceString(dm.die);
      if (s) return s;
    }
  }
  return undefined;
}

/** Build the rollable/notable item list, grouped by identical item and quantity-summed. */
export function computeInventory(data: CharacterData): InventoryEntry[] {
  const grouped = new Map<string, InventoryEntry>();

  for (const it of data.inventory ?? []) {
    const def = it?.definition;
    if (!def?.name) continue;
    // Weapons already have their own Attacks section (with to-hit + damage); don't
    // duplicate them here as bare damage rolls.
    if (/^weapon$/i.test(def.filterType ?? "") || /^weapon$/i.test(def.type ?? "")) continue;

    const heal = healDice(def.grantedModifiers);
    const dmg = diceString(def.damage);
    // Only treat damage dice as rollable when the item is genuinely offensive — DDB flags
    // thrown/attack consumables with displayAsAttack or gives them a damageType.
    const isOffensive = !!dmg && (it.displayAsAttack === true || !!def.damageType);

    let kind: ItemRollKind = "utility";
    let dice: string | undefined;
    let damageType: string | undefined;
    if (heal) {
      kind = "heal";
      dice = heal;
    } else if (isOffensive) {
      kind = "damage";
      dice = dmg;
      damageType = def.damageType ?? undefined;
    }

    const magic = def.magic === true;
    // Keep only rollable items or magic equipment; drop mundane, non-rollable gear.
    if (kind === "utility" && !magic) continue;

    const qty = typeof it.quantity === "number" ? it.quantity : 1;
    const entry = typeof it.id === "number" ? { id: it.id, quantity: qty } : null;
    const key = `${def.name}|${kind}|${dice ?? ""}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += qty;
      if (entry) existing.entries.push(entry);
      existing.equipped = existing.equipped || it.equipped === true;
      existing.attuned = existing.attuned || it.isAttuned === true;
    } else {
      grouped.set(key, {
        name: def.name,
        kind,
        dice,
        damageType,
        magic,
        consumable: def.isConsumable === true,
        quantity: qty,
        entries: entry ? [entry] : [],
        equipped: it.equipped === true,
        attuned: it.isAttuned === true,
        typeName: def.type ?? def.filterType ?? "Item",
      });
    }
  }

  // Rollable items first (heal, then damage), then magic gear; alphabetical within each.
  const order: Record<ItemRollKind, number> = { heal: 0, damage: 1, utility: 2 };
  return [...grouped.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
  );
}
