// Spell-slot computation. D&D Beyond does NOT store available slot counts in the character
// JSON (spellSlots[].available is 0); it derives them from class levels. We reproduce that with
// the standard multiclass spellcaster table keyed by effective caster level — EXCEPT for a
// single spellcasting class, where we use that class's own single-class progression (the
// multiclass floor-rounding under-counts half- and third-casters), and for Warlock, whose Pact
// Magic is a separate track entirely.
import type { CharacterData } from "./types.js";

export interface SlotLevel {
  level: number; // spell level 1..9
  total: number; // slots available at a long rest
  used: number; // slots already expended (from the character's tracked state)
  pact?: boolean; // true => Warlock Pact Magic slot (separate track from the Vancian table)
}

// Multiclass spellcaster slot table (PHB p.165), indexed by effective caster level 0..20.
// Each row lists slot counts for spell levels 1..9.
const SLOTS: number[][] = [
  [], // 0
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Third-caster (Eldritch Knight / Arcane Trickster) single-class slot table, indexed by CLASS
// level 0..20 (PHB Fighter p.75 / Rogue p.98). These rows do NOT match a multiclass-caster-level
// lookup, so they are hard-coded here rather than derived via floor(level/3) into SLOTS.
const THIRD_SLOTS: number[][] = [
  [], // 0
  [], // 1
  [], // 2
  [2], // 3
  [3], // 4
  [3], // 5
  [3], // 6
  [4, 2], // 7
  [4, 2], // 8
  [4, 2], // 9
  [4, 3], // 10
  [4, 3], // 11
  [4, 3], // 12
  [4, 3, 2], // 13
  [4, 3, 2], // 14
  [4, 3, 2], // 15
  [4, 3, 3], // 16
  [4, 3, 3], // 17
  [4, 3, 3], // 18
  [4, 3, 3, 1], // 19
  [4, 3, 3, 1], // 20
];

// Warlock Pact Magic: warlock level -> [slot count, slot level] (PHB p.106).
const PACT: Array<[count: number, slotLevel: number]> = [
  [0, 0], // 0
  [1, 1], // 1
  [2, 1], // 2
  [2, 2], // 3
  [2, 2], // 4
  [2, 3], // 5
  [2, 3], // 6
  [2, 4], // 7
  [2, 4], // 8
  [2, 5], // 9
  [2, 5], // 10
  [3, 5], // 11
  [3, 5], // 12
  [3, 5], // 13
  [3, 5], // 14
  [3, 5], // 15
  [3, 5], // 16
  [4, 5], // 17
  [4, 5], // 18
  [4, 5], // 19
  [4, 5], // 20
];

const FULL = new Set(["wizard", "cleric", "druid", "bard", "sorcerer"]);
const HALF = new Set(["paladin", "ranger"]);
const THIRD_SUBCLASS = new Set(["eldritch knight", "arcane trickster"]);

/** Does this class entry contribute spellcasting (of any track)? */
function isSpellcaster(className: string, subclass: string): boolean {
  const c = className.toLowerCase();
  if (c === "artificer" || c === "warlock" || FULL.has(c) || HALF.has(c)) return true;
  return THIRD_SUBCLASS.has(subclass.toLowerCase());
}

/** Effective caster level contributed by one class entry (multiclass rules; Artificer rounds up). */
function casterLevels(className: string, subclass: string, level: number): number {
  const c = className.toLowerCase();
  if (c === "artificer") return Math.ceil(level / 2); // Artificer special: rounds up
  if (FULL.has(c)) return level;
  if (HALF.has(c)) return Math.floor(level / 2);
  if (THIRD_SUBCLASS.has(subclass.toLowerCase())) return Math.floor(level / 3);
  return 0;
}

/** Single-class Vancian slot row (spell levels 1..9) for one spellcasting class. */
function singleClassRow(className: string, subclass: string, level: number): number[] {
  const c = className.toLowerCase();
  // Full casters index the table by their own level.
  if (FULL.has(c)) return SLOTS[Math.max(0, Math.min(20, level))] ?? [];
  // Half-casters (Paladin/Ranger) and Artificer round the level up into the shared table,
  // which reproduces their published class tables exactly.
  if (HALF.has(c) || c === "artificer") {
    // Paladin/Ranger don't gain spellcasting until level 2; Artificer casts from level 1.
    if (HALF.has(c) && level < 2) return [];
    return SLOTS[Math.max(0, Math.min(20, Math.ceil(level / 2)))] ?? [];
  }
  // Third-casters (Eldritch Knight / Arcane Trickster) use their own class table by class level.
  if (THIRD_SUBCLASS.has(subclass.toLowerCase())) {
    return THIRD_SLOTS[Math.max(0, Math.min(20, level))] ?? [];
  }
  return [];
}

export function computeSpellSlots(data: CharacterData): SlotLevel[] {
  const classes = (data as any).classes ?? [];

  const usedByLevel = new Map<number, number>();
  for (const s of (data as any).spellSlots ?? []) usedByLevel.set(s.level, s.used ?? 0);
  const pactUsedByLevel = new Map<number, number>();
  for (const s of (data as any).pactMagic ?? []) pactUsedByLevel.set(s.level, s.used ?? 0);

  // Partition spellcasting classes into Warlock (Pact Magic) and the shared Vancian table.
  const vancian: Array<{ name: string; sub: string; level: number }> = [];
  let warlockLevel = 0;
  for (const cl of classes) {
    const name = cl?.definition?.name ?? "";
    const sub = cl?.subclassDefinition?.name ?? "";
    const level = cl?.level ?? 0;
    if (name.toLowerCase() === "warlock") {
      warlockLevel += level;
      continue;
    }
    if (isSpellcaster(name, sub)) vancian.push({ name, sub, level });
  }

  // Build the Vancian rows.
  let row: number[] = [];
  if (vancian.length === 1) {
    // Exactly one non-Warlock spellcasting class: use its OWN single-class progression.
    const only = vancian[0]!;
    row = singleClassRow(only.name, only.sub, only.level);
  } else if (vancian.length > 1) {
    // Genuine multiclass: sum effective caster levels with the shared floor-rounding rules.
    let eff = 0;
    for (const v of vancian) eff += casterLevels(v.name, v.sub, v.level);
    eff = Math.max(0, Math.min(20, eff));
    row = SLOTS[eff] ?? [];
  }

  const out: SlotLevel[] = [];
  row.forEach((total, i) => {
    const level = i + 1;
    if (total > 0) out.push({ level, total, used: usedByLevel.get(level) ?? 0 });
  });

  // Append Warlock Pact Magic as a separate, flagged track (does not merge into the table).
  if (warlockLevel > 0) {
    const [count, slotLevel] = PACT[Math.max(0, Math.min(20, warlockLevel))] ?? [0, 0];
    if (count > 0 && slotLevel > 0) {
      out.push({ level: slotLevel, total: count, used: pactUsedByLevel.get(slotLevel) ?? 0, pact: true });
    }
  }

  return out;
}
