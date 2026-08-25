// poke5e.app character source. Trainers are stored in the site's public Supabase project and
// read through SECURITY-DEFINER RPCs keyed by a 32-char "read key" — the same call the site
// itself makes. A shared character URL is poke5e.app/trainers?id=<readKey>, so the `id` query
// param IS the read key. No login is required to read.
//
// We normalize a Trainer into the engine's RollModel so the existing sheet/roll pipeline can
// drive it. (Pokémon team members & their moves are a later phase — this covers the trainer.)

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";

// poke5e's API endpoint. The site moved from the raw Supabase host
// (logncbjjfmnvbfrjdxmg.supabase.co) to the custom domain api.poke5e.app — both proxy the same
// project and still speak the Supabase REST API (/rest/v1/rpc/...). We default to the custom
// domain and auto-detect whatever the live site actually uses (see setPoke5eCredentials).
const DEFAULT_SUPABASE_URL = "https://api.poke5e.app";
// Public anon key (shipped in poke5e's own client bundle; safe to embed). This is only a FALLBACK:
// at runtime the app auto-detects the live key from poke5e.app's own API calls (see
// setPoke5eCredentials), so a rotated key — or even a new Supabase project — is picked up without a
// code change. If detection hasn't happened yet (e.g. before the pane loads), we use this default.
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvZ25jYmpqZm1udmJmcmpkeG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE2Njk1ODY2MzEsImV4cCI6MTk4NTE2MjYzMX0.RXw9pfN-4qOR2AbqPoM6GMzjDGRwYnClF9LEiI2VE5k";

let supabaseUrl = DEFAULT_SUPABASE_URL;
let anonKey = DEFAULT_ANON_KEY;

/** Decode a JWT payload without verifying the signature (we only need the claims). Portable across
 *  the Node main process and any browser-y context — no direct Buffer/atob typing dependency. */
function jwtPayload(token: string): any | null {
  const parts = token.split(".");
  const payload = parts.length === 3 ? parts[1] : "";
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const g = globalThis as any;
    const json: string =
      typeof g.Buffer !== "undefined" ? g.Buffer.from(b64, "base64").toString("utf8")
      : typeof g.atob === "function" ? decodeURIComponent(escape(g.atob(b64)))
      : "";
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

/** A token we'll accept as the poke5e key: a Supabase JWT whose role is exactly `anon`. We refuse
 *  anything elevated (e.g. a leaked `service_role`) so a bad detection can never escalate us. */
function isAcceptableAnonKey(token: string): boolean {
  const p = jwtPayload(token);
  return !!p && p.role === "anon" && p.iss === "supabase";
}

/** A host we're willing to send the read/write keys to: HTTPS on poke5e's own domain or its
 *  Supabase project host. Prevents a stray/hostile request from repointing us at an arbitrary
 *  server (which would leak keys). */
function isTrustedApiOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (/(^|\.)poke5e\.app$/i.test(u.hostname) || /(^|\.)supabase\.co$/i.test(u.hostname)) return u.origin;
    return null;
  } catch {
    return null;
  }
}

/** Point the RPC layer at credentials detected live from the poke5e site — handles key rotation or
 *  an endpoint move (e.g. supabase.co → api.poke5e.app). Validates before adopting; no-ops on
 *  empty/invalid/unchanged input. Returns true only if something actually changed. */
export function setPoke5eCredentials(creds: { url?: string | null; anonKey?: string | null }): boolean {
  let changed = false;
  const origin = isTrustedApiOrigin((creds.url || "").trim());
  const key = (creds.anonKey || "").trim();
  if (origin && origin !== supabaseUrl) {
    supabaseUrl = origin;
    changed = true;
  }
  if (key && key !== anonKey && isAcceptableAnonKey(key)) {
    anonKey = key;
    changed = true;
  }
  return changed;
}

/** The currently active poke5e endpoint + anon key (detected, or the baked-in default). */
export function getPoke5eCredentials(): { url: string; anonKey: string } {
  return { url: supabaseUrl, anonKey };
}

/** Pull a read key out of whatever the user pastes: a full share URL or the bare key. */
export function extractReadKey(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    const id = u.searchParams.get("id");
    if (id) return id.trim();
  } catch {
    /* not a URL — fall through */
  }
  // Bare key: alphanumeric, up to 32 chars.
  const m = s.match(/[A-Za-z0-9]{6,32}/);
  return m ? m[0] : null;
}

