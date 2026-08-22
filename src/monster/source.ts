// Monster / NPC source, backed by the free Open5e API (https://api.open5e.com) — SRD +
// community stat blocks, no auth, CORS-open. A GM searches a creature, loads it read-only,
// rolls its actions/saves into the VTT and tracks its HP locally. We normalize a stat block
// into the engine's RollModel plus a list of weapon-shaped "actions" for the Attacks section.

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";

const API = "https://api.open5e.com/v1";

export interface MonsterHit {
  slug: string;
  name: string;
  cr: string;
  type: string;
}

const abilityMod = (score: number) => Math.floor((score - 10) / 2);

/** Search monsters by name. Returns lightweight hits for a picker. */
export async function searchMonsters(query: string): Promise<MonsterHit[]> {
  const q = (query || "").trim();
  if (!q) return [];
  // Open5e's `search` is a broad full-text match (it'll rank a creature whose *description*
  // mentions "goblin" above the actual Goblin), so we pull a wider set and re-rank by NAME.
  const res = await fetch(`${API}/monsters/?search=${encodeURIComponent(q)}&limit=40`);
  if (!res.ok) throw new Error(`Open5e HTTP ${res.status}`);
  const j: any = await res.json();
  const ql = q.toLowerCase();
  const rank = (name: string) => {
    const n = name.toLowerCase();
    return n === ql ? 0 : n.startsWith(ql) ? 1 : n.includes(ql) ? 2 : 3; // exact > prefix > substring > body-only
  };
  return ((j.results ?? []) as any[])
    .map((m) => ({
      slug: m.slug,
      name: m.name,
      cr: String(m.challenge_rating ?? m.cr ?? "?"),
      type: [m.size, m.type].filter(Boolean).join(" "),
      _r: rank(m.name),
    }))
    .sort((a, b) => a._r - b._r)
    .slice(0, 12)
    .map(({ _r, ...h }) => h);
}

/** Fetch one monster's full stat block. */
export async function fetchMonster(slug: string): Promise<any | null> {
  const res = await fetch(`${API}/monsters/${encodeURIComponent(slug)}/`);
  if (!res.ok) return null;
  return res.json();
}

const ABILITY_COL: Record<Ability, string> = {
  STR: "strength", DEX: "dexterity", CON: "constitution", INT: "intelligence", WIS: "wisdom", CHA: "charisma",
};
const SAVE_COL: Record<Ability, string> = {
  STR: "strength_save", DEX: "dexterity_save", CON: "constitution_save", INT: "intelligence_save", WIS: "wisdom_save", CHA: "charisma_save",
};
const SKILLS: { key: SkillKey; ability: Ability; open5e: string }[] = [
  { key: "acrobatics", ability: "DEX", open5e: "acrobatics" },
  { key: "animal-handling", ability: "WIS", open5e: "animal_handling" },
  { key: "arcana", ability: "INT", open5e: "arcana" },
  { key: "athletics", ability: "STR", open5e: "athletics" },
  { key: "deception", ability: "CHA", open5e: "deception" },
  { key: "history", ability: "INT", open5e: "history" },
  { key: "insight", ability: "WIS", open5e: "insight" },
  { key: "intimidation", ability: "CHA", open5e: "intimidation" },
  { key: "investigation", ability: "INT", open5e: "investigation" },
  { key: "medicine", ability: "WIS", open5e: "medicine" },
  { key: "nature", ability: "INT", open5e: "nature" },
  { key: "perception", ability: "WIS", open5e: "perception" },
  { key: "performance", ability: "CHA", open5e: "performance" },
  { key: "persuasion", ability: "CHA", open5e: "persuasion" },
  { key: "religion", ability: "INT", open5e: "religion" },
  { key: "sleight-of-hand", ability: "DEX", open5e: "sleight_of_hand" },
  { key: "stealth", ability: "DEX", open5e: "stealth" },
  { key: "survival", ability: "WIS", open5e: "survival" },
];

const DAMAGE_TYPE_RX = /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i;

export interface MonsterWeapon {
  name: string;
  attackMod: number;
  damageDice: string;
  damageMod: number;
  damageType?: string;
  proficient: boolean;
  save?: { dc: number; ability: Ability }; // save-based action (breath weapon, etc.) — no to-hit
}

/** Normalize an Open5e monster into a RollModel + HP + attack list. */
export function monsterToCharacter(m: any): {
  model: RollModel;
  hp: { current: number; max: number; temp: number; removed: number };
  weapons: MonsterWeapon[];
} {
  const abilities = {} as RollModel["abilities"];
  for (const ab of Object.keys(ABILITY_COL) as Ability[]) {
    const score = Number(m[ABILITY_COL[ab]]) || 10;
    abilities[ab] = { score, mod: abilityMod(score) };
  }

  const saves = {} as Record<Ability, SaveValue>;
  for (const ab of Object.keys(SAVE_COL) as Ability[]) {
    const listed = m[SAVE_COL[ab]];
    if (listed != null) saves[ab] = { mod: Number(listed), proficient: true };
    else saves[ab] = { mod: abilities[ab].mod, proficient: false };
  }

  const skillMods: Record<string, number> = m.skills && typeof m.skills === "object" ? m.skills : {};
  const skills = {} as Record<SkillKey, SkillValue>;
  for (const s of SKILLS) {
    const listed = skillMods[s.open5e];
    if (listed != null) skills[s.key] = { mod: Number(listed), ability: s.ability, proficient: true, expertise: false };
    else skills[s.key] = { mod: abilities[s.ability].mod, ability: s.ability, proficient: false, expertise: false };
  }

  const passive = (k: SkillKey) => 10 + skills[k].mod;
  const maxHp = Number(m.hit_points) || 0;
  const speed = m.speed && typeof m.speed === "object" ? Number(m.speed.walk) || 30 : Number(m.speed) || 30;
  // Level isn't meaningful for monsters; use CR-ish for display, default 1 for prof math (unused here).
  const model: RollModel = {
    name: m.name || "Monster",
    level: 1,
    profBonus: 2,
    abilities,
    saves,
    skills,
    passives: { perception: passive("perception"), investigation: passive("investigation"), insight: passive("insight") },
    initiative: abilities.DEX.mod,
    speed,
    conditional: [],
  };

  // Actions with an attack roll + damage become rollable "weapons".
  const weapons: MonsterWeapon[] = [];
  for (const a of (m.actions ?? []) as any[]) {
    if (a.attack_bonus == null || !a.damage_dice) continue;
    const dtype = DAMAGE_TYPE_RX.exec(a.desc || "")?.[1]?.toLowerCase();
    weapons.push({
      name: a.name,
      attackMod: Number(a.attack_bonus) || 0,
      damageDice: String(a.damage_dice),
      damageMod: Number(a.damage_bonus) || 0,
      damageType: dtype,
      proficient: true,
    });
  }

  return { model, hp: { current: maxHp, max: maxHp, temp: 0, removed: 0 }, weapons };
}
