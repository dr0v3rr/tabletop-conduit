// Layer-4 compose/output. Turns a computed RollModel + a RollRequest into a
// Roll20 chat-command string, applying resolved rule effects (RuleEffect[]).
//
// Base modifier resolution:
//   skill      -> model.skills[key].mod
//   save       -> model.saves[ability].mod
//   check      -> model.abilities[ability].mod
//   initiative -> model.initiative
//   attack     -> optional request.baseAttackMod (else 0)
//   damage     -> 0 (built from effects / base damage)

import type { RollModel, Ability, SkillKey } from '../engine';
import type { RollRequest, RuleEffect, AdvantageMode } from '../shared/roll-types';
import {
  simpleRoll,
  attackDamageRoll,
  defaultRoll,
  damageCardRoll,
  type ResolvedAdvantage,
} from '../roll20/format';

/** Optional, non-contract request fields a caller may supply for weapon attacks. */
export interface AttackExtras {
  /** base to-hit modifier before effects (e.g. STR/DEX + prof + magic). */
  baseAttackMod?: number;
  /** base weapon/spell damage dice, e.g. `1d8`. */
  baseDamage?: string;
  /** damage type label. */
  damageType?: string;
  /** force the roll's template (rare). */
  speakingAs?: string;
}

export interface ComposedRoll {
  template: 'simple' | 'atkdmg' | 'default';
  name: string;
  whisper: boolean;
  advantage: ResolvedAdvantage;
  /** the d20 modifier after effects (attack/check/save/skill/initiative). */
  d20Mod: number;
  critRange: number;
  /** extra dice folded into the d20 roll (Bless/Guidance). */
  d20BonusDice: string[];
  /** damage detail (attack rolls only). */
  damage?: { formula: string; mod: number; bonusDice: string[] };
  /** human-readable notes for effects with no native Roll20 encoding. */
  notes: string[];
  /** the emitted Roll20 chat command. */
  command: string;
}

const ABILITY_ALIASES: Record<string, Ability> = {
  str: 'STR', strength: 'STR',
  dex: 'DEX', dexterity: 'DEX',
  con: 'CON', constitution: 'CON',
  int: 'INT', intelligence: 'INT',
  wis: 'WIS', wisdom: 'WIS',
  cha: 'CHA', charisma: 'CHA',
};

function toAbility(key: string | undefined): Ability {
  const a = ABILITY_ALIASES[(key ?? '').toLowerCase()];
  return a ?? 'STR';
}