/** Current poke5e endpoint / anon key. These reflect live-detected credentials (see
 *  setPoke5eCredentials); call them at use-time rather than caching the return value. */
export const POKE5E_URL = () => supabaseUrl;
export const POKE5E_ANON = () => anonKey;

/** Call a poke5e Supabase RPC. Exported so the team/moves module can reuse it. Reads the current
 *  (possibly auto-detected) credentials on every call so a mid-session key rotation is honored. */
export async function poke5eRpc(fn: string, body: unknown): Promise<any> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`poke5e ${fn} HTTP ${res.status}`);
  return res.json();
}
const rpc = poke5eRpc;

/** Fetch the raw trainer row for a read key (null if the key is unknown). */
export async function fetchTrainer(readKey: string): Promise<any | null> {
  const rows = await rpc("get_trainer", { _read_key: readKey });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ---- Write-back (needs the trainer's write key) ----------------------------------------------
// poke5e has no targeted HP setter — HP is written by re-upserting the WHOLE row. Every RPC param
// name equals its row column with a leading underscore, so we rebuild the param set from the
// cached row and override the fields we're changing.

const PROF = ["_prof_athletics", "_prof_acrobatics", "_prof_sleight_of_hand", "_prof_stealth", "_prof_arcana", "_prof_history", "_prof_investigation", "_prof_nature", "_prof_religion", "_prof_animal_handling", "_prof_insight", "_prof_medicine", "_prof_perception", "_prof_survival", "_prof_deception", "_prof_intimidation", "_prof_performance", "_prof_persuasion"];
const SAVES = ["_save_str", "_save_dex", "_save_con", "_save_int", "_save_wis", "_save_cha"];
const TRAINER_PARAMS = ["_name", "_level", "_ac", "_hp_cur", "_hp_max", "_hit_dice_cur", "_hit_dice_max", "_strength", "_dexterity", "_constitution", "_intelligence", "_wisdom", "_charisma", ...PROF, ...SAVES];
const POKEMON_PARAMS = ["_id", "_species", "_nickname", "_type", "_nature", "_level", "_gender", "_strength", "_dexterity", "_constitution", "_intelligence", "_wisdom", "_charisma", "_ac", "_hp_cur", "_hp_max", "_hit_dice_cur", "_hit_dice_max", ...PROF, ...SAVES, "_ability", "_notes", "_tera_type", "_exp", "_status", "_held_item", "_is_shiny"];

function buildParams(names: string[], row: any, overrides: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const n of names) p[n] = n in overrides ? overrides[n] : row[n.slice(1)];
  return p;
}

/** Read the write key poke5e stores locally for a read key ("write:<readKey>"); needs the pane. */
export async function updateTrainerHp(writeKey: string, row: any, curHp: number, maxHp: number): Promise<boolean> {
  const params = { _write_key: writeKey, ...buildParams(TRAINER_PARAMS, row, { _hp_cur: curHp, _hp_max: maxHp }) };
  const r = await poke5eRpc("update_trainer", params);
  return Number(r) > 0;
}

export async function updatePokemonHp(writeKey: string, pk: any, curHp: number, maxHp: number): Promise<boolean> {
  const params = { _write_key: writeKey, ...buildParams(POKEMON_PARAMS, pk, { _hp_cur: curHp, _hp_max: maxHp }) };
  const r = await poke5eRpc("update_pokemon", params);
  return Number(r) > 0;
}

/** Update a learned move's PP (targeted RPC — the one poke5e write that isn't a full-row upsert). */
export async function updateMovePp(writeKey: string, moveRowId: number, moveId: string, ppCur: number, ppMax: number, notes = ""): Promise<boolean> {
  const r = await poke5eRpc("update_move", { _write_key: writeKey, _id: moveRowId, _move_id: moveId, _pp_cur: ppCur, _pp_max: ppMax, _notes: notes });
  return Number(r) > 0;
}

/** Set a bag item's quantity on poke5e (update_inventory_item). Handles standard vs custom items. */
export async function updateInventoryItem(
  writeKey: string,
  item: { rowId: number; itemId?: string | null; name?: string; customName?: string | null; note?: string },
  quantity: number,
): Promise<boolean> {
  const standard = !!item.itemId;
  await poke5eRpc("update_inventory_item", {
    _write_key: writeKey,
    _id: item.rowId,
    _item_id: standard ? item.itemId : null,
    _quantity: quantity,
    _custom_name: standard ? null : (item.customName || item.name || null),
    _description: standard ? null : (item.note || null),
  });
  return true; // poke5eRpc throws on failure; reaching here = written
}

// The 18 poke5e skills, in add_pokemon's `_rank_<skill>` param spelling (underscored).
const ADD_SKILLS = ["athletics", "acrobatics", "sleight_of_hand", "stealth", "arcana", "history", "investigation", "nature", "religion", "animal_handling", "insight", "medicine", "perception", "survival", "deception", "intimidation", "performance", "persuasion"];

export interface AddPokemonSpecies {
  id: string; name: string; types: string[]; ac: number; hp: number; hitDice: string; minLevel: number;
  stats: { STR: number; DEX: number; CON: number; INT: number; WIS: number; CHA: number };
  saves: string[]; skillIds: string[]; abilities: { id: string; hidden: boolean }[];
}

/** HP for a species at a given level: base (at min level) + a per-level gain (hit-die average + CON
 *  mod), an estimate the user can adjust on poke5e. */
export function scaledHp(e: AddPokemonSpecies, level: number): number {
  const die = parseInt(String(e.hitDice).replace(/\D/g, ""), 10) || 6;
  const conMod = Math.floor((e.stats.CON - 10) / 2);
  const perLevel = Math.max(1, Math.round(die / 2 + 0.5) + conMod);
  return e.hp + Math.max(0, level - (e.minLevel || 1)) * perLevel;
}

/** Pure builder for the add_pokemon RPC params — kept separate so the mapping is unit-testable
 *  without a live write (which would add a real Pokémon to the trainer). */
export function buildAddPokemonParams(writeKey: string, e: AddPokemonSpecies, level: number): Record<string, unknown> {
  const hp = scaledHp(e, level);
  const params: Record<string, unknown> = {
    _write_key: writeKey,
    _nickname: e.name,
    _species: e.id,
    _nature: "Hardy",
    _type: e.types,
    _level: level,
    _gender: "male",
    _strength: e.stats.STR, _dexterity: e.stats.DEX, _constitution: e.stats.CON,
    _intelligence: e.stats.INT, _wisdom: e.stats.WIS, _charisma: e.stats.CHA,
    _ac: e.ac, _hp_cur: hp, _hp_max: hp, _hit_dice_cur: level, _hit_dice_max: level,
    _ability: null,
    _abilities: (() => {
      const a = e.abilities.find((x) => !x.hidden) || e.abilities[0];
      return a ? [{ referenceId: a.id }] : [];
    })(),
  };
  const prof = new Set(e.skillIds.map((s) => s.replace(/-/g, "_")));
  for (const s of ADD_SKILLS) params[`_rank_${s}`] = prof.has(s) ? 1 : 0;
  const saves = new Set(e.saves.map((s) => s.toLowerCase()));
  for (const ab of ["str", "dex", "con", "int", "wis", "cha"]) params[`_save_${ab}`] = saves.has(ab);
  return params;
}

/** Add a caught Pokémon (from its Pokédex entry) to the trainer's team via add_pokemon, at the given
 *  wild level. */
export async function addPokemonToTeam(writeKey: string, e: AddPokemonSpecies, level: number): Promise<boolean> {
  await poke5eRpc("add_pokemon", buildAddPokemonParams(writeKey, e, level));
  return true;
}

/** The trainer's feats/abilities (name + description). */
export async function fetchTrainerFeats(readKey: string): Promise<{ name: string; description: string }[]> {
  const rows = await rpc("get_trainer_feats", { _read_key: readKey }).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((f: any) => ({ name: f.feat_name || "Feat", description: f.description || "" }));
}

// A poke5e specialization is stored on the trainer row as a per-type count (`special_<type>`),
// stackable. This maps the Pokémon type → the specialization's trainer-facing name + its personal
// benefit (the "+1 to that type's Pokémon skill checks" rider is implicit for every one).
const SPECIALIZATIONS: Record<string, { name: string; benefit: string }> = {
  normal: { name: "Poké Fan", benefit: "+1 CHA" },
  fighting: { name: "Black Belt", benefit: "Athletics proficiency (or expertise)" },
  flying: { name: "Bird Keeper", benefit: "Perception proficiency (or expertise)" },
  poison: { name: "Punk", benefit: "Sleight of Hand proficiency (or expertise)" },
  ground: { name: "Camper", benefit: "Survival proficiency (or expertise)" },
  rock: { name: "Hiker", benefit: "+1 CON" },
  bug: { name: "Bug Maniac", benefit: "Nature proficiency (or expertise)" },
  ghost: { name: "Mystic", benefit: "Religion proficiency (or expertise)" },
  steel: { name: "Worker", benefit: "+1 STR" },
  fire: { name: "Kindler", benefit: "Intimidation proficiency (or expertise)" },
  water: { name: "Swimmer", benefit: "+1 DEX" },
  grass: { name: "Gardener", benefit: "Medicine proficiency (or expertise)" },
  electric: { name: "Engineer", benefit: "+1 INT" },
  psychic: { name: "Psychic", benefit: "Arcana proficiency (or expertise)" },
  ice: { name: "Skier", benefit: "Acrobatics proficiency (or expertise)" },
  dragon: { name: "Dragon Tamer", benefit: "+1 WIS" },
  dark: { name: "Delinquent", benefit: "Stealth proficiency (or expertise)" },
  fairy: { name: "Actor", benefit: "Performance proficiency (or expertise)" },
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Read a trainer's PATH and SPECIALIZATION(S) off the raw get_trainer row, as name+description
 *  entries (same shape as feats) so the sheet can list them alongside feats. Path rank features
 *  (Mind/Body/Spirit …) appear only once poke5e fills them in as they unlock. */
export function trainerExtras(row: any): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  const pathName = (row.path_name || "").trim();
  if (pathName) {
    const ranks: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const rn = (row[`path_rank_${i}_name`] || "").trim();
      const rd = (row[`path_rank_${i}_desc`] || "").trim();
      if (rn || rd) ranks.push(rn && rd ? `${rn}: ${rd}` : rn || rd);
    }
    const resource = Number(row.path_resource) || 0;
    const desc = ranks.length
      ? ranks.join("  •  ")
      : "Rank features (Mind / Body / Spirit …) unlock as you level." + (resource ? ` Path resource: ${resource}.` : "");
    out.push({ name: `Path — ${pathName}`, description: desc });
  }
  for (const [type, spec] of Object.entries(SPECIALIZATIONS)) {
    const count = Number(row[`special_${type}`]) || 0;
    if (count > 0) {
      const stack = count > 1 ? ` ×${count}` : "";
      out.push({
        name: `Specialisation — ${spec.name}${stack}`,
        description: `${spec.benefit}. +${count} to all skill checks made by your ${cap(type)}-type Pokémon.`,
      });
    }
  }
  return out;
}

