// D&D Beyond monster source (monster-service). Uses the SAME cobalt→JWT bearer we mint for
// character-service; with a token you get monsters your account OWNS plus the basic/SRD set,
// unauthenticated you still get SRD. Attacks aren't structured — they live in the
// `actionsDescription` HTML, which we regex-parse (à la ddb-importer) into rollable to-hit +
// damage. Called from the MAIN process (no CORS there), like our character calls.

import type { Ability, RollModel, SkillKey, SaveValue, SkillValue } from "../engine/types";
import type { MonsterHit, MonsterWeapon } from "./source";

const BASE = "https://monster-service.dndbeyond.com/v1/Monster";

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// DDB challengeRatingId → CR value (ids 1..4 are the fractional CRs; 5 == CR 1, 6 == CR 2, …).
function crFromRatingId(id: number): number {
  if (id === 1) return 0;
  if (id === 2) return 0.125;
  if (id === 3) return 0.25;
  if (id === 4) return 0.5;
  return Math.max(1, id - 4);
}
function crLabel(cr: number): string {
  return cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr);
}
function profFromCr(cr: number): number {
  return cr < 5 ? 2 : cr < 9 ? 3 : cr < 13 ? 4 : cr < 17 ? 5 : cr < 21 ? 6 : cr < 25 ? 7 : cr < 29 ? 8 : 9;
}

/** Search DDB monsters by name (name-ranked). Token optional (SRD without, owned content with). */
export async function searchDdbMonsters(token: string | null, query: string): Promise<MonsterHit[]> {
  const q = (query || "").trim();
  if (!q) return [];
  const res = await fetch(`${BASE}?search=${encodeURIComponent(q)}&skip=0&take=25&showHomebrew=f`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`DDB monster HTTP ${res.status}`);
  const j: any = await res.json();
  const ql = q.toLowerCase();
  const rank = (n: string) => { const s = (n || "").toLowerCase(); return s === ql ? 0 : s.startsWith(ql) ? 1 : s.includes(ql) ? 2 : 3; };
  return ((j.data ?? []) as any[])
    .filter((m) => m.isReleased !== false)
    .map((m) => ({ slug: String(m.id), name: m.name, cr: crLabel(crFromRatingId(m.challengeRatingId)), type: "", _r: rank(m.name) }))
    .sort((a, b) => a._r - b._r)
    .slice(0, 15)
    .map(({ _r, ...h }) => h);
}

