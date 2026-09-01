// Pokédex data layer — normalizes poke5e's static species dataset (pokemon.json) + the moves
// reference (moves.json) into a compact view model for the in-app Pokédex tab. Pure + testable:
// the fetch/cache lives in the main process; this module only shapes raw rows.

import { moveWording } from "./pokemon.js";
import { parseSpeeds, formatSpeeds, type SpeedMode } from "./speed.js";

/** Moves that inflict the Asleep status — used to flag "has a sleep move" (the ranger's lens). */
const SLEEP_MOVES = new Set(["sing", "sleep-powder", "spore", "hypnosis", "yawn", "grass-whistle", "lovely-kiss"]);

const LEVEL_KEYS: { key: string; label: string }[] = [
  { key: "start", label: "Start" }, { key: "level2", label: "L2" }, { key: "level6", label: "L6" },
  { key: "level10", label: "L10" }, { key: "level14", label: "L14" }, { key: "level18", label: "L18" },
];

export interface DexMove {
  id: string;
  name: string;
  type: string;
  level: string; // display label: "Start" / "L6" …
  sleep: boolean;
  description: string; // flattened wording — for the row + 📖 Display in VTT
}

export interface DexEvoStep {
  name: string;
  cond?: string; // e.g. "Lv 6", "Lv 10 · Prism Scale" — absent for the base stage
  here?: boolean; // the species being viewed
}

export interface DexEntry {
  id: string;
  num: number;
  name: string;
  types: string[];
  size: string;
  sr: number;
  ac: number;
  hp: number;
  hitDice: string;
  speed: string; // formatted, e.g. "25 ft, climbing 25 ft"
  speedModes: SpeedMode[]; // structured modes (walking first when present) for sheets / the primary number
  stats: { STR: number; DEX: number; CON: number; INT: number; WIS: number; CHA: number };
  minLevel: number;
  saves: string[]; // ["DEX"], ["STR","CON"] …
  skills: string[]; // display names ("Animal Handling")
  skillIds: string[]; // raw ids ("animal-handling") — for add_pokemon rank_* params
  abilities: { id: string; name: string; hidden: boolean; description: string }[];
  evolution: DexEvoStep[];
  region: string;
  biomes: string[];
  sprite: string; // small pixel sprite URL
  art: string; // large artwork URL
  sleep: boolean; // has a sleep move in its level-up list
  fakemon: boolean; // community/custom species (served under /unofficial/) — hidden by default
  moves: DexMove[];
}

const up = (s: string) => (s ? s.toUpperCase() : s);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** One level-up condition/effect → a short display string. */
function evoCond(t: any, name: (id: string) => string): string {
  const parts: string[] = [];
  for (const c of t.conditions || []) {
    if (c.type === "level") parts.push(`Lv ${c.value}`);
    else if (c.type === "item") parts.push(String(c.value).split("-").map(cap).join(" "));
    else if (c.type === "friendship") parts.push("Friendship");
    else if (c.type === "gender") parts.push(cap(String(c.value)));
    else parts.push(`${c.type}: ${c.value}`);
  }
  return parts.join(" · ");
}

/** Build the visible evolution chain (prev → this → next) from a species' `evolution` block. */
function buildEvolution(p: any, byId: Record<string, any>): DexEvoStep[] {
  const nameOf = (id: string) => byId[id]?.name || id;
  const ev = p.evolution || {};
  const chain: DexEvoStep[] = [];
  // one previous stage, if any
  const from = Array.isArray(ev.from) ? ev.from : [];
  if (from.length) {
    const f = from[0];
    chain.push({ name: nameOf(typeof f === "string" ? f : f.id) });
  }
  chain.push({ name: p.name, here: true });
  for (const t of ev.to || []) {
    chain.push({ name: nameOf(t.id), cond: evoCond(t, nameOf) });
  }
  return chain;
}

const POKE5E_HOST = "https://poke5e.app";
/** poke5e serves sprites/art under /assets/pokemon/<id>/… — CSP `img-src https:` lets the sheet load
 *  them. Some entries (custom fakémon) have no media at all; callers get "" and render a placeholder. */
export function spriteUrl(id: string): string {
  return `${POKE5E_HOST}/assets/pokemon/${id}/sprite.png`;
}
export function artUrl(id: string): string {
  return `${POKE5E_HOST}/assets/pokemon/${id}/main.png`;
}
/** Absolute-ize a media path from the dataset; "" when the entry has no such asset. */
function mediaUrl(path: string | undefined | null): string {
  if (!path) return "";
  return /^https?:/.test(path) ? path : POKE5E_HOST + path;
}

/** Normalize one pokemon.json row into a DexEntry, resolving its level-up moves via the moves map. */
export function normalizeSpecies(p: any, movesById: Record<string, any>, byId: Record<string, any>): DexEntry {
  const a = p.attributes || {};
  const speedModes = parseSpeeds(p.speed);
  const speed = formatSpeeds(speedModes);

  const moves: DexMove[] = [];
  const mv = p.moves || {};
  for (const { key, label } of LEVEL_KEYS) {
    for (const mid of mv[key] || []) {
      const m = movesById[mid];
      if (!m) continue;
      moves.push({
        id: mid,
        name: m.name || mid,
        type: String(m.type || ""),
        level: label,
        sleep: SLEEP_MOVES.has(mid),
        description: moveWording(m.description),
      });
    }
  }

  return {
    id: p.id,
    num: Number(p.number) || 0,
    name: p.name || p.id,
    types: Array.isArray(p.type) ? p.type : [],
    size: cap(String(p.size || "")),
    sr: Number(p.sr) || 0,
    ac: Number(p.ac) || 0,
    hp: Number(p.hp) || 0,
    hitDice: String(p.hitDice || ""),
    speed,
    speedModes,
    stats: { STR: a.str ?? 10, DEX: a.dex ?? 10, CON: a.con ?? 10, INT: a.int ?? 10, WIS: a.wis ?? 10, CHA: a.cha ?? 10 },
    minLevel: Number(p.minLevel) || 1,
    saves: (p.savingThrows || []).map(up),
    skills: (p.skills || []).map((s: string) => s.split("-").map(cap).join(" ")),
    skillIds: (p.skills || []).map((s: string) => String(s)),
    abilities: (p.abilities || []).map((x: any) => ({ id: x.id || x.name, name: x.name || x.id, hidden: !!x.hidden, description: x.description || "" })),
    evolution: buildEvolution(p, byId),
    region: p.habitat?.nativeRegion || "",
    biomes: p.habitat?.biomes || [],
    // Prefer the dataset's own media paths; fall back to the id-based convention; "" if it has none.
    sprite: mediaUrl(p.media?.sprite) || (p.media ? "" : spriteUrl(p.id)),
    art: mediaUrl(p.media?.main) || (p.media ? "" : artUrl(p.id)),
    sleep: LEVEL_KEYS.some(({ key }) => (mv[key] || []).some((id: string) => SLEEP_MOVES.has(id))),
    // Community/custom species are served from /unofficial/ (official assets live under /assets/).
    fakemon: /\/unofficial\//.test(String(p.media?.main || p.media?.sprite || "")),
    moves,
  };
}

/** Normalize the whole dataset. `species` = pokemon.json items; `moves` = moves.json moves. */
export function buildPokedex(species: any[], moves: any[]): DexEntry[] {
  const byId: Record<string, any> = {};
  for (const p of species) byId[p.id] = p;
  const movesById: Record<string, any> = {};
  for (const m of moves) movesById[m.id] = m;
  return species.map((p) => normalizeSpecies(p, movesById, byId)).sort((a, b) => a.num - b.num);
}