// Static poke5e items reference (id → name/type), cached — used to name inventory entries.
let itemsCache: Record<string, { name: string; type?: string; description?: string }> | null = null;
async function itemsMap(): Promise<Record<string, { name: string; type?: string; description?: string }>> {
  if (itemsCache) return itemsCache;
  try {
    const r = await fetch("https://poke5e.app/items.json");
    const j: any = await r.json();
    const arr: any[] = j.items || j.values || [];
    const map: Record<string, { name: string; type?: string; description?: string }> = {};
    for (const it of arr) {
      if (!it.id) continue;
      const description = Array.isArray(it.description) ? it.description.join(" ") : it.description;
      map[it.id] = { name: it.name, type: it.type, description };
    }
    itemsCache = map;
  } catch {
    itemsCache = {};
  }
  return itemsCache;
}

const capType = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "Item");

/** The trainer's bag (get_inventory_items), normalized to the app's inventory-entry shape. */
export async function buildInventory(readKey: string): Promise<any[]> {
  const rows = await rpc("get_inventory_items", { _read_key: readKey }).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return [];
  const items = await itemsMap();
  return rows
    // Skip genuinely-blank rows (no reference item AND no custom name) — these are empty poke5e
    // entries that would otherwise show as a useless "(unnamed item)".
    .filter((r: any) => r.item_id || (r.custom_name && String(r.custom_name).trim()))
    .map((r: any) => {
      const ref = r.item_id ? items[r.item_id] : null;
      const name = (r.custom_name && String(r.custom_name).trim()) || ref?.name || "(unnamed item)";
      const quantity = Number(r.quantity) || 0;
      return {
        name,
        quantity,
        consumable: true, // bag items get quantity controls + Use (decrements locally; poke5e is read-only)
        kind: "item", // not heal/damage → not a dice roll
        itemType: ref?.type || "", // raw poke5e type (e.g. "pokeball") — lets the UI theme the "Use"
        typeName: capType(ref?.type),
        magic: false,
        attuned: false,
        note: r.description ? String(r.description) : (ref?.description || ""),
        entries: [{ id: r.id, quantity }],
        // write-back fields (update_inventory_item): the row id + whether it's a standard/custom item
        rowId: r.id,
        itemId: r.item_id || null,
        customName: r.custom_name || null,
      };
    });
}

