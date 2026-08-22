// PURE Roll20 roll-template / inline-dice string builders.
// No DOM, no side effects — every function returns a string.
// Mirrors the Roll20 native-template command format documented in
// reference/beyond20-analysis.md (sections A & C).

/** Resolved advantage state after request + rule effects have been combined. */
export type ResolvedAdvantage =
  | 'normal'
  | 'advantage'
  | 'disadvantage'
  | 'super-advantage'
  | 'super-disadvantage';

/** Format a flat modifier as an inline-roll additive term: ` + 5` / ` - 3` / `` (0). */
export function fmtAdd(n: number): string {
  if (!n) return '';
  return n > 0 ? ` + ${n}` : ` - ${Math.abs(n)}`;
}

/** Format a modifier for a `{{mod=...}}` field: `+5` / `-3` / `+0`. */
export function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

export interface D20TermOptions {
  /** flat modifier added after the die (0 => omitted). */
  mod?: number;
  /** crit-highlight limit value; emitted as `cs>N`. Default 20. */
  critRange?: number;
  /** reroll-once threshold; emitted as `ro<=N` on the die. */
  reroll?: number;
  /** floor each die at this value; emitted as `minN`. */
  minDie?: number;
  /** super-advantage: the die itself becomes `2d20kh1`. */
  superKeepHigher?: boolean;
  /** super-disadvantage: the die itself becomes `2d20kl1`. */
  superKeepLower?: boolean;
  /** replace the base `1d20` entirely (initiative advantage uses `2d20kh1`). */
  dice?: string;
  /** extra additive dice folded into the d20 roll (Bless `1d4`, Guidance `1d4`). */
  bonusDice?: string[];
  /** append Roll20 turn-tracker token inside the inline roll (initiative). */
  tracker?: boolean;
  /** omit the `cs>N` crit-highlight specifier entirely (initiative can't crit; Beyond20's
   *  initiative roll has no `cs`, and we keep the tracker die byte-for-byte like theirs). */
  noCrit?: boolean;
}

/** Build a single `[[1d20cs>N ... + MOD]]` inline-roll term. */
export function d20Term(o: D20TermOptions = {}): string {
  const critRange = o.critRange ?? 20;
  let dice = o.dice ?? '1d20';
  if (o.superKeepHigher) dice = '2d20kh1';
  else if (o.superKeepLower) dice = '2d20kl1';

  let s = o.noCrit ? dice : `${dice}cs>${critRange}`;
  if (o.reroll !== undefined) s += `ro<=${o.reroll}`;
  if (o.minDie !== undefined) s += `min${o.minDie}`;
  for (const d of o.bonusDice ?? []) s += ` + ${d}`;
  s += fmtAdd(o.mod ?? 0);
  if (o.tracker) s += ' &{tracker}';
  return `[[${s}]]`;
}

/** True when this advantage state renders two d20 columns. */
export function isTwoDie(adv: ResolvedAdvantage): boolean {
  return adv !== 'normal';
}

/** The Roll20 flag field for an advantage state. */
export function advFlag(adv: ResolvedAdvantage): string {
  switch (adv) {
    case 'advantage':
    case 'super-advantage':
      return '{{advantage=1}}';
    case 'disadvantage':
    case 'super-disadvantage':
      return '{{disadvantage=1}}';
    default:
      return '{{normal=1}}';
  }
}

/** Emit `{{r1=...}}` and (when two-die) `{{r2=...}}` terms for a d20 roll. */
function d20Columns(base: D20TermOptions, adv: ResolvedAdvantage): string[] {
  const r1 = d20Term(base);
  const out = [`{{r1=${r1}}}`];
  if (isTwoDie(adv)) {
    const r2 = d20Term({
      ...base,
      superKeepHigher: adv === 'super-advantage',
      superKeepLower: adv === 'super-disadvantage',
    });
    out.push(`{{r2=${r2}}}`);
  }
  return out;
}

export interface SimpleRollOptions {
  name: string;
  mod: number;
  advantage: ResolvedAdvantage;
  critRange?: number;
  reroll?: number;
  bonusDice?: string[];
  whisper?: boolean;
  speakingAs?: string;
  /** initiative: single die with real 2d20kh1/kl1 + &{tracker}. */
  initiative?: boolean;
}

