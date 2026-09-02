// poke5e Pokémon team + moves. A trainer's team comes from get_pokemon (keyed by the trainer's
// uuid); each Pokémon's learned moves from get_moveset (move_id + PP). Move mechanics live in the
// static moves reference (poke5e.app/moves.json). We compute each move's to-hit / save DC / damage
// the way poke5e's own sheet does, and normalize a Pokémon into the engine's RollModel with its
// moves exposed as rollable "spells" (attack / save / utility), so the existing UI drives them.

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";
import { poke5eRpc } from "./source";
import { abilityIds, moveAbilityMods } from "./abilities-engine";
import type { AbilityMod } from "./abilities-engine";
import { moveFeatMods } from "./feats-engine";
import { primarySpeed, type SpeedMode } from "./speed";

// poke5e status conditions that alter the Pokémon's OWN move rolls (from /reference/status-conditions).
// Rendered/applied via the existing ability-mod machinery (cond:{status} is evaluated live against the
// Pokémon's current status). Guts negates the burn/poison penalties. Returned per-move.
export function statusMoveMods(casting: "attack" | "save" | "utility", hasDamage: boolean, hasGuts: boolean): AbilityMod[] {
  const out: AbilityMod[] = [];
  if (casting === "attack") {
    // Poisoned / Badly Poisoned & Flinched → disadvantage on attack rolls.
    if (!hasGuts) out.push({ ability: "⚠ Poisoned", cond: { status: "poison" }, attackDisadvantage: true, note: "disadvantage on attacks (poisoned)" });
    out.push({ ability: "⚠ Flinched", cond: { status: "flinch" }, attackDisadvantage: true, note: "disadvantage on attacks (flinched)" });
  }
  // Burned → damage rolls at disadvantage (roll twice, keep the lower). Reminder (not auto-rollable).
  if (hasDamage && !hasGuts) out.push({ ability: "⚠ Burned", cond: { status: "burn" }, note: "roll damage twice, keep the lower total (burned)" });
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

// Static moves reference, cached.
let movesCache: Record<string, any> | null = null;
export async function movesMap(): Promise<Record<string, any>> {
  if (movesCache) return movesCache;
  try {
    const r = await fetch("https://poke5e.app/moves.json");
    const j: any = await r.json();
    const arr: any[] = j.moves || j.values || [];
    const map: Record<string, any> = {};
    for (const m of arr) if (m.id) map[m.id] = m;
    movesCache = map;
  } catch {
    movesCache = {};
  }
  return movesCache;
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
    bond: { level: Number(pk.bond_level) || 0, cur: Number(pk.bond_points_cur) || 0, max: Number(pk.bond_points_max) || 0 },
  };
}

/** Pokémon type[] (its own types), used for STAB. */
function pokemonTypes(pk: any): string[] {
  const t = pk.type;
  return Array.isArray(t) ? t.map((x: string) => String(x).toLowerCase()) : t ? [String(t).toLowerCase()] : [];
}