const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const profFor = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

const SKILLS: { key: SkillKey; ability: Ability }[] = [
  { key: "acrobatics", ability: "DEX" },
  { key: "animal-handling", ability: "WIS" },
  { key: "arcana", ability: "INT" },
  { key: "athletics", ability: "STR" },
  { key: "deception", ability: "CHA" },
  { key: "history", ability: "INT" },
  { key: "insight", ability: "WIS" },
  { key: "intimidation", ability: "CHA" },
  { key: "investigation", ability: "INT" },
  { key: "medicine", ability: "WIS" },
  { key: "nature", ability: "INT" },
  { key: "perception", ability: "WIS" },
  { key: "performance", ability: "CHA" },
  { key: "persuasion", ability: "CHA" },
  { key: "religion", ability: "INT" },
  { key: "sleight-of-hand", ability: "DEX" },
  { key: "stealth", ability: "DEX" },
  { key: "survival", ability: "WIS" },
];

const ABILITY_COL: Record<Ability, string> = {
  STR: "strength", DEX: "dexterity", CON: "constitution", INT: "intelligence", WIS: "wisdom", CHA: "charisma",
};

/** Truthy-flag lookup tolerant of column-name spelling (prof_animal_handling vs prof_animalhandling). */
function flag(row: any, ...names: string[]): boolean {
  for (const n of names) if (row[n] != null) return !!row[n];
  return false;
}

