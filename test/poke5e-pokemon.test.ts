import { describe, it, expect } from 'vitest';
import { moveStat, pokemonToCharacter, statusMoveMods } from '../src/poke5e/pokemon';

const pk = { species: 'charmander', nickname: 'Blaze', type: ['fire'], level: 5,
  strength: 14, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10,
  hp_max: 30, hp_cur: 22, save_dex: true, prof_athletics: true };

const flamethrower = { id: 'flamethrower', name: 'Flamethrower', type: 'fire', power: ['str', 'dex'],
  damage: { dice: { '1': '2d8', '5': '2d10', '10': '3d10', '17': '4d12' }, modifier: 'MOVE', type: ['fire'] },
  save: { attribute: ['dex'], dc: 'MOVE' } };
const tackle = { id: 'tackle', name: 'Tackle', type: 'normal', power: ['str', 'dex'],
  attack: { scope: 'melee' }, damage: { dice: { '1': '1d6' }, modifier: 'MOVE', type: ['normal'] } };

describe('poke5e moveStat', () => {
  it('save move: DC = 8 + PB + best ability mod, level-scaled dice', () => {
    const s = moveStat(flamethrower, pk);
    expect(s.casting).toBe('save');
    expect(s.saveAbility).toBe('DEX');
    expect(s.saveDc).toBe(14); // 8 + PB(3) + DEXmod(3)
    expect(s.damageDice).toBe('2d10 + 3'); // level 5 -> 2d10, MOVE -> +3
    expect(s.damageType).toBe('fire');
  });
  it('attack move: to-hit = PB + best ability mod', () => {
    const s = moveStat(tackle, pk);
    expect(s.casting).toBe('attack');
    expect(s.attackBonus).toBe(6); // PB(3) + 3
    expect(s.damageDice).toBe('1d6 + 3');
  });
  it('OHKO move (Sheer Cold): prose "roll a d20" surfaces a d20 roll, no to-hit/damage', () => {
    const sheerCold = { id: 'sheer-cold', name: 'Sheer Cold', type: 'ice', power: 'none',
      description: ['Choose a target in range and roll a d20. On a 20, the target faints.'] };
    const s = moveStat(sheerCold, pk);
    expect(s.casting).toBe('utility');
    expect(s.rollDie).toBe('1d20');
    expect(s.damageDice).toBeUndefined();
    expect(s.attackBonus).toBeUndefined();
  });
  it('Metronome → d100, Acupressure → d6 from prose', () => {
    expect(moveStat({ id: 'metronome', name: 'Metronome', type: 'normal', power: 'varies', description: ['roll a d100. The resulting number is the TM number'] }, pk).rollDie).toBe('1d100');
    expect(moveStat({ id: 'acupressure', name: 'Acupressure', type: 'normal', power: 'none', description: ['roll a d6 and gain the following boost'] }, pk).rollDie).toBe('1d6');
  });
  it('auto-hit damage move (Swift): damage, no attack/save → autoHit, still rolls damage', () => {
    const swift = { id: 'swift', name: 'Swift', type: 'normal', power: ['dex'],
      damage: { dice: { '1': '1d4' }, modifier: 'MOVE', type: ['normal'] },
      description: ['Each hit for 1d4 normal damage. This move is guaranteed to hit.'] };
    const s = moveStat(swift, pk);
    expect(s.casting).toBe('utility');
    expect(s.autoHit).toBe(true);
    expect(s.damageDice).toBe('1d4 + 3'); // still has a damage roll
    expect(s.rollDie).toBeUndefined(); // not a bare-die move
  });
  it('charge / recharge moves get a reminder from their time field', () => {
    const solar = { id: 'solar-beam', name: 'Solar Beam', type: 'grass', power: ['wis'], time: '1 action, charge', description: ['charge up'] };
    const hyper = { id: 'hyper-beam', name: 'Hyper Beam', type: 'normal', power: ['str'], time: '1 action, recharge', damage: { dice: { '1': '3d8' }, modifier: 'MOVE', type: ['normal'] }, save: { attribute: ['dex'], dc: 'MOVE' } };
    expect(moveStat(solar, pk).note).toMatch(/charges now/i);
    expect(moveStat(hyper, pk).note).toMatch(/recharge/i);
    expect(moveStat({ id: 'tackle2', name: 'Tackle', type: 'normal', power: ['str'], time: '1 action', attack: { scope: 'melee' } }, pk).note).toBeUndefined();
  });
  it('status conditions produce move mods: poison/flinch disadvantage on attacks, burn damage note', () => {
    const atk = statusMoveMods('attack', true, false);
    expect(atk.find((m) => /poison/i.test(m.ability))).toMatchObject({ cond: { status: 'poison' }, attackDisadvantage: true });
    expect(atk.find((m) => /flinch/i.test(m.ability))).toMatchObject({ cond: { status: 'flinch' }, attackDisadvantage: true });
    expect(atk.find((m) => /burn/i.test(m.ability))).toMatchObject({ cond: { status: 'burn' }, note: expect.stringMatching(/lower/i) });
  });
  it('Guts negates the burn/poison move penalties (flinch still applies)', () => {
    const atk = statusMoveMods('attack', true, /*hasGuts*/ true);
    expect(atk.find((m) => /poison/i.test(m.ability))).toBeUndefined();
    expect(atk.find((m) => /burn/i.test(m.ability))).toBeUndefined();
    expect(atk.find((m) => /flinch/i.test(m.ability))).toBeDefined(); // flinch is not negated by Guts
  });
  it('a non-attack, non-damage move gets no status mods', () => {
    expect(statusMoveMods('utility', false, false)).toEqual([]);
  });
  it('a plain no-roll utility move stays a no-dice announcement', () => {
    const harden = { id: 'harden', name: 'Harden', type: 'normal', power: 'none', description: ['You tense your body, raising your AC by 1 until the end of your next turn.'] };
    const s = moveStat(harden, pk);
    expect(s.rollDie).toBeUndefined();
    expect(s.autoHit).toBeUndefined();
    expect(s.damageDice).toBeUndefined();
  });
});

describe('poke5e pokemonToCharacter', () => {
  const moves = { flamethrower, tackle };
  const moveset = [{ move_id: 'flamethrower', pp_cur: 10, pp_max: 10 }, { move_id: 'tackle', pp_cur: 20, pp_max: 20 }];
  const { model, hp, spellcasting } = pokemonToCharacter(pk, moveset, moves);
  it('builds a roll model with saves/skills and HP', () => {
    expect(model.name).toBe('Blaze');
    expect(model.profBonus).toBe(3);
    expect(model.saves.DEX).toEqual({ mod: 6, proficient: true });
    expect(hp).toEqual({ current: 22, max: 30, temp: 0, removed: 8 });
  });
  it('exposes moves as rollable spells', () => {
    expect(spellcasting.spells.map((s: any) => s.name)).toEqual(['Flamethrower', 'Tackle']);
    expect(spellcasting.spells[1]).toMatchObject({ casting: 'attack', attackBonus: 6, damageDice: '1d6 + 3' });
  });
});
