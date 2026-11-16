// poke5e Pokémon team + moves. A trainer's team comes from get_pokemon (keyed by the trainer's
// uuid); each Pokémon's learned moves from get_moveset (move_id + PP + per-move customization). Move
// mechanics come from poke5e's SRD moves API (poke5e.app/srd/v1/<edition>/moves.json) — the same data
// its own sheet reads. We compute each move's to-hit / save DC / damage the way poke5e's sheet does
// (Move.calculateMoveStats), and normalize a Pokémon into the engine's RollModel with its moves
// exposed as rollable "spells" (attack / save / utility), so the existing UI drives them.

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";
import { poke5eRpc } from "./source";
import { abilityIds, moveAbilityMods } from "./abilities-engine";
import type { AbilityMod } from "./abilities-engine";
import { moveFeatMods } from "./feats-engine";
import { primarySpeed, type SpeedMode } from "./speed";
import { specSkillBonus } from "./specializations";
import { patchMoveData, moveFix } from "./move-mechanics";

// poke5e status conditions that alter the Pokémon's OWN move rolls (from /reference/status-conditions).
// Rendered/applied via the existing ability-mod machinery (cond:{status} is evaluated live against the
// Pokémon's current status). Guts negates the burn/poison penalties. Returned per-move.
export function statusMoveMods(casting: "attack" | "save" | "utility", hasDamage: boolean, hasGuts: boolean, edition: "2018" | "2024" = "2024"): AbilityMod[] {
  const out: AbilityMod[] = [];
  if (casting === "attack") {
    // Poisoned / Badly Poisoned & Flinched → disadvantage on attack rolls.
    if (!hasGuts) out.push({ ability: "⚠ Poisoned", cond: { status: "poison" }, attackDisadvantage: true, note: "disadvantage on attacks (poisoned)" });
    out.push({ ability: "⚠ Flinched", cond: { status: "flinch" }, attackDisadvantage: true, note: "disadvantage on attacks (flinched)" });
  }
  // Flinched → a move that calls for a save gives its targets advantage on it.
  if (casting === "save") out.push({ ability: "⚠ Flinched", cond: { status: "flinch" }, note: "targets roll the save with advantage (flinched)" });
  // Burned → damage rolls at disadvantage (roll twice, keep the lower). Reminder (not auto-rollable).
  if (hasDamage && !hasGuts) out.push({ ability: "⚠ Burned", cond: { status: "burn" }, note: "roll damage twice, keep the lower total (burned)" });
  // Statuses that decide whether the move happens at all — reminders on every move.
  out.push({ ability: "⚠ Asleep", cond: { status: "asleep" }, note: "incapacitated — it can't use moves while asleep (Sleep Talk and Snore excepted)" });
  out.push({ ability: "⚠ Frozen", cond: { status: "frozen" }, note: "incapacitated — it can't use moves until it breaks free" });
  out.push({ ability: "⚠ Paralysis", cond: { status: "paralys" }, note: "roll a d4 at the start of its turn — on a 1 it's incapacitated until its next turn" });
  out.push({ ability: "⚠ Confused", cond: { status: "confus" }, note: edition === "2018"
    ? "before acting roll a d20 — on 10 or lower it drops concentration, takes typeless damage equal to its proficiency bonus and the move fails; on 16+ the confusion ends"
    : "roll a d8 at the start of its turn — 1: Struggle against itself (auto-hit), 2: Struggle against the nearest Pokémon, 3: no move or action, 4-7: acts normally, 8: the confusion ends" });
  return out;
}

const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const profFor = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

const ABILITY_COL: Record<Ability, string> = {
  STR: "strength", DEX: "dexterity", CON: "constitution", INT: "intelligence", WIS: "wisdom", CHA: "charisma",
};
const ATTR_ABILITY: Record<string, Ability> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

const SKILLS: { key: SkillKey; ability: Ability }[] = [
  { key: "acrobatics", ability: "DEX" }, { key: "animal-handling", ability: "WIS" }, { key: "arcana", ability: "INT" },
  { key: "athletics", ability: "STR" }, { key: "deception", ability: "CHA" }, { key: "history", ability: "INT" },
  { key: "insight", ability: "WIS" }, { key: "intimidation", ability: "CHA" }, { key: "investigation", ability: "INT" },
  { key: "medicine", ability: "WIS" }, { key: "nature", ability: "INT" }, { key: "perception", ability: "WIS" },
  { key: "performance", ability: "CHA" }, { key: "persuasion", ability: "CHA" }, { key: "religion", ability: "INT" },
  { key: "sleight-of-hand", ability: "DEX" }, { key: "stealth", ability: "DEX" }, { key: "survival", ability: "WIS" },
];

/** A poke5e rules edition. poke5e keeps the reader's choice in its own localStorage ("rules-version"). */
export type Poke5eEdition = "2018" | "2024";

// Moves reference, cached per edition. poke5e's sheet reads its SRD moves API (dice classes, MOVE
// modifiers, saves); the older static /moves.json has stale dice for ~35 moves (Aura Wheel 1d8 vs the
// sheet's 3d6), so it's only the fallback — and the source of charge/recharge timing, which the SRD's
// `time` doesn't carry. A failed fetch isn't cached, so the next Pokémon load retries.
const movesCache: Partial<Record<Poke5eEdition, Record<string, any>>> = {};
let legacyMovesCache: Record<string, any> | null = null;

