import { describe, it, expect } from 'vitest';
import { typeFactor, typeMultiplier, effectivenessLabel, typeMatchup, POKE_TYPES } from '../src/poke5e/type-chart';

describe('poke5e type chart', () => {
  it('has the 18 Pokémon types', () => {
    expect(POKE_TYPES.length).toBe(18);
    expect(POKE_TYPES).toContain('bug');
  });
  it('single-type effectiveness', () => {
    expect(typeFactor('fire', 'grass')).toBe(2);      // super effective
    expect(typeFactor('water', 'fire')).toBe(2);
    expect(typeFactor('fire', 'water')).toBe(0.5);    // resisted
    expect(typeFactor('electric', 'ground')).toBe(0); // immune
    expect(typeFactor('normal', 'ghost')).toBe(0);
    expect(typeFactor('bug', 'psychic')).toBe(2);
    expect(typeFactor('bug', 'fire')).toBe(0.5);
    expect(typeFactor('normal', 'normal')).toBe(1);   // neutral
  });
  it('dual-type multipliers stack', () => {
    expect(typeMultiplier('rock', ['ice', 'bug'])).toBe(4);       // 2 × 2 = ×4
    expect(typeMultiplier('fire', ['water', 'rock'])).toBe(0.25); // ½ × ½ = ×¼
    expect(typeMultiplier('ground', ['fire', 'flying'])).toBe(0); // 2 × 0 (flying immune) = 0
    expect(typeMultiplier('water', ['ground', 'rock'])).toBe(4);
    expect(typeMultiplier('fire', ['ice', 'bug'])).toBe(4);       // Snom (Ice/Bug) weak to Fire ×4
  });
  it('is case-insensitive and neutral on empty defenders', () => {
    expect(typeFactor('FIRE', 'GRASS')).toBe(2);
    expect(typeMultiplier('fire', [])).toBe(1);
  });
  it('builds a defensive type matchup, bucketed by multiplier', () => {
    const s = (a: string[]) => [...a].sort();
    const snom = typeMatchup(['ice', 'bug']); // Snom — famously ×4 to Fire and Rock
    expect(s(snom.x4)).toEqual(['fire', 'rock']);
    expect(s(snom.x2)).toEqual(['flying', 'steel']);
    expect(s(snom.half)).toEqual(['grass', 'ground', 'ice']);
    expect(snom.quarter).toEqual([]);
    expect(snom.immune).toEqual([]);

    const ralts = typeMatchup(['psychic', 'fairy']);
    expect(ralts.immune).toEqual(['dragon']);   // Fairy → immune to Dragon
    expect(ralts.quarter).toEqual(['fighting']); // Psychic ½ × Fairy ½
    expect(ralts.half).toEqual(['psychic']);
    expect(s(ralts.x2)).toEqual(['ghost', 'poison', 'steel']);

    const geo = typeMatchup(['rock', 'electric']); // Alolan Geodude
    expect(geo.x4).toEqual(['ground']);
    expect(geo.quarter).toEqual(['flying']);

    expect(typeMatchup([])).toEqual({ x4: [], x2: [], half: [], quarter: [], immune: [] }); // no types → nothing
  });
  it('labels multipliers', () => {
    expect(effectivenessLabel(2)).toMatch(/super effective/i);
    expect(effectivenessLabel(4)).toMatch(/×4/);
    expect(effectivenessLabel(0.5)).toMatch(/not very/i);
    expect(effectivenessLabel(0.25)).toMatch(/¼/);
    expect(effectivenessLabel(0)).toMatch(/immune/i);
    expect(effectivenessLabel(1)).toBeNull();
  });
});
