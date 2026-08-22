// poke5e Pokémon ability rules-engine. Analogous to the D&D Beyond rules registry, but for
// Pokémon abilities: it maps an ability id to a mechanical effect, guarded by a condition the app
// can evaluate from the Pokémon's own live state (HP %, type, status, level).
//
// Two exported surfaces, because abilities act in two different places:
//   • moveAbilityMods()      — effects on a SPECIFIC move roll we launch (to-hit, damage, DC,
//                              advantage/disadvantage, or a per-move reminder like reroll / crit).
//   • passiveAbilityEffects()— Pokémon-WIDE passives that don't change a roll we make (resist /
//                              immunity to damage taken, AC, initiative, saves, HP-triggered forms,
//                              status handling). These are surfaced as reminders, lit when active.
//
// This covers every "actionable" ability from the 330-ability classification in
// docs/POKE5E_ABILITY_MECHANICS.md (37 auto + 44 state-knowable = 81). Effects that need the
// opponent, weather, or a prior roll are modelled as reminders, never faked into a number.

/** A live condition, evaluated by the renderer against the Pokémon's current state.
 *  hpPctMax = HP% ≤ N ("N% or less"); hpPctBelow = HP% < N (prose "below N%"); status matches the
 *  Pokémon's status by case-insensitive stem (e.g. "burn" matches "burned"/"burning"). */
export type AbilityCond = "always" | { hpPctMax: number } | { hpPctBelow: number } | { hpFull: true } | { status: string };

/** An effect an ability applies to a move roll, once its condition holds. */
export interface AbilityMod {
  ability: string; // display name
  cond: AbilityCond;
  damageAdd?: number; // flat damage added (only ever applied to a move that already deals damage)
  attackAdd?: number; // flat to-hit added
  saveDcAdd?: number; // flat save-DC added
  attackAdvantage?: boolean; // advantage on the attack roll
  attackDisadvantage?: boolean; // disadvantage on the attack roll
  note?: string; // a reminder for effects we don't auto-apply (roll twice, crit range, …)
}

/** A Pokémon-wide passive (not tied to launching a specific move). */
export interface PassiveEffect {
  ability: string; // display name
  cond: AbilityCond; // when it's currently "on" (for lighting the reminder)
  effect: string; // human-readable description
}

const NAMES: Record<string, string> = {
  // STAB doublers
  blaze: "Blaze", overgrow: "Overgrow", torrent: "Torrent", swarm: "Swarm",
  // move-roll abilities
  adaptability: "Adaptability", "dragons-maw": "Dragon's Maw", transistor: "Transistor",
  "rocky-payload": "Rocky Payload", "iron-fist": "Iron Fist", "strong-jaw": "Strong Jaw",
  technician: "Technician", steelworker: "Steelworker", "mega-launcher": "Mega Launcher",
  "compound-eyes": "Compound Eyes", "victory-star": "Victory Star", "gale-wings": "Gale Wings",
  defiant: "Defiant", "serene-grace": "Serene Grace", "super-luck": "Super Luck",
  "huge-power": "Huge Power", "pure-power": "Pure Power", guts: "Guts",
  "flare-boost": "Flare Boost", competitive: "Competitive", "no-guard": "No Guard",
  "intrepid-sword": "Intrepid Sword", berserk: "Berserk", defeatist: "Defeatist",
  sharpness: "Sharpness", "sheer-force": "Sheer Force", "skill-link": "Skill Link",
  "tough-claws": "Tough Claws", reckless: "Reckless", libero: "Libero",
  "dark-aura": "Dark Aura", "fairy-aura": "Fairy Aura", "punk-rock": "Punk Rock",
  // passives
  "battle-armor": "Battle Armor", "shell-armor": "Shell Armor", "big-pecks": "Big Pecks",
  "clear-body": "Clear Body", "dauntless-shield": "Dauntless Shield", "guard-dog": "Guard Dog",
  heatproof: "Heatproof", "ice-scales": "Ice Scales", "keen-eye": "Keen Eye",
  levitate: "Levitate", "minds-eye": "Mind's Eye", overcoat: "Overcoat",
  "purifying-salt": "Purifying Salt", "quick-draw": "Quick Draw", "rock-head": "Rock Head",
  soundproof: "Soundproof", stall: "Stall", telepathy: "Telepathy", "thick-fat": "Thick Fat",
  "vital-spirit": "Vital Spirit", "volt-absorb": "Volt Absorb", "water-absorb": "Water Absorb",
  "water-bubble": "Water Bubble", "water-veil": "Water Veil", "wonder-guard": "Wonder Guard",
  "wonder-skin": "Wonder Skin", "anger-shell": "Anger Shell", "marvel-scale": "Marvel Scale",
  multiscale: "Multiscale", "shadow-shield": "Shadow Shield", "tera-shell": "Tera Shell",
  schooling: "Schooling", "shields-down": "Shields Down", "zen-mode": "Zen Mode",
  "zen-mode-galarian": "Zen Mode (Galarian)", disguise: "Disguise", "early-bird": "Early Bird",
  "shed-skin": "Shed Skin", "poison-heal": "Poison Heal", "quick-feet": "Quick Feet",
  "tangled-feet": "Tangled Feet",
  "embody-aspect-cornerstone": "Embody Aspect (Cornerstone)",
  "embody-aspect-heartflame": "Embody Aspect (Heartflame)",
  "embody-aspect-teal": "Embody Aspect (Teal)",
  "embody-aspect-wellspring": "Embody Aspect (Wellspring)",
};
const nameOf = (id: string) => NAMES[id] || id;