function titleCase(s: string): string {
  return s
    .split('-')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Which effect targets feed the d20 modifier for a given roll kind. */
function d20Targets(kind: RollRequest['kind']): ReadonlySet<string> {
  switch (kind) {
    case 'attack':
      return new Set(['attack']);
    case 'skill':
      return new Set(['skill', 'check']);
    case 'check':
      return new Set(['check']);
    case 'save':
      return new Set(['save']);
    case 'initiative':
      return new Set(['initiative', 'check']);
    default:
      return new Set<string>();
  }
}

/** The single advantage-effect target that applies to a given roll kind.
 *  attack -> 'attack'; skill/check/initiative -> 'check'; save -> 'save'. */
function advantageTarget(kind: RollRequest['kind']): 'attack' | 'check' | 'save' {
  switch (kind) {
    case 'attack':
      return 'attack';
    case 'save':
      return 'save';
    default:
      return 'check'; // skill / check / initiative
  }
}

/** Combine request advantage with any `advantage` rule effects. Effects win.
 *  When `kind` is given, an advantage effect only counts if its `target` matches
 *  the roll kind (so an attack-only advantage does NOT leak onto a save/skill). */
export function resolveAdvantage(
  base: AdvantageMode | undefined,
  effects: RuleEffect[],
  kind?: RollRequest['kind'],
): ResolvedAdvantage {
  let adv = base === 'advantage' || base === 'super-advantage' ? 1 : 0;
  let dis = base === 'disadvantage' || base === 'super-disadvantage' ? 1 : 0;
  // A manually-chosen "super" roll mode starts a 3-die roll; Elven Accuracy also produces one.
  const superAdvBase = base === 'super-advantage';
  const superDisBase = base === 'super-disadvantage';
  let elven = false;

  const allowedTarget = kind !== undefined ? advantageTarget(kind) : undefined;

  for (const e of effects) {
    if (e.op !== 'advantage') continue;
    if (allowedTarget !== undefined && e.target !== allowedTarget) continue;
    if (e.mode === 'disadvantage') dis++;
    else adv++; // 'advantage' or 'elven-accuracy'
    if (e.mode === 'elven-accuracy') elven = true;
  }

  // 5e: any advantage + any disadvantage cancel to normal (a disadvantage cancels super too).
  let net: ResolvedAdvantage =
    adv > 0 && dis > 0 ? 'normal' : adv > 0 ? 'advantage' : dis > 0 ? 'disadvantage' : 'normal';

  if (net === 'advantage' && (elven || superAdvBase)) net = 'super-advantage';
  else if (net === 'disadvantage' && superDisBase) net = 'super-disadvantage';
  return net;
}

function resolveBaseMod(model: RollModel, request: RollRequest): number {
  switch (request.kind) {
    case 'skill':
      return model.skills[request.key as SkillKey]?.mod ?? 0;
    case 'save':
      return model.saves[toAbility(request.key)]?.mod ?? 0;
    case 'check':
      return model.abilities[toAbility(request.key)]?.mod ?? 0;
    case 'initiative':
      return model.initiative;
    case 'attack':
      return (request as RollRequest & AttackExtras).baseAttackMod ?? 0;
    default:
      return 0;
  }
}

function rollName(request: RollRequest): string {
  switch (request.kind) {
    case 'skill':
      return titleCase(request.key ?? 'skill');
    case 'save':
      return `${toAbility(request.key)} Save`;
    case 'check':
      return `${toAbility(request.key)} Check`;
    case 'initiative':
      return 'Initiative';
    case 'attack':
    case 'damage':
      return request.key ?? (request.kind === 'attack' ? 'Attack' : 'Damage');
    default:
      return 'Roll';
  }
}

/** Compose a RollModel + RollRequest into a structured, ready-to-emit roll. */
/** Build the inline-roll formula for a d20 roll in the universal default-template style. */
function buildDefaultD20Formula(
  mod: number,
  advantage: ResolvedAdvantage,
  reroll: number | undefined,
  bonusDice: string[],
  critRange?: number,
): string {
  let die: string;
  switch (advantage) {
    case 'advantage': die = '2d20kh1'; break;
    case 'disadvantage': die = '2d20kl1'; break;
    case 'super-advantage': die = '3d20kh1'; break;
    case 'super-disadvantage': die = '3d20kl1'; break;
    default: die = '1d20';
  }
  // Show an (expanded) crit range on attack rolls in default style: `cs>N`.
  if (critRange !== undefined) die += `cs>${critRange}`;
  if (reroll) die += `ro<=${reroll}`;
  let f = die;
  for (const d of bonusDice) f += ` + ${d}`;
  if (mod) f += mod >= 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
  return f;
}

/** Build the dice-only portion of a damage roll (base weapon dice + bonus dice),
 *  applying reroll (`ro<=N`) and min-die (`minN`) to the base weapon dice — mirrors
 *  the sheet-mode `damageInner` in roll20/format.ts. Excludes the flat modifier so the
 *  same string can be reused as the PHB crit-doubling dice. */
function buildDamageDice(
  baseDamage: string | undefined,
  bonusDice: string[],
  reroll: number | undefined,
  min: number | undefined,
): string {
  const parts: string[] = [];
  let base = baseDamage ?? '';
  if (base) {
    if (reroll !== undefined) base += `ro<=${reroll}`;
    if (min !== undefined) base += `min${min}`;
    parts.push(base);
  }
  for (const d of bonusDice) parts.push(d);
  return parts.join(' + ');
}

/** Separate a baked damage string ("2d6 + 3") into its dice-only portion and the flat modifier.
 *  Producers bake a weapon/spell's ability+magic damage bonus into the dice string; if that flat
 *  rides along it gets doubled on a crit and breaks GWF reroll/min-die (which must attach to the
 *  dice, not the "+3"). Splitting it here routes the flat through `damageMod` where it belongs. */
export function splitDamageMod(s: string | undefined): { dice: string; flat: number } {
  if (!s) return { dice: '', flat: 0 };
  const diceParts: string[] = [];
  let flat = 0;
  for (const raw of s.split(/(?=[+-])/)) {
    const term = raw.trim();
    if (!term) continue;
    if (/^[+-]?\s*\d+$/.test(term)) flat += Number(term.replace(/\s+/g, '')); // pure integer term
    else diceParts.push(term);
  }
  return { dice: diceParts.join(' ').replace(/^\+\s*/, '').trim(), flat };
}

export function composeRoll(model: RollModel, request: RollRequest): ComposedRoll {
  const effects = request.effects ?? [];
  const extras = request as RollRequest & AttackExtras;
  const notes: string[] = [];

  const d20Set = d20Targets(request.kind);
  let d20Mod = resolveBaseMod(model, request);
  // Ad-hoc situational modifier applies to any d20 roll (skips pure damage rolls, which have none).
  if (request.adhocMod && d20Set.size > 0) d20Mod += request.adhocMod;
  let critRange = 20;
  let d20Reroll: number | undefined;
  const d20BonusDice: string[] = [];

  // damage accumulation (attack rolls). The producer bakes the weapon/spell flat damage bonus into
  // baseDamage ("2d6 + 3"); split it back out so the flat rides in damageMod (not the crit dice).
  const baseSplit = splitDamageMod(extras.baseDamage);
  let damageMod = baseSplit.flat;
  const damageBonusDice: string[] = [];
  let damageReroll: number | undefined;
  let damageMin: number | undefined;

  for (const e of effects) {
    switch (e.op) {
      case 'flat':
        if (e.target === 'damage') damageMod += e.value;
        // 'd20' = every d20 roll (attack/skill/check/save/initiative) — e.g. Exhaustion 2024.
        else if (e.target === 'd20') { if (d20Set.size > 0) d20Mod += e.value; }
        else if (d20Set.has(e.target)) d20Mod += e.value;
        break;
      case 'add-dice':
        if (e.target === 'damage') damageBonusDice.push(e.dice);
        else if (d20Set.has(e.target)) d20BonusDice.push(e.dice);
        break;
      case 'reroll':
        if (e.target === 'damage') damageReroll = e.threshold;
        // 'd20' = every d20 roll (Halfling Lucky); 'attack' = attack-only reroll.
        else if (e.target === 'd20') { if (d20Set.size > 0) d20Reroll = e.threshold; }
        else if (request.kind === 'attack') d20Reroll = e.threshold;
        break;
      case 'min-die':
        if (e.target === 'damage') damageMin = e.min;
        break;
      case 'crit-range':
        if (request.kind === 'attack') critRange = e.range;
        break;
      case 'reroll-keep-higher':
        notes.push(`${e.label ?? 'Savage Attacker'}: reroll damage dice once, keep higher (manual)`);
        break;
      // 'advantage' handled by resolveAdvantage
    }
  }

  const advantage = resolveAdvantage(request.advantage, effects, request.kind);
  const whisper = !!request.whisper;
  const name = rollName(request);
  const speakingAs = request.speakingAs ?? extras.speakingAs;

  const style = request.templateStyle ?? 'sheet';

  // 'cast' — a spell-cast announcement with no dice (e.g. utility spells like Invisibility).
  if (request.kind === 'cast') {
    const p: string[] = [];
    if (whisper) p.push('/w gm');
    // On a D&D-5e sheet, use the same `simple` card as checks/saves so it matches the rest;
    // only fall back to the black &{template:default} card when no sheet template exists.
    const verb = request.verb ?? 'Casts';
    if (style === 'sheet') p.push('&{template:simple}', `{{rname=${verb} ${request.key ?? name}}}`);
    else p.push('&{template:default}', `{{name=${verb} ${request.key ?? name}}}`);
    return { template: style === 'sheet' ? 'simple' : 'default', name, whisper, advantage, d20Mod: 0, critRange: 20, d20BonusDice: [], notes, command: p.join(' ') };
  }

  // Universal &{template:default} path — renders in any campaign (no D&D 5e sheet required).
  // Advantage uses 2d20kh1 / 2d20kl1 so the kept die is computed correctly without a sheet.
  if (style === 'default') {
    const d20Formula = buildDefaultD20Formula(
      d20Mod,
      advantage,
      d20Reroll,
      d20BonusDice,
      request.kind === 'attack' ? critRange : undefined,
    );
    if (request.kind === 'attack') {
      // dice-only portion (reroll/min applied) — reused for PHB crit doubling.
      const critDice = buildDamageDice(baseSplit.dice, damageBonusDice, damageReroll, damageMin);
      let dF = critDice;
      if (damageMod) dF = dF ? `${dF} + ${damageMod}` : String(damageMod);
      const p: string[] = [];
      if (whisper) p.push('/w gm');
      p.push('&{template:default}', `{{name=${name}}}`);      p.push(`{{Attack=[[${d20Formula}]]}}`);
      if (dF) p.push(`{{Damage=[[${dF}]]}}`);
      // On a crit, roll the weapon dice a second time (PHB) — dice only, no flat mod.
      if (request.crit && critDice) p.push(`{{Crit=[[${critDice}]]}}`);
      return { template: 'default', name, whisper, advantage, d20Mod, critRange, d20BonusDice,
        damage: { formula: baseSplit.dice, mod: damageMod, bonusDice: damageBonusDice },
        notes, command: p.join(' ') };
    }
    if (request.kind !== 'damage') {
      const command = defaultRoll({ name, formula: d20Formula, whisper, speakingAs });
      return { template: 'default', name, whisper, advantage, d20Mod, critRange, d20BonusDice, notes, command };
    }
    // 'damage' falls through — it already uses defaultRoll below.
  }

  if (request.kind === 'attack') {
    const damageFormula = baseSplit.dice;
    const command = attackDamageRoll({
      name,
      attackMod: d20Mod,
      advantage,
      critRange,
      attackReroll: d20Reroll,
      attackBonusDice: d20BonusDice,
      damageFormula,
      damageMod,
      damageBonusDice,
      damageReroll,
      damageMin,
      damageType: extras.damageType,
      crit: request.crit,
      whisper,
      speakingAs,
    });
    return {
      template: 'atkdmg',
      name,
      whisper,
      advantage,
      d20Mod,
      critRange,
      d20BonusDice,
      damage: { formula: damageFormula ?? '', mod: damageMod, bonusDice: damageBonusDice },
      notes,
      command,
    };
  }

  if (request.kind === 'damage') {
    // Standalone damage roll (no attack d20). Apply reroll (`ro<=N`) / min-die (`minN`)
    // to the base weapon dice, then the flat mod, then PHB crit doubling of the dice.
    const dice = buildDamageDice(baseSplit.dice, damageBonusDice, damageReroll, damageMin);
    let formula = dice;
    if (damageMod) formula = formula ? `${formula} + ${damageMod}` : String(damageMod);
    if (request.crit && dice) formula = `${formula} + ${dice}`;
    if (!formula) formula = '0';
    // On a D&D-5e sheet, render as a proper damage card; otherwise the plain default box.
    const command = style === 'sheet'
      ? damageCardRoll({ name, formula, damageType: extras.damageType, whisper, speakingAs })
      : defaultRoll({ name, formula, whisper, speakingAs });
    return {
      template: style === 'sheet' ? 'atkdmg' : 'default',
      name,
      whisper,
      advantage,
      d20Mod: 0,
      critRange,
      d20BonusDice: [],
      damage: { formula, mod: damageMod, bonusDice: damageBonusDice },
      notes,
      command,
    };
  }

  // skill / save / check / initiative -> simple template
  const command = simpleRoll({
    name,
    mod: d20Mod,
    advantage,
    critRange,
    reroll: d20Reroll,
    bonusDice: d20BonusDice,
    whisper,
    speakingAs,
    initiative: request.kind === 'initiative',
  });

  return {
    template: 'simple',
    name,
    whisper,
    advantage,
    d20Mod,
    critRange,
    d20BonusDice,
    notes,
    command,
  };
}

/** Convenience: compose and return only the Roll20 chat-command string. */
export function buildRoll20Command(model: RollModel, request: RollRequest): string {
  return composeRoll(model, request).command;
}