/** `&{template:simple}` — checks, saves, skills, initiative. */
export function simpleRoll(o: SimpleRollOptions): string {
  const parts: string[] = [];
  if (o.whisper) parts.push('/w gm');
  parts.push('&{template:simple}');  parts.push(`{{rname=${o.name}}}`);
  parts.push(`{{mod=${fmtSigned(o.mod)}}}`);

  const base: D20TermOptions = {
    mod: o.mod,
    critRange: o.critRange,
    reroll: o.reroll,
    bonusDice: o.bonusDice,
    tracker: o.initiative,
    noCrit: o.initiative, // match Beyond20's initiative die exactly: no `cs>20`
  };

  if (o.initiative) {
    // Initiative uses a single real keep-die + tracker rather than two columns.
    let dice = '1d20';
    if (o.advantage === 'super-advantage') dice = '3d20kh1';
    else if (o.advantage === 'advantage') dice = '2d20kh1';
    else if (o.advantage === 'super-disadvantage') dice = '3d20kl1';
    else if (o.advantage === 'disadvantage') dice = '2d20kl1';
    parts.push(`{{r1=${d20Term({ ...base, dice })}}}`);
    parts.push(advFlag(o.advantage));
  } else {
    parts.push(...d20Columns(base, o.advantage));
    parts.push(advFlag(o.advantage));
  }

  return parts.join(' ');
}

export interface AttackDamageRollOptions {
  name: string;
  attackMod: number;
  advantage: ResolvedAdvantage;
  critRange?: number;
  attackReroll?: number;
  attackBonusDice?: string[];
  /** base weapon/spell damage dice, e.g. `1d8`. */
  damageFormula?: string;
  damageMod: number;
  damageBonusDice?: string[];
  damageReroll?: number;
  damageMin?: number;
  damageType?: string;
  crit?: boolean;
  whisper?: boolean;
  speakingAs?: string;
}

/** Assemble the inner damage formula (dice + bonus dice + flat mod). */
function damageInner(o: AttackDamageRollOptions): { formula: string; critDice: string } {
  const diceParts: string[] = [];
  let base = o.damageFormula ?? '';
  if (base) {
    if (o.damageReroll !== undefined) base += `ro<=${o.damageReroll}`;
    if (o.damageMin !== undefined) base += `min${o.damageMin}`;
    diceParts.push(base);
  }
  for (const d of o.damageBonusDice ?? []) diceParts.push(d);

  const critDice = diceParts.join(' + '); // PHB crit = the dice portion only, rolled again
  let formula = diceParts.join(' + ');
  if (o.damageMod) {
    formula = formula ? formula + fmtAdd(o.damageMod) : String(o.damageMod);
  }
  if (!formula) formula = '0';
  return { formula, critDice };
}

/** `&{template:atkdmg}` — a weapon attack with damage. */
export function attackDamageRoll(o: AttackDamageRollOptions): string {
  const parts: string[] = [];
  if (o.whisper) parts.push('/w gm');
  parts.push('&{template:atkdmg}');  parts.push(`{{rname=${o.name}}}`);
  parts.push(`{{mod=${fmtSigned(o.attackMod)}}}`);

  const base: D20TermOptions = {
    mod: o.attackMod,
    critRange: o.critRange,
    reroll: o.attackReroll,
    bonusDice: o.attackBonusDice,
  };
  parts.push(...d20Columns(base, o.advantage));
  parts.push('{{attack=1}}');
  parts.push(advFlag(o.advantage));

  const dmg = damageInner(o);
  parts.push('{{damage=1}}');
  parts.push('{{dmg1flag=1}}');
  parts.push(`{{dmg1=[[${dmg.formula}]]}}`);
  if (o.damageType) parts.push(`{{dmg1type=${o.damageType}}}`);

  if (o.crit && dmg.critDice) {
    parts.push('{{crit=1}}');
    parts.push(`{{crit1=[[${dmg.critDice}]]}}`);
  }

  return parts.join(' ');
}

export interface DefaultRollOptions {
  name: string;
  formula: string;
  whisper?: boolean;
  speakingAs?: string;
}

/** `&{template:atkdmg}` damage-only — a standalone damage/heal roll (e.g. a save-based
 *  or leveled spell like Fireball) rendered as a proper D&D-5e card instead of the plain
 *  black `&{template:default}` box. Reuses the atkdmg template with the attack section
 *  omitted, so only the damage row shows. */
export function damageCardRoll(o: { name: string; formula: string; damageType?: string; whisper?: boolean; speakingAs?: string }): string {
  const parts: string[] = [];
  if (o.whisper) parts.push('/w gm');
  parts.push('&{template:atkdmg}');
  parts.push(`{{rname=${o.name}}}`);
  parts.push('{{damage=1}}');
  parts.push('{{dmg1flag=1}}');
  parts.push(`{{dmg1=[[${o.formula}]]}}`);
  if (o.damageType) parts.push(`{{dmg1type=${o.damageType}}}`);
  return parts.join(' ');
}

/** `&{template:default}` — fallback (e.g. a standalone damage roll). */
export function defaultRoll(o: DefaultRollOptions): string {
  const parts: string[] = [];
  if (o.whisper) parts.push('/w gm');
  parts.push('&{template:default}');
  parts.push(`{{name=${o.name}}}`);  parts.push(`{{Roll=[[${o.formula}]]}}`);
  return parts.join(' ');
}
