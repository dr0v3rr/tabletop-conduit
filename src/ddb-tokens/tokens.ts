// D&D Beyond macro-token evaluator. Action/spell strings on DDB embed tokens like
// `1d8{{modifier:int@min:1}}` or `{{scalevalue}}`; this resolves them against a
// character context into a plain Roll20-ready dice/number string.

import type { Ability } from '../engine';

export interface TokenContext {
  abilityMods: Record<Ability, number>;
  proficiency: number;
  level: number;
  classLevel?: number;
  /** pre-resolved value for `{{scalevalue}}` (e.g. cantrip/level scaling dice). */
  scaleValue?: string;
}

const ABILITY_ALIASES: Record<string, Ability> = {
  str: 'STR', strength: 'STR',
  dex: 'DEX', dexterity: 'DEX',
  con: 'CON', constitution: 'CON',
  int: 'INT', intelligence: 'INT',
  wis: 'WIS', wisdom: 'WIS',
  cha: 'CHA', charisma: 'CHA',
};

/** Render a numeric modifier as a signed additive term: `+4`, `-2`, `+0`. */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Resolve a `modifier:ABIL[@min:N][@max:N]` token body to a signed term. */
function evalModifier(body: string, ctx: TokenContext): string | null {
  const segs = body.split('@');
  const abilityKey = (segs[0] ?? '').toLowerCase().trim();
  const ability = ABILITY_ALIASES[abilityKey];
  if (!ability) return null;

  let value = ctx.abilityMods[ability] ?? 0;
  for (let i = 1; i < segs.length; i++) {
    const [op, rawN] = (segs[i] ?? '').split(':');
    const n = Number(rawN);
    if (Number.isNaN(n)) continue;
    if (op === 'min') value = Math.max(value, n);
    else if (op === 'max') value = Math.min(value, n);
  }
  return signed(value);
}

/** Resolve one token's inner text (without the `{{ }}`). Returns null if unknown. */
function evalToken(inner: string, ctx: TokenContext): string | null {
  const trimmed = inner.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('modifier:')) {
    return evalModifier(trimmed.slice('modifier:'.length), ctx);
  }
  switch (lower) {
    case 'proficiency':
      return String(ctx.proficiency);
    case 'classlevel':
      return String(ctx.classLevel ?? ctx.level);
    case 'level':
      return String(ctx.level);
    case 'scalevalue':
      return ctx.scaleValue ?? '';
    default:
      return null;
  }
}

/**
 * Evaluate all `{{...}}` DDB tokens in `expr`. Known tokens are substituted;
 * unknown tokens are left in place (clearly marked by their surviving `{{ }}`).
 */
export function evalDdbTokens(expr: string, ctx: TokenContext): string {
  return expr.replace(/\{\{([^}]*)\}\}/g, (whole, inner: string) => {
    const resolved = evalToken(inner, ctx);
    return resolved === null ? whole : resolved;
  });
}