/** Fetch one DDB monster by id. */
export async function fetchDdbMonster(token: string | null, id: string): Promise<any | null> {
  const res = await fetch(`${BASE}?ids=${encodeURIComponent(id)}`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const j: any = await res.json();
  return (j.data ?? [])[0] ?? null;
}

const STAT_ABILITY: Record<number, Ability> = { 1: "STR", 2: "DEX", 3: "CON", 4: "INT", 5: "WIS", 6: "CHA" };
const abilityMod = (score: number) => Math.floor((score - 10) / 2);
const SKILL_ABILITY: Record<SkillKey, Ability> = {
  acrobatics: "DEX", "animal-handling": "WIS", arcana: "INT", athletics: "STR", deception: "CHA", history: "INT",
  insight: "WIS", intimidation: "CHA", investigation: "INT", medicine: "WIS", nature: "INT", perception: "WIS",
  performance: "CHA", persuasion: "CHA", religion: "INT", "sleight-of-hand": "DEX", stealth: "DEX", survival: "WIS",
};

const SAVE_ABIL: Record<string, Ability> = { strength: "STR", dexterity: "DEX", constitution: "CON", intelligence: "INT", wisdom: "WIS", charisma: "CHA" };
// Within ONE action's description: an attack ("+N to hit … Hit: X (dice) type damage", parens
// optional) or a save-based action ("DC N <Ability> saving throw … X (dice) type damage").
const HIT_RX = /Attack:\s*([+-]\d+)\s+to hit.*?Hit:.*?(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\)?\s*([a-z]+)\s+damage/i;
const SV_RX = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw.*?(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\)?\s*([a-z]+)\s+damage/i;

function toDiceMod(diceExpr: string | undefined): { dice?: string; mod: number } {
  const dm = /(\d+d\d+)(?:\s*([+-])\s*(\d+))?/.exec(diceExpr || "");
  return { dice: dm?.[1], mod: dm && dm[2] ? (dm[2] === "-" ? -Number(dm[3]) : Number(dm[3])) : 0 };
}

// DDB bolds each action name in <strong>…</strong>, so split into per-action blocks by that marker —
// the action NAME comes from the bold tag and each attack/save regex runs only within its own block
// (no cross-action bleed, no mistaking a mid-sentence phrase for a name).
function parseAttacks(html: string): MonsterWeapon[] {
  const out: MonsterWeapon[] = [];
  const names = new Set<string>();
  for (const blk of String(html || "").split(/<strong>/i).slice(1)) {
    if (out.length > 16) break;
    const nm = /^([^<]*?)\s*<\/strong>/i.exec(blk);
    if (!nm) continue;
    const name = (nm[1] ?? "").replace(/\.\s*$/, "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
    const key = name.toLowerCase();
    if (!name || names.has(key)) continue;
    const desc = blk.slice(nm[0].length).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
    const am = HIT_RX.exec(desc);
    if (am) {
      const { dice, mod } = toDiceMod(am[2]);
      if (dice) { out.push({ name, attackMod: Number(am[1]) || 0, damageDice: dice, damageMod: mod, damageType: am[3]?.toLowerCase(), proficient: true }); names.add(key); }
      continue;
    }
    const sm = SV_RX.exec(desc);
    if (sm) {
      const { dice, mod } = toDiceMod(sm[3]);
      const ability = SAVE_ABIL[String(sm[2]).toLowerCase()];
      if (dice && ability) { out.push({ name, attackMod: 0, damageDice: dice, damageMod: mod, damageType: sm[4]?.toLowerCase(), proficient: false, save: { dc: Number(sm[1]), ability } }); names.add(key); }
    }
  }
  return out;
}

/** Normalize a DDB monster into a RollModel + HP + attacks (+ AC). */
export function ddbMonsterToCharacter(m: any): {
  model: RollModel;
  hp: { current: number; max: number; temp: number; removed: number };
  weapons: MonsterWeapon[];
  ac?: number;
} {
  const cr = crFromRatingId(m.challengeRatingId);
  const prof = profFromCr(cr);

  const abilities = {} as RollModel["abilities"];
  for (const s of (m.stats ?? []) as any[]) {
    const ab = STAT_ABILITY[s.statId];
    if (ab) abilities[ab] = { score: Number(s.value) || 10, mod: abilityMod(Number(s.value) || 10) };
  }
  for (const ab of Object.values(STAT_ABILITY)) if (!abilities[ab]) abilities[ab] = { score: 10, mod: 0 };

  const saves = {} as Record<Ability, SaveValue>;
  const savingSet = new Map<Ability, number>();
  for (const sv of (m.savingThrows ?? []) as any[]) {
    const ab = STAT_ABILITY[sv.statId];
    if (ab) savingSet.set(ab, Number(sv.bonusModifier) || 0);
  }
  for (const ab of Object.values(STAT_ABILITY)) {
    if (savingSet.has(ab)) saves[ab] = { mod: abilities[ab].mod + prof + savingSet.get(ab)!, proficient: true };
    else saves[ab] = { mod: abilities[ab].mod, proficient: false };
  }

  // Skills come rendered in skillsHtml, e.g. "History + 12, Perception + 10".
  const skillTotals: Record<string, number> = {};
  for (const part of String(m.skillsHtml || "").replace(/<[^>]+>/g, " ").split(",")) {
    const sm = /([A-Za-z ]+?)\s*([+-]\s*\d+)/.exec(part.trim());
    if (sm && sm[1] && sm[2]) skillTotals[sm[1].trim().toLowerCase().replace(/\s+/g, "-")] = Number(sm[2].replace(/\s+/g, ""));
  }
  const skills = {} as Record<SkillKey, SkillValue>;
  for (const key of Object.keys(SKILL_ABILITY) as SkillKey[]) {
    const ability = SKILL_ABILITY[key];
    const total = skillTotals[key];
    if (total != null) skills[key] = { mod: total, ability, proficient: true, expertise: false };
    else skills[key] = { mod: abilities[ability].mod, ability, proficient: false, expertise: false };
  }

  const passive = (k: SkillKey) => 10 + skills[k].mod;
  const maxHp = Number(m.averageHitPoints) || 0;
  const model: RollModel = {
    name: m.name || "Monster",
    level: 1,
    profBonus: prof,
    abilities,
    saves,
    skills,
    passives: { perception: passive("perception"), investigation: passive("investigation"), insight: passive("insight") },
    initiative: abilities.DEX.mod,
    speed: 30,
    conditional: [],
  };

  const weapons = [
    ...parseAttacks(m.actionsDescription),
    ...parseAttacks(m.legendaryActionsDescription),
    ...parseAttacks(m.bonusActionsDescription),
  ];

  return { model, hp: { current: maxHp, max: maxHp, temp: 0, removed: 0 }, weapons, ac: typeof m.armorClass === "number" ? m.armorClass : undefined };
}