const RR = "roll the damage dice twice, keep either total"; // reroll-damage reminder text

// Name-based move families (poke5e doesn't tag these, so we match on the move's name).
const PUNCH = /punch|uppercut/i; // Iron Fist
const BITE = /bite|crunch|fang/i; // Strong Jaw
const SLASH = /\bcut\b|blade|slash|\bedge\b|cleave|razor|sword|\baxe\b/i; // Sharpness — exact prose keywords
const MULTIHIT = /bullet seed|rock blast|pin missile|icicle spear|bone rush|tail slap|arm thrust|double slap|fury swipes|spike cannon|comet punch|barrage|fury attack|water shuriken|scale shot|triple axel|triple kick|population bomb|double kick|double hit|dual chop|dual wingbeat|twineedle|gear grind|bonemerang|surging strikes/i; // Skill Link
const PULSE = /pulse|aura sphere/i; // Mega Launcher
const SOUND = /hyper voice|snarl|bug buzz|boomburst|\bround\b|echoed voice|uproar|screech|growl|roar|sing|supersonic|metal sound|noble roar|disarming voice|clanging scales|overdrive|torch song|alluring voice|psychic noise|relic song|sparkling aria|clangorous/i; // Punk Rock

/** The ability ids on a Pokémon row (stored as [{referenceId}] or plain strings). */
export function abilityIds(pk: any): string[] {
  const list: any[] = Array.isArray(pk.abilities) ? pk.abilities : [];
  return list.map((a) => (typeof a === "string" ? a : a.referenceId || a.id)).filter(Boolean);
}

/** Compute the ability modifiers that apply to a given move for a Pokémon. `stab` is the move's
 *  STAB value, `pb` the proficiency bonus, `types` the Pokémon's own types. */
