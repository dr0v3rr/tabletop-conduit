import { describe, it, expect } from 'vitest';
import { monsterToCharacter } from '../src/monster/source';

describe('monsterToCharacter (Open5e)', () => {
  const goblin = {
    name: 'Goblin', armor_class: 15, hit_points: 7, hit_dice: '2d6',
    strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8,
    dexterity_save: 4, skills: { stealth: 6 }, speed: { walk: 30 },
    actions: [
      { name: 'Scimitar', desc: 'Melee Weapon Attack: slashing damage.', attack_bonus: 4, damage_dice: '1d6', damage_bonus: 2 },
      { name: 'Multiattack', desc: 'The goblin makes two attacks.' }, // no attack_bonus → skipped
    ],
  };
  const { model, hp, weapons } = monsterToCharacter(goblin);
  it('maps abilities + initiative', () => {
    expect(model.abilities.DEX).toEqual({ score: 14, mod: 2 });
    expect(model.initiative).toBe(2);
  });
  it('uses listed saves/skills as proficient, others as ability mod', () => {
    expect(model.saves.DEX).toEqual({ mod: 4, proficient: true });
    expect(model.saves.STR).toEqual({ mod: -1, proficient: false });
    expect(model.skills.stealth).toMatchObject({ mod: 6, proficient: true });
    expect(model.skills.perception.proficient).toBe(false);
  });
  it('turns attack actions into rollable weapons, skips non-attacks', () => {
    expect(weapons).toHaveLength(1);
    expect(weapons[0]).toMatchObject({ name: 'Scimitar', attackMod: 4, damageDice: '1d6', damageMod: 2, damageType: 'slashing' });
  });
  it('HP is a local full pool', () => {
    expect(hp).toEqual({ current: 7, max: 7, temp: 0, removed: 0 });
  });
});
