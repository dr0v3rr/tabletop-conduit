import { describe, it, expect } from 'vitest';
import { ddbMonsterToCharacter } from '../src/monster/ddb';

describe('ddbMonsterToCharacter', () => {
  const goblin = {
    name: 'Goblin', challengeRatingId: 3, armorClass: 15, averageHitPoints: 7,
    stats: [{ statId: 1, value: 8 }, { statId: 2, value: 14 }, { statId: 3, value: 10 }, { statId: 4, value: 10 }, { statId: 5, value: 8 }, { statId: 6, value: 8 }],
    savingThrows: [], skillsHtml: 'Stealth + 6',
    actionsDescription: '<p><strong>Scimitar.</strong> Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.</p><p><strong>Shortbow.</strong> Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.</p>',
  };
  const { model, hp, weapons, ac } = ddbMonsterToCharacter(goblin);
  it('maps abilities, AC, HP, prof (CR 1/4 -> +2)', () => {
    expect(model.abilities.DEX).toEqual({ score: 14, mod: 2 });
    expect(model.profBonus).toBe(2);
    expect(ac).toBe(15);
    expect(hp).toEqual({ current: 7, max: 7, temp: 0, removed: 0 });
    expect(model.initiative).toBe(2);
  });
  it('parses skillsHtml', () => {
    expect(model.skills.stealth).toMatchObject({ mod: 6, proficient: true });
  });
  it('parses attacks from actionsDescription HTML', () => {
    expect(weapons.map((w) => w.name)).toEqual(['Scimitar', 'Shortbow']);
    expect(weapons[0]).toMatchObject({ attackMod: 4, damageDice: '1d6', damageMod: 2, damageType: 'slashing' });
    expect(weapons[1]).toMatchObject({ attackMod: 4, damageDice: '1d6', damageMod: 2, damageType: 'piercing' });
  });

  it('parses an attack whose Hit clause has no parenthesized average', () => {
    const { weapons } = ddbMonsterToCharacter({
      ...goblin,
      actionsDescription: '<p><strong>Claw.</strong> Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 1d8 + 4 slashing damage.</p><p><strong>Spit.</strong> Ranged Weapon Attack: +5 to hit, range 30 ft. Hit: 1d6 acid damage.</p>',
    });
    expect(weapons.map((w) => w.name)).toEqual(['Claw', 'Spit']);
    expect(weapons[0]).toMatchObject({ damageDice: '1d8', damageMod: 4, damageType: 'slashing' });
    expect(weapons[1]).toMatchObject({ damageDice: '1d6', damageMod: 0, damageType: 'acid' });
  });

  it('a flat-only attack before a dice attack does not steal the later attack\'s dice', () => {
    const { weapons } = ddbMonsterToCharacter({
      ...goblin,
      // Slam deals flat-only damage (no dice); Claw follows with dice. Slam must NOT grab Claw's dice.
      actionsDescription: '<p><strong>Slam.</strong> Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 4 bludgeoning damage.</p><p><strong>Claw.</strong> Melee Weapon Attack: +6 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.</p>',
    });
    // Slam has no dice → dropped; Claw is emitted correctly with its own dice.
    expect(weapons.map((w) => w.name)).toEqual(['Claw']);
    expect(weapons[0]).toMatchObject({ damageDice: '1d6', damageMod: 2, damageType: 'slashing' });
  });

  it('parses a save-based action (breath weapon) alongside attacks', () => {
    const { weapons } = ddbMonsterToCharacter({
      ...goblin,
      actionsDescription: '<p><strong>Bite.</strong> Melee Weapon Attack: +6 to hit, reach 5 ft. Hit: 7 (1d10 + 2) piercing damage.</p><p><strong>Fire Breath (Recharge 5-6).</strong> The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much on a success.</p>',
    });
    const bite = weapons.find((w) => w.name === 'Bite');
    const breath = weapons.find((w) => w.name.startsWith('Fire Breath'));
    expect(bite).toMatchObject({ attackMod: 6, damageDice: '1d10', damageMod: 2 });
    expect(breath).toBeTruthy();
    expect(breath).toMatchObject({ damageDice: '7d6', damageType: 'fire', save: { dc: 13, ability: 'DEX' } });
    expect(breath!.attackMod).toBe(0); // no to-hit
  });
});