export function moveAbilityMods(
  ids: string[],
  move: { casting: "attack" | "save" | "utility"; type: string; hasDamage?: boolean; name?: string; ppMax?: number },
  ctx: { types: string[]; stab: number; pb: number },
): AbilityMod[] {
  const type = String(move.type || "").toLowerCase();
  const name = String(move.name || "");
  const isStab = ctx.types.includes(type);
  const dmg = move.hasDamage !== false; // flat-damage / reroll effects only matter on damaging moves
  const atk = move.casting === "attack";
  const sav = move.casting === "save";
  const ppMax = move.ppMax ?? 0;
  const out: AbilityMod[] = [];
  const push = (id: string, cond: AbilityCond, extra: Partial<AbilityMod>) => out.push({ ability: nameOf(id), cond, ...extra });
  const reroll = (id: string, cond: AbilityCond) => { if (dmg) push(id, cond, { note: RR }); };

  for (const id of ids) {
    switch (id) {
      // ── flat to-hit ──────────────────────────────────────────────────────────────
      case "compound-eyes": if (atk) push(id, "always", { attackAdd: 1 }); break;
      case "victory-star": if (atk) push(id, "always", { attackAdd: 1 }); break;
      case "gale-wings": if (atk && type === "flying") push(id, "always", { attackAdd: 1 }); break;
      case "defiant": if (atk) push(id, { status: "any" }, { attackAdd: 2 }); break;

      // ── save DC ──────────────────────────────────────────────────────────────────
      case "serene-grace": if (sav) push(id, "always", { saveDcAdd: 1 }); break;

      // ── flat damage ──────────────────────────────────────────────────────────────
      case "steelworker": if (dmg && type === "steel") push(id, "always", { damageAdd: ctx.pb }); break;
      case "mega-launcher": if (dmg && PULSE.test(name)) push(id, "always", { damageAdd: ctx.pb }); break;
      case "flare-boost": if (dmg) push(id, { status: "burn" }, { damageAdd: ctx.pb }); break;
      case "competitive": if (dmg) push(id, { status: "any" }, { damageAdd: ctx.pb }); break;
      case "blaze": case "overgrow": case "torrent": case "swarm":
        if (dmg && isStab && ctx.stab > 0) push(id, { hpPctMax: 25 }, { damageAdd: ctx.stab });
        break;

      // ── advantage / disadvantage on OUR attack ───────────────────────────────────
      case "no-guard": if (atk) push(id, "always", { attackAdvantage: true }); break;
      case "intrepid-sword": if (atk) push(id, "always", { note: "advantage on melee attack rolls" }); break;
      case "defeatist": if (atk) push(id, { hpPctBelow: 25 }, { attackDisadvantage: true }); break;
      case "berserk":
        if (atk) push(id, { hpPctBelow: 25 }, { attackDisadvantage: true, note: "deal double damage" });
        else if (dmg) push(id, { hpPctBelow: 25 }, { note: "deal double damage; targets have advantage on the save" });
        break;

      // ── crit range ───────────────────────────────────────────────────────────────
      case "super-luck": if (atk) push(id, "always", { note: "crits on 19–20" }); break;

      // ── reroll damage (keep either) ──────────────────────────────────────────────
      case "adaptability": if (isStab) reroll(id, "always"); break;
      case "dragons-maw": if (type === "dragon") reroll(id, "always"); break;
      case "transistor": if (type === "electric") reroll(id, "always"); break;
      case "rocky-payload": if (type === "rock") reroll(id, "always"); break;
      case "iron-fist": if (PUNCH.test(name)) reroll(id, "always"); break;
      case "strong-jaw": if (BITE.test(name)) reroll(id, "always"); break;
      case "technician": if (ppMax >= 15) reroll(id, "always"); break;

      // ── double the move's damage modifier ────────────────────────────────────────
      case "sharpness": if (dmg && SLASH.test(name)) push(id, "always", { note: "double this move's damage modifier" }); break;
      case "sheer-force": if (dmg && atk) push(id, "always", { note: "if it has a secondary effect: double the damage modifier (the effect is lost)" }); break;

      // ── double damage dice (opt-in, 1/rest) ──────────────────────────────────────
      case "huge-power": case "pure-power": if (atk) push(id, "always", { note: "may double the damage dice (1/short rest)" }); break;

      // ── STAB tweaks & type-boost reminders ───────────────────────────────────────
      case "libero": if (dmg && !isStab) push(id, "always", { note: "this move gains STAB (your type matches it)" }); break;
      case "reckless": if (dmg && isStab) push(id, "always", { note: "if this is a recoil move: double the STAB bonus" }); break;
      case "tough-claws": if (atk) push(id, "always", { note: "melee moves gain STAB (doubled if already STAB)" }); break;
      case "skill-link": if (MULTIHIT.test(name)) push(id, "always", { note: "multi-hit: at least 2 hits land" }); break;
      case "dark-aura": if (dmg && type === "dark") push(id, "always", { note: "dark moves deal double damage" }); break;
      case "fairy-aura": if (dmg && type === "fairy") push(id, "always", { note: "fairy moves deal double damage" }); break;
      case "punk-rock": if (dmg && SOUND.test(name)) push(id, "always", { note: "sound moves add STAB to damage" }); break;

      // ── status handling on OUR rolls ─────────────────────────────────────────────
      case "guts": push(id, { status: "any" }, { note: "ignore the attack & damage penalty from burn/poison" }); break;
    }
  }
  return out;
}

