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
  it('caps dual-type effectiveness (poke5e: no double vulnerability / resistance)', () => {
    expect(typeMultiplier('rock', ['ice', 'bug'])).toBe(2);   // VG ×4 → capped ×2
    expect(typeMultiplier('fire', ['water', 'rock'])).toBe(0.5); // VG ×¼ → capped ×½
    expect(typeMultiplier('ground', ['fire', 'flying'])).toBe(0); // flying immune → ×0 (dominates)
    expect(typeMultiplier('water', ['ground', 'rock'])).toBe(2); // VG ×4 → ×2
    expect(typeMultiplier('fire', ['ice', 'bug'])).toBe(2);   // Snom weak to Fire → ×2, not ×4
    // weak on one half + resisted on the other → they cancel to normal (×1)
    expect(typeMultiplier('grass', ['water', 'grass'])).toBe(1); // grass ×2 vs water, ×½ vs grass → ×1
  });
  it('is case-insensitive and neutral on empty defenders', () => {
    expect(typeFactor('FIRE', 'GRASS')).toBe(2);
    expect(typeMultiplier('fire', [])).toBe(1);
  });
  it('builds a defensive type matchup (Vulnerable ×2 / Resist ×½ / Immune ×0 — no ×4/×¼)', () => {
    const s = (a: string[]) => [...a].sort();
    const snom = typeMatchup(['ice', 'bug']); // Snom — Fire/Rock vulnerable (×2, not ×4)
    expect(s(snom.vulnerable)).toEqual(['fire', 'flying', 'rock', 'steel']);
    expect(s(snom.resist)).toEqual(['grass', 'ground', 'ice']);
    expect(snom.immune).toEqual([]);

    const ralts = typeMatchup(['psychic', 'fairy']);
    expect(ralts.immune).toEqual(['dragon']);                 // Fairy → immune to Dragon
    expect(s(ralts.resist)).toEqual(['fighting', 'psychic']); // Fighting (VG ×¼) folds into Resist ×½
    expect(s(ralts.vulnerable)).toEqual(['ghost', 'poison', 'steel']);

    const geo = typeMatchup(['rock', 'electric']); // Alolan Geodude
    expect(geo.vulnerable).toContain('ground');   // VG ×4 → Vulnerable
    expect(geo.resist).toContain('flying');        // VG ×¼ → Resist

    expect(typeMatchup([])).toEqual({ vulnerable: [], resist: [], immune: [] });
  });
  it('labels multipliers', () => {
    expect(effectivenessLabel(2)).toMatch(/super effective/i);
    expect(effectivenessLabel(0.5)).toMatch(/not very/i);
    expect(effectivenessLabel(0)).toMatch(/immune/i);
    expect(effectivenessLabel(1)).toBeNull();
  });
});
