/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import type { CharacterData, RollModel } from '../src/engine';
import { computeWeapons } from '../src/engine/weapons';
import type { Weapon } from '../src/engine/weapons';
import fixture from './fixtures/aldric-144074405.json';
import fixtureL11 from './fixtures/aldric-160931906.json';

const data = (fixture as { data: CharacterData }).data;
const model: RollModel = computeRollModel(data);
const weapons = computeWeapons(data, model);

const byName = (n: string): Weapon | undefined =>
  weapons.find((w) => w.name.toLowerCase() === n.toLowerCase());

// Well-formed dice: '1d8', '2d8', '1d10', or the flat unarmed '1'.
const DICE_RE = /^(\d+d\d+|\d+)$/;

describe('computeWeapons — Aldric (Artificer 8, Vedalken)', () => {
  it('prints the full parsed weapon list', () => {
    console.log('\n=== Aldric parsed weapons (STR -1, DEX +2, INT +4, prof +3) ===');
    for (const w of weapons) {
      const magic = w.magicBonus ? ` magic+${w.magicBonus}` : '';
      const vers = w.versatileDamage ? ` versatile(${w.versatileDamage})` : '';
      const dmgMod = w.damageMod >= 0 ? `+${w.damageMod}` : `${w.damageMod}`;
      const atk = w.attackMod >= 0 ? `+${w.attackMod}` : `${w.attackMod}`;
      console.log(
        `[${w.source}] ${w.name}: to-hit ${atk} (${w.attackAbility}), ` +
          `dmg ${w.damageDice}${dmgMod} ${w.damageType}${vers}, ` +
          `prof=${w.proficient}${magic}, range=${w.range ?? '-'}, ` +
          `props=[${w.properties.join(', ')}]`,
      );
    }
    expect(weapons.length).toBeGreaterThan(0);
  });

  it('every weapon is well-formed (dice + numeric mods)', () => {
    for (const w of weapons) {
      expect(w.damageDice, `${w.name} damageDice`).toMatch(DICE_RE);
      expect(Number.isFinite(w.attackMod), `${w.name} attackMod`).toBe(true);
      expect(Number.isFinite(w.damageMod), `${w.name} damageMod`).toBe(true);
      expect(Number.isInteger(w.attackMod)).toBe(true);
      expect(Number.isInteger(w.damageMod)).toBe(true);
      expect(typeof w.damageType).toBe('string');
      expect(Array.isArray(w.properties)).toBe(true);
    }
  });

  it('includes a synthetic Unarmed Strike (1 + STR mod, bludgeoning)', () => {
    const unarmed = byName('Unarmed Strike');
    expect(unarmed).toBeDefined();
    expect(unarmed!.source).toBe('unarmed');
    expect(unarmed!.attackAbility).toBe('STR');
    expect(unarmed!.damageDice).toBe('1');
    expect(unarmed!.damageMod).toBe(model.abilities.STR.mod); // -1
    expect(unarmed!.damageType).toBe('Bludgeoning');
    // proficient with unarmed => STR(-1) + prof(+3) = +2
    expect(unarmed!.attackMod).toBe(model.abilities.STR.mod + model.profBonus);
    expect(unarmed!.attackMod).toBe(2);
  });

  it('ranged weapon (Light Crossbow) uses DEX and is proficient (simple-weapons)', () => {
    // Aldric owns no firearm, but the Light Crossbow exercises the same ranged->DEX +prof path.
    const xbow = byName('Crossbow, Light');
    expect(xbow).toBeDefined();
    expect(xbow!.attackAbility).toBe('DEX');
    expect(xbow!.proficient).toBe(true);
    // DEX(+2) + prof(+3) + magic(0) = +5
    expect(xbow!.attackMod).toBe(
      model.abilities.DEX.mod + model.profBonus + xbow!.magicBonus,
    );
    expect(xbow!.attackMod).toBe(5);
    expect(xbow!.damageDice).toBe('1d8');
    expect(xbow!.damageMod).toBe(2); // DEX +2
    expect(xbow!.damageType).toBe('Piercing');
    expect(xbow!.range).toBe('80/320 ft');
  });

  it('Dagger uses Finesse (DEX > STR) and is proficient', () => {
    const dagger = byName('Dagger');
    expect(dagger).toBeDefined();
    expect(dagger!.properties).toEqual(
      expect.arrayContaining(['Finesse', 'Light', 'Thrown']),
    );
    // Finesse -> DEX (+2) since DEX mod (2) > STR mod (-1); +prof(3) = +5
    expect(dagger!.attackAbility).toBe('DEX');
    expect(dagger!.proficient).toBe(true);
    expect(dagger!.attackMod).toBe(5);
    expect(dagger!.damageDice).toBe('1d4');
    expect(dagger!.damageMod).toBe(2);
    expect(dagger!.damageType).toBe('Piercing');
  });

  it('Quarterstaff is STR melee, proficient, with versatile 1d8', () => {
    const qs = byName('Quarterstaff');
    expect(qs).toBeDefined();
    expect(qs!.attackAbility).toBe('STR');
    expect(qs!.proficient).toBe(true);
    // STR(-1) + prof(3) = +2
    expect(qs!.attackMod).toBe(2);
    expect(qs!.damageDice).toBe('1d6');
    expect(qs!.damageMod).toBe(-1);
    // Versatile two-handed dice read from the Versatile property's `notes`.
    expect(qs!.versatileDamage).toBe('1d8');
  });

  it('Longsword (martial) is NOT proficient — Aldric lacks martial-weapons', () => {
    const ls = byName('Longsword');
    expect(ls).toBeDefined();
    expect(ls!.proficient).toBe(false);
    expect(ls!.attackAbility).toBe('STR');
    // STR(-1) + prof(0, not proficient) = -1
    expect(ls!.attackMod).toBe(-1);
    expect(ls!.damageDice).toBe('1d8');
    expect(ls!.damageType).toBe('Slashing');
    expect(ls!.versatileDamage).toBe('1d10');
  });

  it('Ammunition (Crossbow Bolts) is excluded — no damage dice', () => {
    expect(byName('Crossbow Bolts, +2')).toBeUndefined();
  });

  it('custom attack-roll action (Force Ballista) is INT-based and proficient', () => {
    const fb = byName('Eldritch Cannon: Force Ballista');
    expect(fb).toBeDefined();
    expect(fb!.source).toBe('action');
    expect(fb!.attackAbility).toBe('INT');
    expect(fb!.proficient).toBe(true);
    // INT(+4) + prof(3) = +7
    expect(fb!.attackMod).toBe(7);
    expect(fb!.damageDice).toBe('2d8');
    expect(fb!.damageType).toBe('Force');
  });

  it('save-based action (Flamethrower, no to-hit) is NOT treated as a weapon', () => {
    expect(byName('Eldritch Cannon: Flamethrower')).toBeUndefined();
  });
});