/** Best ability modifier a move can use (its `power` lists the allowed attributes). */
function bestPowerMod(pk: any, power: any): number {
  const mods: Record<string, number> = {};
  for (const a of Object.keys(ATTR_ABILITY)) mods[a] = abilityMod(Number(pk[({ str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" } as any)[a]]) || 10);
  if (Array.isArray(power) && power.length) return Math.max(...power.map((a: string) => mods[a] ?? 0));
  if (power === "any") return Math.max(...Object.values(mods));
  return 0; // "none" | "varies"
}

/** The damage dice for a move at a Pokémon's level (highest threshold ≤ level). */
function damageDiceForLevel(dice: Record<string, string> | undefined, level: number): string {
  if (!dice) return "";
  let best = "";
  for (const k of ["1", "5", "10", "17"]) if (Number(k) <= level && dice[k]) best = dice[k];
  return best;
}

export interface MoveStat {
  name: string;
  type: string;
  casting: "attack" | "save" | "utility";
  attackBonus?: number;
  saveAbility?: Ability;
  saveDc?: number;
  damageDice?: string; // full formula, e.g. "2d10 + 3"
  damageType?: string;
  healDice?: string;
  autoHit?: boolean; // damage move with no to-hit / no save — guaranteed hit (Swift, Aura Sphere, …)
  rollDie?: string; // a utility move whose prose is "roll a d20/d100/…" (OHKO moves, Metronome, …)
  note?: string; // a per-move reminder (charge / recharge, from the move's `time`)
  pp?: { current: number; max: number };
  isCantrip: boolean;
  level: number;
  stab: number; // this move's STAB value (for the abilities engine)
  description?: string; // the move's full wording — for "Display in VTT"
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
function computeStab(pk: any, moveMod: number, level: number): number {
  const base = String(pk.stab_base || "default");
  const bonus = Number(pk.stab_bonus) || 0;
  let b: number;
  switch (base) {
    case "movepower": b = Math.max(moveMod, 0); break;
    case "ruleset18": b = Math.floor((level + 1) / 4); break;
    case "none": b = 0; break;
    default: b = profFor(level); break; // "default" (2024) and "proficiency"
  }
  return Math.max(0, b + bonus);
}

export function moveStat(move: any, pk: any, learned?: any): MoveStat {
  const level = Number(pk.level) || 1;
  const pb = profFor(level);
  const mod = bestPowerMod(pk, move.power);
  const types = pokemonTypes(pk);
  // STAB applies only when the move's type matches one of the Pokémon's types.
  const stab = types.includes(String(move.type).toLowerCase()) ? computeStab(pk, mod, level) : 0;

  const dmg = move.damage;
  let damageDice = "";
  let healDice = "";
  let damageType: string | undefined;
  if (dmg) {
    const base = damageDiceForLevel(dmg.dice, level);
    let flat = 0;
    const m = dmg.modifier;
    if (typeof m === "number") flat = m;
    else if (m === "MOVE") flat = mod;
    else if (m === "LEVEL") flat = level;
    else if (typeof m === "string" && /MOVE/.test(m)) flat = mod + (/STAB/.test(m) ? stab : 0);
    else if (typeof m === "string" && /STAB/.test(m)) flat = stab;
    const formula = base ? (flat ? `${base}${flat >= 0 ? " + " + flat : " - " + -flat}` : base) : flat ? String(flat) : "";
    const dtype = Array.isArray(dmg.type) ? dmg.type[0] : dmg.type;
    if (dtype === "healing") healDice = formula;
    else { damageDice = formula; damageType = dtype && dtype !== "typeless" ? String(dtype) : String(move.type); }
  }

  const casting: MoveStat["casting"] = move.attack ? "attack" : move.save ? "save" : "utility";
  const out: MoveStat = { name: move.name || "Move", type: String(move.type || ""), casting, isCantrip: false, level: 0, stab };
  // Carry the move's full wording (and range) through so the sheet can "Display in VTT".
  const wording = moveWording(move.description);
  if (wording) out.description = wording;
  if (move.range) out.range = String(move.range);
  if (casting === "attack") out.attackBonus = pb + mod;
  if (casting === "save") {
    out.saveDc = 8 + pb + mod;
    const sa = move.save && Array.isArray(move.save.attribute) ? move.save.attribute[0] : null;
    if (sa && ATTR_ABILITY[sa]) out.saveAbility = ATTR_ABILITY[sa];
  }
  if (damageDice) out.damageDice = damageDice;
  if (healDice) out.healDice = healDice;
  if (damageType) out.damageType = damageType;
  // A damaging move with no to-hit and no save is a guaranteed hit (Swift, Aura Sphere, Magical
  // Leaf, …) — it must still ROLL its damage, not be a no-dice announcement.
  if (casting === "utility" && damageDice) out.autoHit = true;
  // OHKO / special moves whose ONLY mechanic is a die roll described in prose (Sheer Cold, Fissure,
  // Horn Drill, Guillotine, Explosion → d20; Metronome → d100; Acupressure → d6). Surface the die.
  if (casting === "utility" && !damageDice && !healDice) {
    const desc = moveWording(move.description);
    const rm = /roll (?:a |1)?d(\d+)/i.exec(desc);
    if (rm) out.rollDie = `1d${rm[1]}`;
  }
  // Charge / recharge moves (from `time`, e.g. "1 action, recharge"): surface a reminder on use.
  const time = String(move.time || "").toLowerCase();
  if (/recharge/.test(time)) out.note = "must recharge — no move on your next turn";
  else if (/charge/.test(time)) out.note = "charges now — fires on your next turn (keep concentration)";
  if (learned) out.pp = { current: Number(learned.pp_cur) || 0, max: Number(learned.pp_max) || 0 };
  return out;
}

/** Normalize a Pokémon row + its moveset into a RollModel + HP + moves-as-spells. */
export function pokemonToCharacter(
  pk: any,
  moveset: any[],
  moves: Record<string, any>,
  featNames: string[] = [], // the Pokémon's feat names (from get_pokemon_feats) — for the feats engine
  speciesSpeeds: SpeedMode[] = [], // movement modes from the SPECIES (pokemon.json); poke5e stores no speed on the pokémon row
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
  const skills = {} as Record<SkillKey, SkillValue>;
  for (const s of SKILLS) {
    const proficient = !!pk[`prof_${s.key.replace(/-/g, "_")}`];
    skills[s.key] = { mod: abilities[s.ability].mod + (proficient ? profBonus : 0), ability: s.ability, proficient, expertise: false };
  }
  const passive = (k: SkillKey) => 10 + skills[k].mod;
  const maxHp = Number(pk.hp_max) || 0;
  const curHp = pk.hp_cur != null ? Number(pk.hp_cur) : maxHp;
  const nick = pk.nickname && String(pk.nickname).trim() ? String(pk.nickname).trim() : String(pk.species || "Pokémon");

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
  };

  // Moves → rollable "spells".
  const ids = abilityIds(pk);
  const hasGuts = ids.includes("guts"); // Guts negates the burn/poison attack & damage penalties
  const ownTypes = pokemonTypes(pk);
  const spells = moveset
    .map((lm) => {
      const ref = moves[lm.move_id];
      if (!ref) return null;
      const st = moveStat(ref, pk, lm);
      const abilityMods = moveAbilityMods(ids, { casting: st.casting, type: st.type, hasDamage: !!st.damageDice, name: st.name, ppMax: st.pp?.max }, { types: ownTypes, stab: st.stab, pb: profBonus });
      // Merge in FEAT modifiers (Combo Master, Melee Master, …) — they render/apply like ability mods.
      const featMods = moveFeatMods(featNames, { casting: st.casting, name: st.name, scope: ref.attack?.scope, powerHasStr: Array.isArray(ref.power) && ref.power.includes("str"), hasDamage: !!st.damageDice }, { pb: profBonus });
      const statusMods = statusMoveMods(st.casting, !!st.damageDice, hasGuts);
      return {
        name: st.name,
        level: 0,
        isCantrip: true, // moves are at-will (PP-limited, not slot-limited)
        casting: st.casting,
        type: st.type, // the move's type (Fire, Psychic, …) — for tags + the Display-in-VTT meta line
        attackBonus: st.attackBonus,
        saveAbility: st.saveAbility,
        saveDc: st.saveDc,
        damageDice: st.damageDice,
        damageType: st.damageType,
        healDice: st.healDice,
        autoHit: st.autoHit, // guaranteed-hit damage (no to-hit)
        rollDie: st.rollDie, // OHKO / prose "roll a dN" moves
        moveHint: st.note, // charge / recharge reminder
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

  const atkMods = spells.filter((s: any) => s.casting === "attack").map((s: any) => s.attackBonus);
  const dcs = spells.filter((s: any) => s.casting === "save").map((s: any) => s.saveDc);
  const spellcasting = spells.length
    ? { classes: [{ name: "Moves", attackBonus: atkMods[0] ?? profBonus, saveDc: dcs[0] ?? 8 + profBonus }], spells }
    : null;

  return { model, hp: { current: curHp, max: maxHp, temp: 0, removed: Math.max(0, maxHp - curHp) }, spellcasting };
}