async function legacyMoves(): Promise<Record<string, any>> {
  if (legacyMovesCache) return legacyMovesCache;
  const r = await fetch("https://poke5e.app/moves.json");
  if (!r.ok) throw new Error(`moves.json ${r.status}`);
  const j: any = await r.json();
  const map: Record<string, any> = {};
  for (const m of j.moves || j.values || []) if (m?.id) map[m.id] = m;
  legacyMovesCache = map;
  return map;
}

/** Every move by id, in the legacy shape the engine reads (damage dice per level, modifier, type). */
export async function movesMap(edition: Poke5eEdition = "2018"): Promise<Record<string, any>> {
  const hit = movesCache[edition];
  if (hit) return hit;
  const [srd, legacy] = await Promise.all([
    fetch(`https://poke5e.app/srd/v1/${edition}/moves.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`srd moves ${r.status}`))))
      .catch(() => null),
    legacyMoves().catch(() => ({}) as Record<string, any>),
  ]);
  const values: any[] = Array.isArray(srd?.values) ? srd.values : [];
  if (!values.length) return legacy; // SRD unreachable → the older static data, uncached
  const map: Record<string, any> = { ...legacy };
  for (const m of values) if (m?.id) map[m.id] = srdMoveToLegacy(m, legacy[m.id]);
  movesCache[edition] = map;
  return map;
}

export function resetMovesCacheForTests() {
  delete movesCache["2018"];
  delete movesCache["2024"];
  legacyMovesCache = null;
}

// poke5e's dice classes (src/lib/moves/dice/DiceClass.ts): a move's damage dice at levels 1 / 5 / 10 / 17.
const DICE_CLASSES: Record<string, [string, string, string, string]> = {
  "0": ["1d4", "1d6", "1d8", "1d10"], "10": ["1d4", "1d6", "1d8", "2d6"], "20": ["1d4", "2d4", "1d12", "4d4"],
  "30": ["1d6", "1d10", "2d8", "5d4"], "40": ["1d6", "1d12", "2d8", "4d6"], "50": ["1d8", "2d6", "4d4", "3d10"],
  "60": ["1d10", "2d8", "5d4", "4d8"], "70": ["1d12", "2d8", "2d12", "6d6"], "80": ["2d6", "2d8", "4d6", "6d6"],
  "90": ["2d8", "2d10", "3d10", "4d12"], "100": ["4d4", "2d12", "4d8", "8d6"], "110": ["3d6", "3d8", "6d6", "7d8"],
  "120": ["2d10", "3d8", "4d10", "7d8"], "130": ["5d4", "3d10", "5d8", "8d8"], "140": ["2d12", "3d10", "7d6", "8d8"],
  "150": ["3d8", "5d6", "4d12", "8d8"], "160": ["4d6", "5d6", "6d8", "6d12"], "180": ["3d10", "6d6", "8d6", "7d12"],
  "200": ["5d6", "4d10", "6d10", "8d12"],
};

/** Whether a move's dice class is one Conduit knows (an unknown one would fall back to the old dice). */
export function isKnownDiceClass(cls: unknown): boolean {
  return String(cls) in DICE_CLASSES;
}

// poke5e's English wording for a move's area (MoveShape.display).
function shapeText(shape: any): string {
  const v = shape?.value;
  switch (shape?.type) {
    case "cone": return `${v}-foot cone`;
    case "cube": return `${v}-foot cube`;
    case "emanation": return `${v}-foot emanation`;
    case "line": return `${v}-foot line`;
    case "cylinder": return `${v}-foot-radius, ${shape?.otherValues?.[0] ?? 0}-foot-high cylinder`;
    case "sphere": return `${v}-foot-radius sphere`;
    default: return shape ? `${v} ${shape.unit} ${shape.type}` : "<?> shape";
  }
}

/** One SRD move → the legacy /moves.json shape the engine reads. Dice come from the move's dice class
 *  (or custom tiers); the wording's {dice}/{type}/{save}/{shape} placeholders are filled the way poke5e
 *  renders them (Move.description). Fields the SRD lacks (charge/recharge timing, a typeless or
 *  multi-type damage label, range text) come from the legacy entry when there is one. */
export function srdMoveToLegacy(m: any, legacy?: any): any {
  const d = m.dice;
  const tiers: string[] | undefined = d ? (d.class === "custom" ? d.tiers : DICE_CLASSES[String(d.class)]) : undefined;
  const legacyType = legacy?.damage?.type;
  const damage = d && Array.isArray(tiers) && tiers.length === 4
    ? {
      dice: { "1": tiers[0], "5": tiers[1], "10": tiers[2], "17": tiers[3] },
      modifier: d.modifier,
      type: d.type === "healing" ? "healing" : d.type === "reduction" ? "reduction"
        : legacyType && legacyType !== "healing" ? legacyType : [m.type],
    }
    : d ? legacy?.damage : undefined; // an unknown dice class → keep the old dice rather than none
  const attrs = (a: any) => (Array.isArray(a) ? a : a ? [a] : []).map((x: any) => String(x));
  const diceText = tiers ? (String(d.modifier) === "0" ? tiers[0] : `${tiers[0]} + ${d.modifier}`) : "<?>";
  const saveText = m.save ? `${attrs(m.save.attribute).map((x) => x.toUpperCase()).join("/")} save against your Move DC` : "<?>";
  const raw = Array.isArray(m.description) ? m.description.join("\n\n") : String(m.description ?? "");
  const text = raw.replace(/\{(dice|type|save|shape)\}/g, (tok: string, key: string) =>
    key === "dice" ? diceText : key === "type" ? String(m.type) : key === "save" ? saveText : key === "shape" ? shapeText(m.shape) : tok);
  const unit = String(m.time?.unit || "action");
  const legacyTime = legacy?.time ? String(legacy.time) : "";
  const legacyUnit = /bonus/i.test(legacyTime) ? "bonus action" : /reaction/i.test(legacyTime) ? "reaction" : "action";
  const higher = m.higherLevels ?? (tiers && d.class !== "custom" && new Set(tiers).size > 1
    ? `The ${d.type} dice roll for this move changes to ${tiers[1]} at level 5, ${tiers[2]} at level 10, and ${tiers[3]} at level 17.`
    : legacy?.higherLevels);
  return {
    ...(legacy ?? {}),
    id: m.id,
    name: m.name ?? legacy?.name,
    type: m.type ?? legacy?.type,
    power: Array.isArray(m.power) && m.power.length ? m.power : legacy?.power ?? "none",
    time: legacyTime && legacyUnit === unit ? legacyTime : `1 ${unit}`,
    pp: m.pp ?? legacy?.pp,
    description: m.table ? [text, m.table] : [text],
    higherLevels: higher,
    attack: m.attack ? { scope: m.attack.scope } : undefined,
    save: m.save ? { attribute: attrs(m.save.attribute), dc: "MOVE" } : undefined,
    damage,
    categories: m.categories ?? legacy?.categories,
  };
}

export async function fetchPokemon(trainerId: string): Promise<any[]> {
  const rows = await poke5eRpc("get_pokemon", { _trainer_id: trainerId }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
export async function fetchMoveset(pokemonId: number): Promise<any[]> {
  const rows = await poke5eRpc("get_moveset", { _pokemon_id: pokemonId }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
export async function fetchPokemonFeats(pokemonId: number): Promise<{ name: string; description: string }[]> {
  const rows = await poke5eRpc("get_pokemon_feats", { _pokemon_id: pokemonId }).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((f: any) => ({ name: f.feat_name || "Feat", description: f.description || "" }));
}

// Static abilities reference (id → name/description), cached — for a Pokémon's passive abilities.
let abilitiesCache: Record<string, { name: string; description: string }> | null = null;
async function abilitiesMap(): Promise<Record<string, { name: string; description: string }>> {
  if (abilitiesCache) return abilitiesCache;
  try {
    // The abilities reference lives at /data/abilities.json with an `items` array — NOT /abilities.json
    // (404) with an `abilities` key, which is what this used to request (leaving every ability blank).
    const r = await fetch("https://poke5e.app/data/abilities.json");
    const j: any = await r.json();
    const arr: any[] = j.items || j.abilities || j.values || [];
    const map: Record<string, { name: string; description: string }> = {};
    for (const a of arr) if (a.id) map[a.id] = { name: a.name, description: a.description || "" };
    abilitiesCache = map;
  } catch {
    abilitiesCache = {};
  }
  return abilitiesCache;
}

/** A Pokémon's passive abilities (from the `abilities` JSON on the row) resolved to name+desc. */
export async function resolveAbilities(pk: any): Promise<{ name: string; description: string }[]> {
  const list: any[] = Array.isArray(pk.abilities) ? pk.abilities : [];
  if (!list.length) return [];
  const ref = await abilitiesMap();
  return list.map((a) => {
    const id = typeof a === "string" ? a : a.referenceId || a.id;
    const r = ref[id];
    // Prefer the authoritative reference (proper name + text); fall back to any name/description the
    // row itself carries, then to the raw id — so a missing reference never blanks the ability out.
    const inline = typeof a === "object" && a ? a : null;
    return {
      name: r?.name || inline?.name || String(id),
      description: r?.description || inline?.description || "",
    };
  });
}

/** Display metadata for a Pokémon's header (types / nature / tera / status / bond). */
export function pokemonMeta(pk: any) {
  const types = Array.isArray(pk.type) ? pk.type : pk.type ? [pk.type] : [];
  return {
    species: pk.species || "",
    types: types.map((t: string) => String(t)),
    nature: pk.nature || "",
    tera: pk.tera_type || "",
    status: pk.status || "",
    shiny: !!pk.is_shiny,
    exp: Number(pk.exp) || 0,
    bond: { level: Number(pk.bond_level) || 0, cur: Number(pk.bond_points_cur) || 0, max: Number(pk.bond_points_max) || 0 },
  };
}

/** Pokémon type[] (its own types), used for STAB. */
function pokemonTypes(pk: any): string[] {
  const t = pk.type;
  return Array.isArray(t) ? t.map((x: string) => String(x).toLowerCase()) : t ? [String(t).toLowerCase()] : [];
}

const POWER_COL: Record<string, string> = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" };

/** The best ability a move can use for its power (its `power` lists the allowed attributes), with the
 *  winning ability's UPPERCASE label — so a roll's bonus can show WHERE it comes from. Ties keep the
 *  first-listed ability. Returns {ability:null, mod:0} for "none"/"varies". */
function bestPowerAbility(pk: any, power: any): { ability: string | null; mod: number } {
  const cand: string[] = Array.isArray(power) && power.length ? power : power === "any" ? Object.keys(POWER_COL) : [];
  let best: { ability: string | null; mod: number } = { ability: null, mod: 0 };
  for (const a of cand) {
    const col = POWER_COL[a];
    if (!col) continue;
    const m = abilityMod(Number(pk[col]) || 10);
    if (best.ability === null || m > best.mod) best = { ability: a.toUpperCase(), mod: m };
  }
  return best;
}

/** A signed value for tooltips, e.g. 2 → "+2", -1 → "−1" (real minus). */
const signed = (v: number) => (v >= 0 ? `+${v}` : `−${Math.abs(v)}`);

/** Struggle — the universal fallback move (poke5e /reference). Typeless, STR-or-DEX, 2 + MOVE damage,
 *  never boosted by STAB/items/abilities. Modeled as "MOVE + 2" over empty dice so it's a flat hit. */
const STRUGGLE_MOVE = {
  name: "Struggle", type: "typeless", power: ["str", "dex"], attack: { scope: "ranged" }, range: "melee/60ft",
  damage: { dice: {}, modifier: "MOVE + 2", type: ["typeless"] },
  description: ["Known by all Pokémon; usable at any time. Make a melee or ranged attack roll, dealing 2 + MOVE typeless damage on a hit. This damage cannot be increased by another move, item, or ability."],
};

/** Parse a move's damage `modifier` into a flat total + labeled components (for the tooltip). Tokens
 *  are joined by "+": MOVE→best ability mod, LEVEL→the Pokémon's level, STAB→its STAB value, and any
 *  numeric literal (e.g. "MOVE + 5"). STAB is auto-added for a type-matching, non-healing move even
 *  when the modifier doesn't name it (poke5e applies STAB by type-match); an explicit STAB token
 *  covers moves whose type "varies". Never double-counts STAB. */
function parseDamageFlat(
  m: unknown,
  ctx: { mod: number; ability: string | null; level: number; stab: number; typeMatch: boolean },
): { flat: number; parts: { label: string; value: number }[] } {
  const parts: { label: string; value: number }[] = [];
  let hasStabToken = false;
  for (const t of m == null ? [] : String(m).split("+").map((x) => x.trim()).filter(Boolean)) {
    const up = t.toUpperCase();
    // MOVE is listed even at +0 (it adds nothing) so the tooltip shows it was counted ("+0 CHA").
    if (up === "MOVE") { if (ctx.mod || ctx.ability) parts.push({ label: ctx.ability || "move", value: ctx.mod }); }
    else if (up === "LEVEL") { if (ctx.level) parts.push({ label: "level", value: ctx.level }); }
    else if (up === "STAB") { hasStabToken = true; if (ctx.stab) parts.push({ label: "STAB", value: ctx.stab }); }
    else if (/^-?\d+$/.test(t)) { const n = Number(t); if (n) parts.push({ label: "flat", value: n }); }
  }
  if (ctx.typeMatch && !hasStabToken && ctx.stab) parts.push({ label: "STAB", value: ctx.stab });
  return { flat: parts.reduce((s, p) => s + p.value, 0), parts };
}

/** The damage dice for a move at a Pokémon's level (highest threshold ≤ level). */
function damageDiceForLevel(dice: Record<string, string> | undefined, level: number): string {
  if (!dice) return "";
  let best = "";
  for (const k of ["1", "5", "10", "17"]) if (Number(k) <= level && dice[k]) best = dice[k];
  // "Rd6" (Rollout, Outrage): R = the round/hit count, which starts at one die and grows each round —
  // roll the first round's single die; the move's note gives the escalation.
  return best.replace(/^R(?=d\d)/i, "1");
}

export interface MoveStat {
  name: string;
  type: string;
  casting: "attack" | "save" | "utility";
  attackBonus?: number;
  attacks?: number; // FIXED multi-attack: this many separate attack+damage rolls (Bubble = 3). undefined = single.
  multiTarget?: boolean; // a FIXED multi-attack that may spread across separate targets (Dragon Darts, Zing Zap).
  damageDiceNoStab?: string; // damageDice with the STAB component removed — used for the 2nd+ hits of a multi-attack (STAB is once per target, auto-applied to the first hit only).
  saveAbility?: Ability;
  saveDc?: number;
  damageDice?: string; // full formula, e.g. "2d10 + 3"
  damageType?: string;
  healDice?: string;
  autoHit?: boolean; // damage move with no to-hit / no save — guaranteed hit (Swift, Aura Sphere, …)
  rollDie?: string; // a utility move whose prose is "roll a d20/d100/…" (OHKO moves, Metronome, …)
  note?: string; // a per-move reminder (charge / recharge, from the move's `time`)
  castingTime?: "action" | "bonus" | "reaction"; // action economy, from the move's `time` field
  mechanicNote?: string; // rule the engine can't auto-apply (from the move-mechanics overlay), shown on use
  pp?: { current: number; max: number };
  isCantrip: boolean;
  level: number;
  stab: number; // this move's STAB value (for the abilities engine)
  attackTip?: string; // breakdown of the to-hit bonus, e.g. "+2 prof +1 WIS"
  saveTip?: string; // breakdown of the save DC, e.g. "8 base +2 prof +1 WIS"
  damageTip?: string; // breakdown of the damage, e.g. "1d8 +1 WIS +2 STAB"
  description?: string; // the move's full wording — for "Display in VTT"
  reductionDice?: string; // a damage-REDUCTION roll (Harden: reduce incoming damage by 1d4 + MOVE)
  rollLabel?: string; // what rollDie is for ("self-damage", "PP drained …") — default "roll"
  extraRolls?: { label: string; dice: string }[]; // more dice the card rolls on their own lines (status d6, Protect's d20 …)
  critRange?: number; // the move crits on a natural roll ≥ this (19 for "critical hit on 19 and 20")
  advantage?: "advantage" | "disadvantage"; // the move's own attack roll is made this way (Dig, Revenge …)
  customized?: string[]; // poke5e move customizations applied (to-hit / damage / DC bonus, type, powers)
  range?: string; // the move's range text (e.g. "40ft") — for the display card's meta line
}

/** Flatten a move's `description` (string, or an array of strings and/or structured `table` objects)
 *  into readable prose for the roll-die sniff and the "Display in VTT" card. Table rows collapse to
 *  "cell: cell" pairs so a move like Fling still reads sensibly on the table. */
export function moveWording(desc: any): string {
  if (!desc) return "";
  if (typeof desc === "string") return desc;
  if (!Array.isArray(desc)) return String(desc);
  const parts: string[] = [];
  for (const el of desc) {
    if (typeof el === "string") parts.push(el);
    else if (el && typeof el === "object" && Array.isArray(el.rows)) {
      for (const row of el.rows) {
        if (Array.isArray(row)) parts.push(row.filter((c: any) => typeof c === "string").join(": "));
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Compute a single move's rollable stats for a given Pokémon (mirrors poke5e's calculateMoveStats). */
// Mirror poke5e's Stab.calculate: the per-Pokémon STAB value from its stored stab_base + bonus
// (default = proficiency bonus; movepower = the move's ability mod; ruleset18/none variants).
// The "default" STAB follows the rules edition the reader picked in poke5e (2018: the levelling-table
// STAB, ⌊(level+1)/4⌋; 2024: the proficiency bonus), as poke5e's sheet computes it.
function computeStab(pk: any, moveMod: number, level: number, edition: Poke5eEdition = "2024"): number {
  const base = String(pk.stab_base || "default");
  const bonus = Number(pk.stab_bonus) || 0;
  const ruleset18 = Math.floor((level + 1) / 4);
  let b: number;
  switch (base) {
    case "default": b = edition === "2018" ? ruleset18 : profFor(level); break;
    case "movepower": b = Math.max(moveMod, 0); break;
    case "proficiency": b = profFor(level); break;
    case "ruleset18": b = ruleset18; break;
    case "none": b = 0; break;
    default: b = edition === "2018" ? ruleset18 : Math.max(moveMod, 0); break; // unknown setting — poke5e's fallback
  }
  return Math.max(0, b + bonus);
}

/** A number picked by level like the damage dice (keys "1"/"5"/"10"/"17"), or the value itself. */
function byLevel<T>(v: T | Record<string, T> | undefined, level: number): T | undefined {
  if (v == null || typeof v !== "object") return v as T | undefined;
  let best: T | undefined;
  for (const k of ["1", "5", "10", "17"]) if (Number(k) <= level && (v as Record<string, T>)[k] != null) best = (v as Record<string, T>)[k];
  return best;
}

// "…scores a critical hit on 19 and 20" / "…on natural attack rolls of 16 and higher" / "a natural attack
// roll of 19 or 20 … is treated as a critical hit" → the lowest natural roll that crits.
function critRangeOf(wording: string): number | undefined {
  const a = /critical(?: hit)?s? (?:hits? )?on (?:an? )?(?:natural |nat )?(?:attack )?(?:rolls? )?(?:of )?(?:a )?(?:natural |nat )?(\d{2})s?(?:\s*(?:and|or)\s*20s?|\s*or higher|\s*and higher|\+)/i.exec(wording);
  const b = /natural (?:attack )?roll (?:of |is )?(?:a )?(\d{2}) or 20,? (?:the attack is treated as|the move scores) a critical hit/i.exec(wording);
  const n = Number((a ?? b)?.[1]);
  return n >= 2 && n < 20 ? n : undefined;
}

export function moveStat(move: any, pk: any, learned?: any, edition: Poke5eEdition = "2024"): MoveStat {
  move = patchMoveData(move); // overlay: deterministic re-render/damage/heal fixes for known gap moves
  const fix = moveFix(move.id); // overlay metadata (noStab / attacks / autoHit / note)
  const level = Number(pk.level) || 1;
  const pb = profFor(level);
  // poke5e's per-move customization (the learned-move row): other move powers, another type, and flat
  // to-hit / damage / save-DC bonuses — applied the way its sheet does (LearnedMove.applyToMoveStats).
  const customPowers = Array.isArray(learned?.custom_powers) && learned.custom_powers.length ? learned.custom_powers : null;
  const moveType = String(learned?.custom_type || move.type || "");
  const toHitBonus = Number(learned?.to_hit_modifier) || 0;
  const damageBonus = Number(learned?.damage_modifier) || 0;
  const dcBonus = Number(learned?.save_dc_modifier) || 0;
  const best = bestPowerAbility(pk, customPowers ?? move.power);
  const mod = best.mod;
  const types = pokemonTypes(pk);
  const typeMatch = types.includes(moveType.toLowerCase()); // move type == one of the Pokémon's
  const stab = typeMatch ? computeStab(pk, mod, level, edition) : 0; // this move's STAB value (0 if off-type)

  const dmg = move.damage;
  let damageDice = "";
  let damageDiceNoStab = ""; // damageDice minus the STAB component (2nd+ hits of a multi-attack; STAB is once per target)
  let healDice = "";
  let reductionDice = "";
  let damageType: string | undefined;
  let damageTip = "";
  if (dmg) {
    const base = damageDiceForLevel(dmg.dice, level);
    // The damage's own type when the data names one (Powder / Doom Desire deal typeless damage); several
    // listed (Weather Ball, Techno Blast, Flying Press) means it depends on the situation → the move's type.
    const dtypes: string[] = (Array.isArray(dmg.type) ? dmg.type : [dmg.type]).filter(Boolean).map(String);
    const dtype = dtypes.length === 1 ? dtypes[0] : moveType === "varies" ? dtypes[0] : moveType;
    const isHeal = dtype === "healing"; // STAB is a damage bonus — never added to healing
    const isReduction = dtype === "reduction"; // Harden: a damage-reduction roll, not damage
    const stabVal = computeStab(pk, mod, level, edition); // STAB value regardless of type (for explicit tokens)
    const { flat, parts } = parseDamageFlat(dmg.modifier, { mod, ability: best.ability, level, stab: stabVal, typeMatch: typeMatch && !isHeal && !isReduction && !fix?.noStab });
    if (damageBonus) parts.push({ label: "custom", value: damageBonus }); // poke5e adds it to damage, healing and reduction alike
    const total = flat + damageBonus;
    const mkFormula = (f: number) => (base ? (f ? `${base}${f >= 0 ? " + " + f : " - " + -f}` : base) : f ? String(f) : "");
    const formula = mkFormula(total);
    damageTip = [base, ...parts.map((p) => `${signed(p.value)} ${p.label}`)].filter(Boolean).join(" ");
    if (isHeal) healDice = formula;
    else if (isReduction) reductionDice = formula;
    else {
      damageDice = formula;
      damageType = learned?.custom_type && dtype === String(move.type) ? moveType : dtype || moveType;
      // STAB is a once-per-target bonus; keep every OTHER part (ability mod / flat) which is per-hit.
      // Scale Shot adds MOVE once too, so its later hits are the dice alone.
      const stabAdded = parts.find((p) => p.label === "STAB")?.value ?? 0;
      damageDiceNoStab = fix?.moveOnce ? base : stabAdded ? mkFormula(total - stabAdded) : formula;
    }
  }

  const casting: MoveStat["casting"] = move.attack ? "attack" : move.save ? "save" : "utility";
  const out: MoveStat = { name: move.name || "Move", type: moveType, casting, isCantrip: false, level: 0, stab };
  const customized = [
    toHitBonus ? `${signed(toHitBonus)} to hit` : "", damageBonus ? `${signed(damageBonus)} damage` : "", dcBonus ? `${signed(dcBonus)} DC` : "",
    learned?.custom_type ? `${moveType} type` : "", customPowers ? `${customPowers.map((x: string) => x.toUpperCase()).join("/")} power` : "",
  ].filter(Boolean);
  if (customized.length) out.customized = customized;
  if (reductionDice) { out.reductionDice = reductionDice; if (damageTip) out.damageTip = damageTip; }
  // Carry the move's full wording (and range) through so the sheet can "Display in VTT".
  const wording = moveWording(move.description);
  if (wording) out.description = wording;
  if (move.range) out.range = String(move.range);
  const abilBit = best.ability ? ` ${signed(mod)} ${best.ability}` : "";
  if (casting === "attack") {
    out.attackBonus = pb + mod + toHitBonus;
    out.attackTip = `${signed(pb)} prof${abilBit}${toHitBonus ? ` ${signed(toHitBonus)} custom` : ""}`;
    const crit = fix?.noCritRange ? undefined : critRangeOf(wording);
    if (crit) out.critRange = crit;
    // FIXED multi-attack moves (Bubble "Make three ranged attacks", Double Kick "two", …). poke5e keeps
    // the count only in the prose — the structured `attack` object has no number — so recover it here.
    // Family B ("Make a … attack roll … roll a d4 … hit again") uses the singular "a" and never matches,
    // and multi-TARGET wording ("up to two creatures") doesn't touch the count word, so it stays exact.
    const mm = /\bmake (two|three|four|five)\b[^.]*?\battacks?\b/i.exec(wording);
    const word = mm?.[1]?.toLowerCase();
    const n = word ? ({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[word] : undefined;
    if (n && n > 1) {
      out.attacks = n;
      // Multi-TARGET moves may spread the hits across separate creatures (Dragon Darts "up to two
      // creatures", Zing Zap "two unique targets", Twineedle, Dual Chop, Precipice Blades, Gear Grind
      // "target(s)"). Everything else fires all hits at one target (Bubble "at a target", etc.).
      out.multiTarget = /(?:up to \w+ (?:creatures|targets)|unique targets|(?:creature|target)\(s\)|any (?:creatures?|targets?)|(?:do(?:es)? ?n['’o]t|need not)[^.]{0,24}target the same|(?:two|three|four|five) (?:creatures|targets)|different (?:creatures?|targets?))/i.test(wording);
      // STAB is once per target, first instance. The app can't know how the hits are split across
      // targets, so it only auto-applies STAB where it's ALWAYS correct — the FIRST hit (which lands on
      // some target). Every 2nd+ hit uses the STAB-stripped damage; the player adds STAB back for each
      // ADDITIONAL target they hit (multi-target moves). This holds for single- AND multi-target moves.
      if (damageDiceNoStab && damageDiceNoStab !== damageDice) out.damageDiceNoStab = damageDiceNoStab;
    }
  }
  if (casting === "save") {
    out.saveDc = 8 + pb + mod + dcBonus;
    out.saveTip = `8 base ${signed(pb)} prof${abilBit}${dcBonus ? ` ${signed(dcBonus)} custom` : ""}`;
    const sa = move.save && Array.isArray(move.save.attribute) ? move.save.attribute[0] : null;
    if (sa && ATTR_ABILITY[sa]) out.saveAbility = ATTR_ABILITY[sa];
  }
  if (damageDice) { out.damageDice = damageDice; if (damageTip) out.damageTip = damageTip; }
  if (healDice) { out.healDice = healDice; if (damageTip) out.damageTip = damageTip; }
  if (damageType) out.damageType = damageType;
  // A damaging move with no to-hit and no save is a guaranteed hit (Swift, Aura Sphere, Magical
  // Leaf, …) — it must still ROLL its damage, not be a no-dice announcement.
  if (casting === "utility" && damageDice) out.autoHit = true;
  // OHKO / special moves whose ONLY mechanic is a die roll described in prose (Sheer Cold, Fissure,
  // Horn Drill, Guillotine, Explosion → d20; Metronome → d100; Acupressure → d6). Surface the die.
  if (casting === "utility" && !damageDice && !healDice && !fix?.noRollDie) {
    const desc = moveWording(move.description);
    const rm = /roll (?:a |1)?d(\d+)/i.exec(desc);
    if (rm) out.rollDie = `1d${rm[1]}`;
  }
  // Action economy + charge/recharge, from the move's `time` field ("1 action" / "1 bonus action" /
  // "1 reaction", optionally ", charge" / ", recharge").
  const time = String(move.time || "").toLowerCase();
  out.castingTime = /bonus action/.test(time) ? "bonus" : /reaction/.test(time) ? "reaction" : "action";
  if (/recharge/.test(time)) out.note = "must recharge — no move on your next turn";
  else if (/charge/.test(time)) out.note = "charges now — fires on your next turn (keep concentration)";
  if (learned) out.pp = { current: Number(learned.pp_cur) || 0, max: Number(learned.pp_max) || 0 };
  // Move-mechanics overlay (post-compute): a fixed multi-hit count, a guaranteed-hit flag, and the
  // rule-note the engine can't auto-apply. The damage/heal/re-render side already happened via the patch.
  if (fix) {
    const fixAttacks = byLevel(fix.attacks, level);
    if (fixAttacks && fixAttacks > 1) {
      out.attacks = fixAttacks;
      if (fix.multiTarget) out.multiTarget = true;
      // Carry the STAB-once-per-target logic to overlay multi-hits too (Population Bomb, Swift): the
      // 1st hit keeps STAB, the rest use the STAB-stripped damage. Without this on-type users would
      // over-apply STAB on every card (and Population Bomb's card would contradict its own banner).
      if (damageDiceNoStab && damageDiceNoStab !== damageDice) out.damageDiceNoStab = damageDiceNoStab;
    }
    if (fix.autoHit && (out.damageDice || out.healDice)) out.autoHit = true;
    const fixDie = byLevel(fix.rollDie, level);
    if (fixDie && !out.damageDice && !out.healDice) { out.rollDie = fixDie; if (fix.rollLabel) out.rollLabel = fix.rollLabel; }
    const extra = (fix.extraRolls ?? []).map((r) => ({ label: r.label, dice: byLevel(r.dice, level) || "" })).filter((r) => r.dice);
    // Draco Power: the same dice + MOVE again, of the chosen type (no STAB — that's the dragon half's).
    if (fix.secondDamage && damageDice) extra.push({ label: `+ ${fix.secondDamage}`, dice: damageDiceNoStab || damageDice });
    if (extra.length) out.extraRolls = extra;
    if (fix.advantage && casting === "attack") out.advantage = fix.advantage;
    if (fix.note) out.mechanicNote = fix.note;
  }
  return out;
}

/** Normalize a Pokémon row + its moveset into a RollModel + HP + moves-as-spells. */
export function pokemonToCharacter(
  pk: any,
  moveset: any[],
  moves: Record<string, any>,
  featNames: string[] = [], // the Pokémon's feat names (from get_pokemon_feats) — for the feats engine
  speciesSpeeds: SpeedMode[] = [], // movement modes from the SPECIES (pokemon.json); poke5e stores no speed on the pokémon row
  speciesName = "", // proper-cased species name (e.g. "Ivysaur") — the no-nickname display, not the raw id
  trainerSpecCounts: Record<string, number> = {}, // owning trainer's specialization counts (per type)
  edition: Poke5eEdition = "2024", // the rules edition picked in poke5e — sets the "default" STAB
): { model: RollModel; hp: { current: number; max: number; temp: number; removed: number }; spellcasting: any } {
  const level = Number(pk.level) || 1;
  const profBonus = profFor(level);
  const abilities = {} as RollModel["abilities"];
  for (const ab of Object.keys(ABILITY_COL) as Ability[]) {
    const score = Number(pk[ABILITY_COL[ab]]) || 10;
    abilities[ab] = { score, mod: abilityMod(score) };
  }
  const saves = {} as Record<Ability, SaveValue>;
  for (const ab of Object.keys(ABILITY_COL) as Ability[]) {
    const proficient = !!pk[`save_${ab.toLowerCase()}`];
    saves[ab] = { mod: abilities[ab].mod + (proficient ? profBonus : 0), proficient };
  }
  // Trainer specialization: +1 per matching-type stack, summed across this Pokémon's types, added to
  // ALL skill checks (and, through them, passive skills). Never touches saves/attacks/ability checks.
  const specBonus = specSkillBonus(trainerSpecCounts, pokemonTypes(pk));
  const skills = {} as Record<SkillKey, SkillValue>;
  for (const s of SKILLS) {
    const proficient = !!pk[`prof_${s.key.replace(/-/g, "_")}`];
    skills[s.key] = { mod: abilities[s.ability].mod + (proficient ? profBonus : 0) + specBonus, ability: s.ability, proficient, expertise: false };
  }
  const passive = (k: SkillKey) => 10 + skills[k].mod;
  const maxHp = Number(pk.hp_max) || 0;
  const curHp = pk.hp_cur != null ? Number(pk.hp_cur) : maxHp;
  const nick = pk.nickname && String(pk.nickname).trim() ? String(pk.nickname).trim() : (speciesName || String(pk.species || "Pokémon"));

  const model: RollModel = {
    name: nick,
    level,
    profBonus,
    abilities,
    saves,
    skills,
    passives: { perception: passive("perception"), investigation: passive("investigation"), insight: passive("insight") },
    initiative: abilities.DEX.mod,
    speed: primarySpeed(speciesSpeeds),
    speeds: speciesSpeeds.length ? speciesSpeeds : undefined,
    conditional: [],
    specBonus: specBonus || undefined, // trainer specialization bonus folded into every skill (for the tooltip)
  };

  // Moves → rollable "spells".
  const ids = abilityIds(pk);
  const hasGuts = ids.includes("guts"); // Guts negates the burn/poison attack & damage penalties
  const ownTypes = pokemonTypes(pk);
  const spells = moveset
    .map((lm) => {
      const ref = moves[lm.move_id];
      if (!ref) return null;
      const st = moveStat(ref, pk, lm, edition);
      const abilityMods = moveAbilityMods(ids, { casting: st.casting, type: st.type, hasDamage: !!st.damageDice, name: st.name, ppMax: st.pp?.max }, { types: ownTypes, stab: st.stab, pb: profBonus });
      // Merge in FEAT modifiers (Combo Master, Melee Master, …) — they render/apply like ability mods.
      const featMods = moveFeatMods(featNames, { casting: st.casting, name: st.name, scope: ref.attack?.scope, powerHasStr: Array.isArray(ref.power) && ref.power.includes("str"), hasDamage: !!st.damageDice }, { pb: profBonus });
      const statusMods = statusMoveMods(st.casting, !!st.damageDice, hasGuts, edition);
      return {
        name: st.name,
        level: 0,
        isCantrip: true, // moves are at-will (PP-limited, not slot-limited)
        casting: st.casting,
        type: st.type, // the move's type (Fire, Psychic, …) — for tags + the Display-in-VTT meta line
        attackBonus: st.attackBonus,
        attacks: st.attacks, // FIXED multi-attack count (Bubble = 3); undefined = single
        multiTarget: st.multiTarget, // hits may be split across separate targets → prompt to add STAB per extra target
        damageDiceNoStab: st.damageDiceNoStab, // 2nd+ hit damage for a multi-attack (STAB stripped; kept per-hit mods)
        stab: st.stab, // this move's STAB value (for the "STAB once per target" reminder)
        attackTip: st.attackTip, // to-hit breakdown (prof / ability) for the hover tooltip
        saveAbility: st.saveAbility,
        saveDc: st.saveDc,
        saveTip: st.saveTip, // save-DC breakdown for the hover tooltip
        damageDice: st.damageDice,
        damageTip: st.damageTip, // damage breakdown (ability / STAB / flat) for the hover tooltip
        damageType: st.damageType,
        healDice: st.healDice,
        autoHit: st.autoHit, // guaranteed-hit damage (no to-hit)
        rollDie: st.rollDie, // OHKO / prose "roll a dN" moves
        rollLabel: st.rollLabel, // what that die is for ("self-damage", "PP drained …")
        reductionDice: st.reductionDice, // Harden's damage-reduction roll
        extraRolls: st.extraRolls, // more dice rolled on the card's own lines (status d6, Protect's d20 …)
        critRange: st.critRange, // crits on a natural roll ≥ this (19-20 moves)
        selfAdvantage: st.advantage, // the move's own attack is rolled with advantage / disadvantage
        customized: st.customized, // poke5e move customizations in effect (for the tooltip)
        castingTime: st.castingTime, // action / bonus action / reaction → BA / RXN tags
        moveHint: st.note, // charge / recharge reminder
        mechanicNote: st.mechanicNote, // rule the engine can't auto-apply — shown prominently on use
        description: st.description, // full move wording — for "Display in VTT"
        range: st.range, // move range (e.g. "40ft") — for the Display-in-VTT meta line
        pp: st.pp,
        learnedId: lm.id, // learned-move row id (for PP write-back via update_move)
        moveId: lm.move_id,
        moveNotes: (lm as any).notes ?? "", // preserve on PP write-back (update_move upserts notes too)
        abilityMods: [...abilityMods, ...featMods, ...statusMods], // ability + feat + status effects that (conditionally) modify this move's roll
        concentration: false,
        ritual: false,
      };
    })
    .filter(Boolean);

  // Struggle — known by ALL Pokémon and usable any time (esp. when every move is out of PP). It's
  // typeless, uses the better of STR/DEX, deals 2 + MOVE, and takes no STAB/bonuses per the rules.
  {
    const st = moveStat(STRUGGLE_MOVE, pk, undefined, edition);
    spells.push({
      name: "Struggle", level: 0, isCantrip: true, casting: st.casting, type: st.type,
      attackBonus: st.attackBonus, attackTip: st.attackTip,
      damageDice: st.damageDice, damageTip: st.damageTip, damageType: st.damageType,
      description: st.description, range: st.range,
      abilityMods: [], concentration: false, ritual: false,
    } as any);
  }

  const atkMods = spells.filter((s: any) => s.casting === "attack").map((s: any) => s.attackBonus);
  const dcs = spells.filter((s: any) => s.casting === "save").map((s: any) => s.saveDc);
  const spellcasting = spells.length
    ? { classes: [{ name: "Moves", attackBonus: atkMods[0] ?? profBonus, saveDc: dcs[0] ?? 8 + profBonus }], spells }
    : null;

  return { model, hp: { current: curHp, max: maxHp, temp: 0, removed: Math.max(0, maxHp - curHp) }, spellcasting };
}
