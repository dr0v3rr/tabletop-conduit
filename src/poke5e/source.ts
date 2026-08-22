// poke5e.app character source. Trainers are stored in the site's public Supabase project and
// read through SECURITY-DEFINER RPCs keyed by a 32-char "read key" — the same call the site
// itself makes. A shared character URL is poke5e.app/trainers?id=<readKey>, so the `id` query
// param IS the read key. No login is required to read.
//
// We normalize a Trainer into the engine's RollModel so the existing sheet/roll pipeline can
// drive it. (Pokémon team members & their moves are a later phase — this covers the trainer.)

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";

const SUPABASE_URL = "https://logncbjjfmnvbfrjdxmg.supabase.co";
// Public anon key (shipped in poke5e's own client bundle; safe to embed).
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvZ25jYmpqZm1udmJmcmpkeG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE2Njk1ODY2MzEsImV4cCI6MTk4NTE2MjYzMX0.RXw9pfN-4qOR2AbqPoM6GMzjDGRwYnClF9LEiI2VE5k";

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

export const POKE5E_URL = SUPABASE_URL;
export const POKE5E_ANON = ANON_KEY;

/** Call a poke5e Supabase RPC. Exported so the team/moves module can reuse it. */
export async function poke5eRpc(fn: string, body: unknown): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
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

/** The trainer's feats/abilities (name + description). */
export async function fetchTrainerFeats(readKey: string): Promise<{ name: string; description: string }[]> {
  const rows = await rpc("get_trainer_feats", { _read_key: readKey }).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((f: any) => ({ name: f.feat_name || "Feat", description: f.description || "" }));
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
    const proficient = flag(row, `prof_${s.key.replace(/-/g, "_")}`, `prof_${s.key.replace(/-/g, "")}`);
    skills[s.key] = { mod: abilities[s.ability].mod + (proficient ? profBonus : 0), ability: s.ability, proficient, expertise: false };
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
