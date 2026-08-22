import { describe, it, expect } from 'vitest';
import { evalDdbTokens } from '../src/ddb-tokens';
import type { TokenContext } from '../src/ddb-tokens';

const ctx = (overrides: Partial<TokenContext> = {}): TokenContext => ({
  abilityMods: { STR: -1, DEX: 2, CON: 2, INT: 4, WIS: 2, CHA: -1 },
  proficiency: 3,
  level: 8,
  ...overrides,
});

describe('evalDdbTokens', () => {
  it('modifier with @min clamp, INT +4 -> 1d8+4', () => {
    expect(evalDdbTokens('1d8{{modifier:int@min:1}}', ctx())).toBe('1d8+4');
  });

  it('modifier @min clamp raises a 0 modifier to +1', () => {
    expect(
      evalDdbTokens('1d8{{modifier:int@min:1}}', ctx({ abilityMods: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 } })),
    ).toBe('1d8+1');
  });

  it('plain modifier renders as a signed additive term', () => {
    expect(evalDdbTokens('1d6{{modifier:dex}}', ctx())).toBe('1d6+2');
    expect(evalDdbTokens('1d6{{modifier:str}}', ctx())).toBe('1d6-1');
  });

  it('@max clamp caps the modifier', () => {
    expect(evalDdbTokens('{{modifier:int@max:2}}', ctx())).toBe('+2');
  });

  it('proficiency -> 3', () => {
    expect(evalDdbTokens('{{proficiency}}', ctx())).toBe('3');
  });

  it('level and classlevel', () => {
    expect(evalDdbTokens('{{level}}', ctx())).toBe('8');
    expect(evalDdbTokens('{{classlevel}}', ctx({ classLevel: 5 }))).toBe('5');
    expect(evalDdbTokens('{{classlevel}}', ctx())).toBe('8'); // falls back to level
  });

  it('scalevalue passthrough', () => {
    expect(evalDdbTokens('{{scalevalue}}', ctx({ scaleValue: '2d6' }))).toBe('2d6');
  });

  it('unknown tokens are left in place (no crash)', () => {
    expect(evalDdbTokens('1d4{{unknowntoken}}', ctx())).toBe('1d4{{unknowntoken}}');
  });

  it('mixed multi-token expression', () => {
    expect(evalDdbTokens('{{scalevalue}}{{modifier:int}}', ctx({ scaleValue: '3d8' }))).toBe('3d8+4');
  });
});
