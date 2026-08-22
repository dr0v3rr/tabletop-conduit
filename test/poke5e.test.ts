import { describe, it, expect } from 'vitest';
import { extractReadKey, trainerToRollModel } from '../src/poke5e/source';

describe('poke5e extractReadKey', () => {
  it('pulls id from a share URL', () => {
    expect(extractReadKey('https://poke5e.app/trainers?id=abc123DEF456')).toBe('abc123DEF456');
  });
  it('accepts a bare key', () => {
    expect(extractReadKey('  abc123DEF456  ')).toBe('abc123DEF456');
  });
  it('rejects empty', () => {
    expect(extractReadKey('')).toBeNull();
  });
});

describe('poke5e trainerToRollModel', () => {
  const row = {
    name: 'Ash', level: 5, hp_max: 40, hp_cur: 31,
    strength: 12, dexterity: 16, constitution: 14, intelligence: 10, wisdom: 13, charisma: 15,
    save_dex: true, save_cha: true,
    prof_acrobatics: true, prof_perception: true,
  };
  const { model, hp } = trainerToRollModel(row);
  it('computes profBonus + ability mods', () => {
    expect(model.level).toBe(5);
    expect(model.profBonus).toBe(3); // level 5
    expect(model.abilities.DEX).toEqual({ score: 16, mod: 3 });
    expect(model.initiative).toBe(3); // DEX mod
  });
  it('applies save/skill proficiency', () => {
    expect(model.saves.DEX).toEqual({ mod: 6, proficient: true }); // 3 + 3
    expect(model.saves.STR).toEqual({ mod: 1, proficient: false }); // STR 12 → +1
    expect(model.skills.acrobatics.mod).toBe(6); // DEX 3 + prof 3
    expect(model.skills.perception.proficient).toBe(true);
    expect(model.passives.perception).toBe(10 + model.skills.perception.mod);
  });
  it('maps HP', () => {
    expect(hp).toEqual({ current: 31, max: 40, temp: 0, removed: 9 });
  });
});