// ---- Regression: L11 fixture, support-action exclusion (Bug 1) ----

describe('computeWeapons — Aldric L11 (Artificer 11) support-action guard', () => {
  const dataL11 = (fixtureL11 as { data: CharacterData }).data;
  const modelL11: RollModel = computeRollModel(dataL11);
  const weaponsL11 = computeWeapons(dataL11, modelL11);
  const byNameL11 = (n: string): Weapon | undefined =>
    weaponsL11.find((w) => w.name.toLowerCase() === n.toLowerCase());

  it('damage-dealing Force Ballista (damageTypeId 13) IS emitted', () => {
    const fb = byNameL11('Eldritch Cannon: Force Ballista');
    expect(fb).toBeDefined();
    expect(fb!.source).toBe('action');
    expect(fb!.damageType).toBe('Force');
    expect(fb!.attackAbility).toBe('INT');
    expect(fb!.proficient).toBe(true);
  });

  it('non-damaging Protector (damageTypeId null, grants Temp HP) is NOT emitted as a fake attack', () => {
    expect(byNameL11('Eldritch Cannon: Protector')).toBeUndefined();
  });
});

// ---- Regression: synthetic minimal-model unit tests (Bugs 2, 3, 4) ----

/** Minimal RollModel exercising only the fields computeWeapons reads. */
function makeModel(mods: Partial<Record<'STR' | 'DEX' | 'INT', number>>, profBonus = 3): RollModel {
  const ab = (mod: number) => ({ score: 10 + mod * 2, mod });
  return {
    abilities: {
      STR: ab(mods.STR ?? 0),
      DEX: ab(mods.DEX ?? 0),
      CON: ab(0),
      INT: ab(mods.INT ?? 0),
      WIS: ab(0),
      CHA: ab(0),
    },
    profBonus,
  } as unknown as RollModel;
}

