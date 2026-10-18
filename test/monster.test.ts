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

describe('monsterToCharacter (Open5e) — save-based actions (breath weapons)', () => {
  const dragon = {
    name: 'Young Red Dragon', armor_class: 18, hit_points: 178, hit_dice: '17d10',
    strength: 23, dexterity: 10, constitution: 21, intelligence: 14, wisdom: 11, charisma: 19,
    speed: { walk: 40, fly: 80 },
    actions: [
      { name: 'Bite', desc: 'Melee Weapon Attack: 15 (2d10 + 4) piercing damage plus 3 (1d6) fire damage.', attack_bonus: 10, damage_dice: '2d10', damage_bonus: 6 },
      // Save-based damage action, dice only in the prose (no damage_dice field):
      { name: 'Fire Breath', desc: 'The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one.' },
      // Save-based but NO damage dice → not a rollable weapon:
      { name: 'Frightful Presence', desc: 'Each creature of the dragon’s choice must succeed on a DC 16 Wisdom saving throw or become frightened for 1 minute.' },
      // Save with a DURATION die (not damage) → must NOT become a bogus weapon:
      { name: 'Tail Sweep', desc: 'Each creature must make a DC 15 Dexterity saving throw or be knocked prone and stunned for 1d4 rounds.' },
    ],
  };
  const { weapons } = monsterToCharacter(dragon);

  it('parses a breath weapon into a save-based weapon (no to-hit)', () => {
    const breath = weapons.find((w) => w.name === 'Fire Breath');
    expect(breath).toBeTruthy();
    expect(breath).toMatchObject({ attackMod: 0, damageDice: '16d6', damageType: 'fire', proficient: false, save: { dc: 17, ability: 'DEX' } });
  });
  it('still parses ordinary attacks, and skips a save action with no damage dice', () => {
    expect(weapons.map((w) => w.name).sort()).toEqual(['Bite', 'Fire Breath']);
    const bite = weapons.find((w) => w.name === 'Bite');
    expect(bite).toMatchObject({ attackMod: 10, damageDice: '2d10', proficient: true });
    expect(bite?.save).toBeUndefined(); // an ordinary attack carries no save
  });
});
