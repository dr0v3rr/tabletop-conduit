import { describe, it, expect } from 'vitest';
import { extractReadKey, trainerToRollModel, trainerExtras } from '../src/poke5e/source';

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
  it('reads proficiency RANK for expertise (rank 2 doubles the bonus)', () => {
    const m = trainerToRollModel({ ...row, level: 5, rank_stealth: 2, prof_stealth: true }).model;
    expect(m.skills.stealth.expertise).toBe(true);
    expect(m.skills.stealth.mod).toBe(m.abilities.DEX.mod + m.profBonus * 2); // DEX + 2×prof
  });
});

describe('poke5e trainerExtras (Path + Specialisation)', () => {
  it('reads path_name and a taken specialization off the row (e.g. Guru + Dragon Tamer)', () => {
    const row = { path_name: 'Guru', path_resource: 0, special_dragon: 1 };
    const out = trainerExtras(row);
    expect(out[0]!.name).toBe('Path — Guru');
    const spec = out.find((e) => e.name.startsWith('Specialisation'))!;
    expect(spec.name).toBe('Specialisation — Dragon Tamer');
    expect(spec.description).toContain('+1 WIS');
    expect(spec.description).toContain('+1 to all skill checks made by your Dragon-type Pokémon');
  });
  it('shows stack count and populated path rank features', () => {
    const row = { path_name: 'Guru', special_psychic: 2, path_rank_1_name: 'Mind', path_rank_1_desc: 'WIS-save aura.' };
    const out = trainerExtras(row);
    expect(out[0]!.description).toContain('Mind: WIS-save aura.');
    const spec = out.find((e) => e.name.includes('Psychic'))!;
    expect(spec.name).toBe('Specialisation — Psychic ×2');
    expect(spec.description).toContain('+2 to all skill checks');
  });
  it('is empty when the trainer has no path or specialization', () => {
    expect(trainerExtras({ path_name: '' })).toEqual([]);
  });
});