describe('computeWeapons — synthetic regressions', () => {
  it('Bug 2: an action with fixedToHit returns that exact to-hit (override, not additive)', () => {
    const synth = {
      actions: {
        class: [
          {
            name: 'Fixed To-Hit Action',
            attackTypeRange: 2,
            damageTypeId: 13,
            isProficient: true, // would add +prof if double-counted
            abilityModifierStatId: 4, // INT
            fixedToHit: 9,
            dice: { diceString: '2d8' },
            range: { range: 120 },
          },
        ],
      },
    } as unknown as CharacterData;
    // INT +4, prof +3 would give +7 if computed; fixedToHit must override to exactly 9.
    const w = computeWeapons(synth, makeModel({ INT: 4 })).find(
      (x) => x.name === 'Fixed To-Hit Action',
    );
    expect(w).toBeDefined();
    expect(w!.attackMod).toBe(9);
  });

  it('Bug 3: a weapon with both grantedModifiers[magic:1] and def.bonus:1 yields magic +1 (not +2)', () => {
    const synth = {
      inventory: [
        {
          definition: {
            name: 'Doubly-Enchanted Sword',
            filterType: 'Weapon',
            attackType: 1,
            categoryId: 1, // simple-weapons
            damage: { diceString: '1d8' },
            damageType: 'Slashing',
            properties: [],
            bonus: 1,
            grantedModifiers: [{ type: 'bonus', subType: 'magic', value: 1 }],
          },
        },
      ],
      modifiers: { class: [{ type: 'proficiency', subType: 'simple-weapons' }] },
    } as unknown as CharacterData;
    const w = computeWeapons(synth, makeModel({ STR: 0 })).find(
      (x) => x.name === 'Doubly-Enchanted Sword',
    );
    expect(w).toBeDefined();
    expect(w!.magicBonus).toBe(1);
    // magic +1 lands once on both to-hit and damage: STR(0)+prof(3)+magic(1)=4
    expect(w!.attackMod).toBe(4);
    expect(w!.damageMod).toBe(1);
  });

  it('Bug 4: a comma-inverted "Crossbow, Light" with light-crossbow proficiency reads proficient', () => {
    const synth = {
      inventory: [
        {
          definition: {
            name: 'Crossbow, Light',
            filterType: 'Weapon',
            attackType: 2,
            categoryId: 99, // not a recognized category -> only specific-name prof can hit
            damage: { diceString: '1d8' },
            damageType: 'Piercing',
            properties: [{ name: 'Ammunition' }],
            range: 80,
            longRange: 320,
          },
        },
      ],
      modifiers: { class: [{ type: 'proficiency', subType: 'light-crossbow' }] },
    } as unknown as CharacterData;
    const w = computeWeapons(synth, makeModel({ DEX: 2 })).find(
      (x) => x.name === 'Crossbow, Light',
    );
    expect(w).toBeDefined();
    expect(w!.proficient).toBe(true);
    expect(w!.attackAbility).toBe('DEX');
  });
});
