import { describe, it, expect } from 'vitest';
import { parseSpeeds, primarySpeed, formatSpeeds, hasMultipleSpeeds } from '../src/poke5e/speed';
import { pokemonToCharacter } from '../src/poke5e/pokemon';

// Real poke5e species speed arrays (from pokemon.json). walking is always listed first when present.
const SNIVY = [{ type: 'walking', value: 25 }, { type: 'climbing', value: 25 }];
const DIGLETT = [{ type: 'burrowing', value: 20 }];              // no walking → burrowing leads
const MAGNEMITE = [{ type: 'hover', value: 20 }];                // no walking → hover leads
const MAGIKARP = [{ type: 'walking', value: 5 }, { type: 'swimming', value: 25 }]; // slow flop
const KORAIDON = [{ type: 'walking', value: 60 }, { type: 'swimming', value: 40 }, { type: 'climbing', value: 30 }, { type: 'flying', value: 60 }];

describe('speed.parseSpeeds', () => {
  it('normalizes type/value and drops malformed / non-positive entries', () => {
    expect(parseSpeeds(SNIVY)).toEqual(SNIVY);
    expect(parseSpeeds([{ type: 'walking', value: 0 }, { type: 'flying', value: 30 }])).toEqual([{ type: 'flying', value: 30 }]);
    expect(parseSpeeds([{ value: 30 }])).toEqual([{ type: 'walking', value: 30 }]); // missing type defaults to walking
    expect(parseSpeeds(null)).toEqual([]);
    expect(parseSpeeds('30')).toEqual([]);
  });
});

describe('speed.primarySpeed', () => {
  it('uses walking when present', () => {
    expect(primarySpeed(SNIVY)).toBe(25);
    expect(primarySpeed(MAGIKARP)).toBe(5);
    expect(primarySpeed(KORAIDON)).toBe(60);
  });
  it('uses the leading mode when there is no walking speed', () => {
    expect(primarySpeed(DIGLETT)).toBe(20);
    expect(primarySpeed(MAGNEMITE)).toBe(20);
  });
  it('falls back to 30 only when a species has no speed data', () => {
    expect(primarySpeed([])).toBe(30);
    expect(primarySpeed([], 25)).toBe(25);
  });
});

describe('speed.formatSpeeds', () => {
  it('shows walking bare and prefixes other modes', () => {
    expect(formatSpeeds(SNIVY)).toBe('25 ft, climbing 25 ft');
    expect(formatSpeeds(DIGLETT)).toBe('burrowing 20 ft');
    expect(formatSpeeds(KORAIDON)).toBe('60 ft, swimming 40 ft, climbing 30 ft, flying 60 ft');
  });
});

describe('speed.hasMultipleSpeeds', () => {
  it('is true only with more than one mode', () => {
    expect(hasMultipleSpeeds(SNIVY)).toBe(true);
    expect(hasMultipleSpeeds(DIGLETT)).toBe(false);
    expect(hasMultipleSpeeds([])).toBe(false);
  });
});

describe('pokemonToCharacter derives speed from the SPECIES, not the (nonexistent) pokemon row field', () => {
  const pk = { species: 'snivy', level: 5, strength: 10, dexterity: 14, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10, hp_max: 20, hp_cur: 20, speed_walking: 99 };

  it('reads the species walking speed (ignores any stray pk.speed_walking)', () => {
    const { model } = pokemonToCharacter(pk, [], {}, [], SNIVY);
    expect(model.speed).toBe(25); // NOT 99, NOT 30
    expect(model.speeds).toEqual(SNIVY);
  });

  it('uses the leading non-walking mode for species with no walking speed', () => {
    const { model } = pokemonToCharacter({ ...pk, species: 'diglett' }, [], {}, [], DIGLETT);
    expect(model.speed).toBe(20);
    expect(model.speeds).toEqual(DIGLETT);
  });

  it('falls back to 30 with no speeds and leaves speeds undefined', () => {
    const { model } = pokemonToCharacter(pk, [], {}, [], []);
    expect(model.speed).toBe(30);
    expect(model.speeds).toBeUndefined();
  });
});