// Pokémon-wide passives. cond is only used to LIGHT the reminder when it's currently active; the
// effect text is always shown. hp-triggered forms use hpPctMax / hpFull; status ones use status.
const PASSIVES: Record<string, { cond: AbilityCond; effect: string }> = {
  // damage resistance / immunity (to damage TAKEN)
  heatproof: { cond: "always", effect: "resist Fire damage; immune to burn" },
  "thick-fat": { cond: "always", effect: "resist Fire and Ice damage" },
  "ice-scales": { cond: "always", effect: "resist damage from special (INT/WIS/CHA) moves" },
  levitate: { cond: "always", effect: "immune to Ground-type moves" },
  overcoat: { cond: "always", effect: "immune to weather damage" },
  "purifying-salt": { cond: "always", effect: "resist Ghost damage; immune to non-volatile status" },
  soundproof: { cond: "always", effect: "immune to sound-based moves" },
  telepathy: { cond: "always", effect: "immune to allies' attack damage" },
  "volt-absorb": { cond: "always", effect: "immune to Electric damage; heal half of it instead" },
  "water-absorb": { cond: "always", effect: "immune to Water damage; heal half of it instead" },
  "water-bubble": { cond: "always", effect: "resist Fire damage; immune to burn" },
  "water-veil": { cond: "always", effect: "immune to burn" },
  "wonder-guard": { cond: "always", effect: "immune to damaging moves it doesn't take extra damage from" },
  "punk-rock": { cond: "always", effect: "resist sound-based moves" },
  // crit / recoil defense
  "battle-armor": { cond: "always", effect: "critical hits deal no extra dice against it" },
  "shell-armor": { cond: "always", effect: "immune to extra critical-hit damage" },
  "rock-head": { cond: "always", effect: "takes no recoil damage" },
  // stat / AC protection
  "big-pecks": { cond: "always", effect: "AC can't be lowered by foes" },
  "clear-body": { cond: "always", effect: "foes can't lower its stats" },
  "dauntless-shield": { cond: "always", effect: "melee attacks against it have disadvantage" },
  "no-guard": { cond: "always", effect: "attacks against it also have advantage (the downside of No Guard)" },
  "guard-dog": { cond: "always", effect: "immune to Intimidate; can't be forced to switch" },
  // to-hit / perception passives
  "keen-eye": { cond: "always", effect: "ignore disadvantage related to sight" },
  "minds-eye": { cond: "always", effect: "ignore Normal/Fighting immunity; ignore disadvantage vs seen targets" },
  // initiative
  "quick-draw": { cond: "always", effect: "advantage on initiative rolls" },
  stall: { cond: "always", effect: "always acts last in initiative" },
  // saves / status immunity
  "wonder-skin": { cond: "always", effect: "advantage on saves vs burn/freeze/poison/paralysis" },
  "vital-spirit": { cond: "always", effect: "immune to sleep" },
  // status-triggered
  "marvel-scale": { cond: { status: "any" }, effect: "+2 AC while suffering a status condition" },
  "quick-feet": { cond: { status: "any" }, effect: "+15 ft speed while suffering a status" },
  "shed-skin": { cond: { status: "any" }, effect: "end of each turn while statused: roll 1d4; on a 4 the status is cured" },
  "tangled-feet": { cond: { status: "confus" }, effect: "attackers have disadvantage while it is confused" },
  "poison-heal": { cond: { status: "poison" }, effect: "while poisoned: ignore the poison disadvantage, and heal half of any poison damage instead of taking it" },
  "early-bird": { cond: { status: "sleep" }, effect: "advantage on the roll to wake from sleep" },
  // HP-threshold defense / forms
  multiscale: { cond: { hpFull: true }, effect: "at full HP: halve the first damage taken" },
  "shadow-shield": { cond: { hpFull: true }, effect: "at full HP: halve the first damage taken" },
  "tera-shell": { cond: { hpFull: true }, effect: "at full HP: resist all damage types" },
  "anger-shell": { cond: { hpPctBelow: 50 }, effect: "below half HP: -2 AC, +2 STR & DEX (max 22)" },
  "shields-down": { cond: { hpPctBelow: 50 }, effect: "Meteor Form is immune to non-volatile status; below 50% HP it breaks to Core Form: +6 DEX, -4 AC" },
  "zen-mode": { cond: { hpPctBelow: 50 }, effect: "below 50% HP: type → Fire/Psychic, +4 AC, swap STR/WIS" },
  "zen-mode-galarian": { cond: { hpPctBelow: 50 }, effect: "below 50% HP: type → Ice/Fire, +2 STR & +2 DEX" },
  schooling: { cond: "always", effect: "School Form (lvl 5+, above 25% HP): +5 AC/STR/DEX/CON" },
  disguise: { cond: "always", effect: "first hit each short rest is negated by a temp-HP shield (2× level)" },
  // Terastallize-triggered
  "embody-aspect-cornerstone": { cond: "always", effect: "on Terastallize: set CON to 23 if lower" },
  "embody-aspect-heartflame": { cond: "always", effect: "on Terastallize: set STR to 23 if lower" },
  "embody-aspect-teal": { cond: "always", effect: "on Terastallize: set DEX to 23 if lower" },
  "embody-aspect-wellspring": { cond: "always", effect: "on Terastallize: set CHA to 23 if lower" },
};

/** Pokémon-wide passive effects for the abilities present (surfaced as reminders, lit when active). */
export function passiveAbilityEffects(ids: string[]): PassiveEffect[] {
  const out: PassiveEffect[] = [];
  for (const id of ids) {
    const p = PASSIVES[id];
    if (p) out.push({ ability: nameOf(id), cond: p.cond, effect: p.effect });
  }
  return out;
}
