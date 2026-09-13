// Printable character-sheet PDF — pure data-shaping + HTML rendering (no DOM, no Electron).
//
// The renderer already computes everything a sheet needs; buildSheetDto() flattens that live state
// into a display-ready DTO, and renderSheetHtml() turns the DTO into one self-contained HTML page
// laid out in the classic D&D-Beyond / WotC style. The main process writes the HTML to a temp file
// and uses Electron's printToPDF() on it. Keeping both steps pure makes the whole export testable.

import type { RollModel, Ability, SkillKey } from "../engine/types.js";

const ABILITY_ORDER: Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

// Skill display label + governing ability, in the canonical sheet order.
const SKILLS: { key: SkillKey; label: string; ability: Ability }[] = [
  { key: "acrobatics", label: "Acrobatics", ability: "DEX" },
  { key: "animal-handling", label: "Animal Handling", ability: "WIS" },
  { key: "arcana", label: "Arcana", ability: "INT" },
  { key: "athletics", label: "Athletics", ability: "STR" },
  { key: "deception", label: "Deception", ability: "CHA" },
  { key: "history", label: "History", ability: "INT" },
  { key: "insight", label: "Insight", ability: "WIS" },
  { key: "intimidation", label: "Intimidation", ability: "CHA" },
  { key: "investigation", label: "Investigation", ability: "INT" },
  { key: "medicine", label: "Medicine", ability: "WIS" },
  { key: "nature", label: "Nature", ability: "INT" },
  { key: "perception", label: "Perception", ability: "WIS" },
  { key: "performance", label: "Performance", ability: "CHA" },
  { key: "persuasion", label: "Persuasion", ability: "CHA" },
  { key: "religion", label: "Religion", ability: "INT" },
  { key: "sleight-of-hand", label: "Sleight of Hand", ability: "DEX" },
  { key: "stealth", label: "Stealth", ability: "DEX" },
  { key: "survival", label: "Survival", ability: "WIS" },
];

