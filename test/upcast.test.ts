import { describe, it, expect } from 'vitest';
import { scaleDamageDice } from '../src/engine/upcast';

describe('scaleDamageDice — up-cast damage scaling', () => {
  it('merges into a matching die term: Fireball 8d6 in a 9th-level slot → 14d6', () => {
    expect(scaleDamageDice('8d6', '1d6', 6)).toBe('14d6'); // 6 levels above 3rd
  });

  it('scales one level at a time', () => {
    expect(scaleDamageDice('8d6', '1d6', 1)).toBe('9d6');
    expect(scaleDamageDice('8d6', '1d6', 3)).toBe('11d6');
  });

  it('honours an increment die with count > 1 (e.g. +2d10 per level)', () => {
    expect(scaleDamageDice('1d10', '2d10', 2)).toBe('5d10'); // 1 + (2×2)
  });

  it('appends a new term when the increment faces differ from the base', () => {
    expect(scaleDamageDice('2d8', '1d6', 2)).toBe('2d8 + 2d6');
  });

  it('merges only the matching-face term, leaving a flat modifier intact', () => {
    expect(scaleDamageDice('2d8 + 3', '1d8', 1)).toBe('3d8 + 3');
    expect(scaleDamageDice('2d8 + 3', '1d6', 2)).toBe('2d8 + 3 + 2d6');
  });

  it('does not confuse d6 with d60', () => {
    expect(scaleDamageDice('1d60', '1d6', 2)).toBe('1d60 + 2d6'); // appends, does not touch 1d60
  });

  it('is a no-op with no extra levels, no increment, or empty base', () => {
    expect(scaleDamageDice('8d6', '1d6', 0)).toBe('8d6');
    expect(scaleDamageDice('8d6', undefined, 6)).toBe('8d6');
    expect(scaleDamageDice('', '1d6', 6)).toBe('');
  });

  it('ignores a malformed increment die', () => {
    expect(scaleDamageDice('8d6', 'MOVE', 3)).toBe('8d6');
    expect(scaleDamageDice('8d6', '3', 3)).toBe('8d6');
  });
});