/** Normalize a trainer row into a RollModel + HP for the sheet/roll pipeline. */
export function trainerToRollModel(row: any): { model: RollModel; hp: { current: number; max: number; temp: number; removed: number } } {
  const level = Number(row.level) || 1;
  const profBonus = profFor(level);

  const abilities = {} as RollModel["abilities"];
  for (const ab of Object.keys(ABILITY_COL) as Ability[]) {
    const score = Number(row[ABILITY_COL[ab]]) || 10;
    abilities[ab] = { score, mod: abilityMod(score) };
  }

  const saves = {} as Record<Ability, SaveValue>;
  for (const ab of Object.keys(ABILITY_COL) as Ability[]) {
    const proficient = flag(row, `save_${ab.toLowerCase()}`);
    saves[ab] = { mod: abilities[ab].mod + (proficient ? profBonus : 0), proficient };
  }

  const skills = {} as Record<SkillKey, SkillValue>;
  for (const s of SKILLS) {
    // poke5e stores a proficiency RANK (0 none / 1 proficient / 2 expertise) alongside the prof_* bool.
    // Prefer the rank so expertise (e.g. from a stacked/type specialization) doubles the bonus.
    const rank = Number(row[`rank_${s.key.replace(/-/g, "_")}`]) || 0;
    const proficient = rank >= 1 || flag(row, `prof_${s.key.replace(/-/g, "_")}`, `prof_${s.key.replace(/-/g, "")}`);
    const expertise = rank >= 2;
    const bonus = expertise ? profBonus * 2 : proficient ? profBonus : 0;
    skills[s.key] = { mod: abilities[s.ability].mod + bonus, ability: s.ability, proficient, expertise };
  }

  const passive = (k: SkillKey) => 10 + skills[k].mod;
  const maxHp = Number(row.hp_max) || 0;
  const curHp = row.hp_cur != null ? Number(row.hp_cur) : maxHp;

  const model: RollModel = {
    name: row.name || "Trainer",
    level,
    profBonus,
    abilities,
    saves,
    skills,
    passives: { perception: passive("perception"), investigation: passive("investigation"), insight: passive("insight") },
    initiative: abilities.DEX.mod,
    speed: Number(row.speed) || 30,
    conditional: [],
  };

  return { model, hp: { current: curHp, max: maxHp, temp: 0, removed: Math.max(0, maxHp - curHp) } };
}