/** Signed modifier, e.g. 3 → "+3", -1 → "−1" (real minus sign). */
export function sgn(n: number): string {
  const v = Math.trunc(Number(n) || 0);
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

/** Live data the renderer hands over — loosely typed since several fields come from `any` stores. */
export interface SheetInput {
  model: RollModel;
  subtitle: string; // class/level/source line, e.g. "Level 5 Wizard" or "poke5e Trainer · Level 5"
  ac: number | null;
  hp: { current: number; max: number; temp: number } | null;
  hitDice: string | null;
  weapons: any[];
  spellcasting: any | null;
  spellSlots: { level: number; total: number; used?: number }[];
  inventory: any[];
  feats: { name: string; description?: string }[];
  imageUrl?: string; // optional creature art (Pokémon); main embeds it as a data URI before printing
}

export interface SheetDto {
  image: string; // creature art URL / data URI, or "" for none
  name: string;
  subtitle: string;
  profBonus: string;
  ac: string;
  initiative: string;
  speed: string;
  hp: { current: string; max: string; temp: string };
  hitDice: string;
  abilities: { key: string; score: string; mod: string }[];
  saves: { key: string; mod: string; prof: boolean }[];
  skills: { label: string; ability: string; mod: string; prof: boolean; expertise: boolean }[];
  passives: { perception: string; investigation: string; insight: string };
  attacks: { name: string; hit: string; damage: string }[];
  spellMeta: string;
  spells: { level: string; name: string; detail: string }[];
  features: { name: string; text: string }[];
  equipment: { name: string; qty: string }[];
}

function attackFrom(w: any): { name: string; hit: string; damage: string } {
  const dmgDice = w.damageDice || "";
  const dmg = w.damageMod ? `${dmgDice}${w.damageMod >= 0 ? "+" : "−"}${Math.abs(w.damageMod)}` : dmgDice;
  const dtype = w.damageType ? ` ${w.damageType}` : "";
  const versatile = w.versatileDamage ? ` (2H ${w.versatileDamage})` : "";
  const hit = w.save ? `${w.save.ability} DC ${w.save.dc}` : sgn(Number(w.attackMod) || 0);
  return { name: String(w.name || "Attack"), hit, damage: `${dmg}${dtype}${versatile}`.trim() };
}

function spellDetail(sp: any): string {
  if (sp.casting === "attack") return `${sgn(Number(sp.attackBonus) || 0)} · ${[sp.damageDice, sp.damageType].filter(Boolean).join(" ")}`.trim();
  if (sp.casting === "save") return `${sp.saveAbility || ""} DC ${sp.saveDc ?? "—"}${sp.damageDice ? " · " + sp.damageDice : ""}`.trim();
  if (sp.healDice) return `heal ${sp.healDice}`;
  if (sp.autoHit && sp.damageDice) return `${sp.damageDice} ${sp.damageType || ""}`.trim();
  return "utility";
}

/** Flatten the renderer's live state into a display-ready sheet DTO. Pure. */
export function buildSheetDto(input: SheetInput): SheetDto {
  const m = input.model;
  const abilities = ABILITY_ORDER.map((k) => ({
    key: k,
    score: String(m.abilities?.[k]?.score ?? 10),
    mod: sgn(m.abilities?.[k]?.mod ?? 0),
  }));
  const saves = ABILITY_ORDER.map((k) => ({
    key: k,
    mod: sgn(m.saves?.[k]?.mod ?? 0),
    prof: !!m.saves?.[k]?.proficient,
  }));
  const skills = SKILLS.map((s) => {
    const sv = m.skills?.[s.key];
    return {
      label: s.label,
      ability: s.ability,
      mod: sgn(sv?.mod ?? 0),
      prof: !!sv?.proficient,
      expertise: !!sv?.expertise,
    };
  });
  const cls = input.spellcasting?.classes?.[0];
  const spellMeta = cls ? `Spell atk ${sgn(Number(cls.attackBonus) || 0)} · save DC ${cls.saveDc ?? "—"}` : "";
  const spells = (input.spellcasting?.spells ?? []).map((sp: any) => ({
    level: sp.isCantrip ? "Cantrip" : `Lv ${sp.level ?? "?"}`,
    name: String(sp.name || ""),
    detail: spellDetail(sp),
  }));

  return {
    image: input.imageUrl || "",
    name: String(m.name || "Character"),
    subtitle: input.subtitle || "",
    profBonus: sgn(m.profBonus ?? 0),
    ac: input.ac != null ? String(input.ac) : "—",
    initiative: sgn(m.initiative ?? 0),
    speed: m.speed ? `${m.speed} ft` : "—",
    hp: {
      current: input.hp ? String(input.hp.current) : "—",
      max: input.hp ? String(input.hp.max) : "—",
      temp: input.hp && input.hp.temp ? String(input.hp.temp) : "0",
    },
    hitDice: input.hitDice || "—",
    abilities,
    saves,
    skills,
    passives: {
      perception: String(m.passives?.perception ?? 10),
      investigation: String(m.passives?.investigation ?? 10),
      insight: String(m.passives?.insight ?? 10),
    },
    attacks: (input.weapons ?? []).map(attackFrom),
    spellMeta,
    spells,
    features: (input.feats ?? []).map((f) => ({ name: String(f.name || ""), text: String(f.description || "") })),
    equipment: (input.inventory ?? []).map((it: any) => ({
      name: String(it.name || ""),
      qty: it.quantity && Number(it.quantity) > 1 ? `×${it.quantity}` : "",
    })),
  };
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const STYLE = `
:root { --ink:#1b1b1b; --line:#8a8172; --muted:#5b5346; --box:#faf7f0; --shade:#efe9dc; }
* { box-sizing: border-box; }
@page { size: Letter; margin: 0.5in; }
body { margin:0; color:var(--ink); font:12px/1.35 "Helvetica Neue",Arial,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1 { font-size:26px; margin:0; letter-spacing:.5px; }
.sub { color:var(--muted); font-size:12px; margin:2px 0 10px; }
.box { border:1.5px solid var(--line); border-radius:8px; padding:8px 10px; background:var(--box); }
.box h2 { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); margin:0 0 6px; border-bottom:1px solid var(--line); padding-bottom:3px; }
.topline { display:grid; grid-template-columns:repeat(6,1fr); gap:8px; margin-bottom:10px; }
.stat { text-align:center; }
.stat .big { font-size:20px; font-weight:700; }
.stat .lbl { font-size:8.5px; text-transform:uppercase; color:var(--muted); letter-spacing:.5px; }
.cols { display:grid; grid-template-columns:200px 1fr; gap:10px; align-items:start; }
.abils { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:10px; }
.abil { text-align:center; border:1.5px solid var(--line); border-radius:8px; padding:5px 2px; background:var(--box); }
.abil .k { font-size:8.5px; text-transform:uppercase; color:var(--muted); }
.abil .mod { font-size:19px; font-weight:700; }
.abil .sc { font-size:10px; color:var(--muted); }
.list { display:flex; flex-direction:column; gap:2px; }
.row { display:flex; align-items:center; gap:6px; font-size:11px; padding:1px 0; }
.row .pip { width:9px; height:9px; border:1.5px solid var(--muted); border-radius:50%; flex:none; }
.row .pip.on { background:var(--ink); }
.row .m { width:26px; text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }
.row .n { flex:1; }
.row .ab { color:var(--muted); font-size:8.5px; width:22px; text-transform:uppercase; }
.right { display:flex; flex-direction:column; gap:10px; }
table { width:100%; border-collapse:collapse; font-size:11px; }
th { text-align:left; font-size:8.5px; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line); padding:2px 4px; }
td { padding:3px 4px; border-bottom:1px solid var(--shade); vertical-align:top; }
.feat { margin-bottom:5px; }
.feat .fn { font-weight:700; font-size:11px; }
.feat .ft { color:var(--muted); font-size:10px; white-space:pre-wrap; }
.equip { columns:2; font-size:11px; }
.equip div { break-inside:avoid; }
.box, .feat, tr { break-inside:avoid; }
.muted { color:var(--muted); }
.meta { font-size:10px; color:var(--muted); margin-top:2px; }
.photo { text-align:center; margin-bottom:10px; }
.photo img { max-width:100%; max-height:150px; object-fit:contain; }
.blankline { border-bottom:1px solid var(--muted); height:16px; }
.notes .lines { display:flex; flex-direction:column; gap:0; }
.notes .lines .blankline { height:20px; }
`;

/** Render a full, self-contained HTML page for the sheet DTO. Pure. */
export function renderSheetHtml(dto: SheetDto): string {
  const topStat = (lbl: string, val: string) => `<div class="stat box"><div class="big">${esc(val)}</div><div class="lbl">${esc(lbl)}</div></div>`;
  const abilBox = (a: { key: string; score: string; mod: string }) =>
    `<div class="abil"><div class="k">${esc(a.key)}</div><div class="mod">${esc(a.mod)}</div><div class="sc">${esc(a.score)}</div></div>`;
  const pipRow = (on: boolean, mod: string, name: string, ab = "") =>
    `<div class="row"><span class="pip ${on ? "on" : ""}"></span><span class="m">${esc(mod)}</span>${ab ? `<span class="ab">${esc(ab)}</span>` : ""}<span class="n">${esc(name)}</span></div>`;

  const saves = dto.saves.map((s) => pipRow(s.prof, s.mod, s.key)).join("");
  const skills = dto.skills.map((s) => pipRow(s.prof || s.expertise, s.mod, s.label + (s.expertise ? " (Ex)" : ""), s.ability)).join("");
  const attacks = dto.attacks.length
    ? `<table><thead><tr><th>Attack</th><th>Hit/DC</th><th>Damage</th></tr></thead><tbody>${dto.attacks
        .map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.hit)}</td><td>${esc(a.damage)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted">No attacks.</div>`;
  const spells = dto.spells.length
    ? `${dto.spellMeta ? `<div class="meta">${esc(dto.spellMeta)}</div>` : ""}<table><tbody>${dto.spells
        .map((s) => `<tr><td class="muted" style="width:52px">${esc(s.level)}</td><td>${esc(s.name)}</td><td class="muted">${esc(s.detail)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const features = dto.features.length
    ? dto.features.map((f) => `<div class="feat"><div class="fn">${esc(f.name)}</div>${f.text ? `<div class="ft">${esc(f.text)}</div>` : ""}</div>`).join("")
    : `<div class="muted">None listed.</div>`;
  // Listed items, then a few blank ruled rows to hand-write extras on the printed sheet.
  const blankRows = (n: number) => Array.from({ length: n }, () => `<div class="blankline"></div>`).join("");
  const equipment = `${dto.equipment.length ? `<div class="equip">${dto.equipment.map((e) => `<div>${esc(e.name)} ${esc(e.qty)}</div>`).join("")}</div>` : ""}${blankRows(5)}`;
  const photo = dto.image ? `<div class="box photo"><img src="${esc(dto.image)}" alt=""></div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(dto.name)} — Character Sheet</title><style>${STYLE}</style></head>
<body>
  <h1>${esc(dto.name)}</h1>
  <div class="sub">${esc(dto.subtitle)}</div>
  <div class="topline">
    ${topStat("Prof Bonus", dto.profBonus)}${topStat("Armor Class", dto.ac)}${topStat("Initiative", dto.initiative)}
    ${topStat("Speed", dto.speed)}${topStat("Hit Points", `${dto.hp.current}/${dto.hp.max}${dto.hp.temp !== "0" ? " (+" + dto.hp.temp + ")" : ""}`)}${topStat("Hit Dice", dto.hitDice)}
  </div>
  <div class="cols">
    <div>
      ${photo}
      <div class="abils">${dto.abilities.map(abilBox).join("")}</div>
      <div class="box"><h2>Saving Throws</h2><div class="list">${saves}</div></div>
      <div class="box" style="margin-top:10px"><h2>Skills</h2><div class="list">${skills}</div></div>
      <div class="box" style="margin-top:10px"><h2>Passive</h2>
        <div class="row"><span class="m">${esc(dto.passives.perception)}</span><span class="n">Perception</span></div>
        <div class="row"><span class="m">${esc(dto.passives.investigation)}</span><span class="n">Investigation</span></div>
        <div class="row"><span class="m">${esc(dto.passives.insight)}</span><span class="n">Insight</span></div>
      </div>
    </div>
    <div class="right">
      <div class="box"><h2>Attacks</h2>${attacks}</div>
      ${spells ? `<div class="box"><h2>Spells / Moves</h2>${spells}</div>` : ""}
      <div class="box"><h2>Features &amp; Traits</h2>${features}</div>
      <div class="box"><h2>Equipment</h2>${equipment}</div>
      <div class="box notes"><h2>Notes</h2><div class="lines">${blankRows(12)}</div></div>
    </div>
  </div>
</body></html>`;
}
