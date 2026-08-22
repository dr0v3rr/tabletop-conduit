import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import type { CharacterData, RollModel } from '../src/engine';
import type { RollRequest } from '../src/shared/roll-types';
import { composeRoll, buildRoll20Command } from '../src/compose';
import type { AttackExtras } from '../src/compose';
import fixture from './fixtures/aldric-144074405.json';

const data = (fixture as { data: CharacterData }).data;
const model: RollModel = computeRollModel(data);

// Count occurrences of `1d20` (each d20 column has exactly one, unless super-*).
const countD20 = (s: string) => (s.match(/\b1d20/g) ?? []).length;

describe('composeRoll — Roll20 command output (Aldric)', () => {
  it('Perception (skill, +5) normal -> single d20 and `+ 5`', () => {
    const req: RollRequest = { kind: 'skill', key: 'perception' };
    const cmd = buildRoll20Command(model, req);
    expect(cmd).toContain('&{template:simple}');
    expect(cmd).toContain('{{rname=Perception}}');
    expect(cmd).toContain('+ 5'); // inline d20 modifier
    expect(cmd).toContain('{{normal=1}}');
    expect(countD20(cmd)).toBe(1); // single d20 column
    expect(cmd).not.toContain('{{r2=');
  });

  it('Perception advantage -> two d20 columns + advantage flag', () => {
    const req: RollRequest = { kind: 'skill', key: 'perception', advantage: 'advantage' };
    const cmd = buildRoll20Command(model, req);
    expect(cmd).toContain('{{r1=');
    expect(cmd).toContain('{{r2=');
    expect(cmd).toContain('{{advantage=1}}');
    expect(countD20(cmd)).toBe(2);
  });

  it('Sharpshooter attack -> to-hit reduced by 5, +10 damage', () => {
    const req: RollRequest & AttackExtras = {
      kind: 'attack',
      key: 'Longbow',
      baseDamage: '1d8',
      damageType: 'Piercing',
      effects: [
        { op: 'flat', target: 'attack', value: -5, label: 'Sharpshooter' },
        { op: 'flat', target: 'damage', value: 10, label: 'Sharpshooter' },
      ],
    };
    const composed = composeRoll(model, req);
    expect(composed.template).toBe('atkdmg');
    // base attack mod is 0, Sharpshooter -5 => to-hit shows `- 5`
    expect(composed.d20Mod).toBe(-5);
    expect(composed.command).toContain('- 5');
    // damage term includes the +10 and the base weapon die
    expect(composed.command).toContain('1d8');
    expect(composed.command).toContain('+ 10');
    expect(composed.command).toMatch(/\{\{dmg1=\[\[1d8 \+ 10\]\]\}\}/);
  });

  it('Bless (add-dice attack 1d4) -> attack term includes 1d4', () => {
    const req: RollRequest & AttackExtras = {
      kind: 'attack',
      key: 'Longsword',
      baseDamage: '1d8',
      effects: [{ op: 'add-dice', target: 'attack', dice: '1d4', label: 'Bless' }],
    };
    const cmd = buildRoll20Command(model, req);
    // 1d4 folded into the d20 roll, not the damage term
    expect(cmd).toMatch(/\{\{r1=\[\[1d20cs>20 \+ 1d4\]\]\}\}/);
  });

  it('crit-range effect -> d20 shows cs> below 20', () => {
    const req: RollRequest = {
      kind: 'attack',
      key: 'Rapier',
      effects: [{ op: 'crit-range', target: 'attack', range: 19, label: 'Improved Critical' }],
    };
    const cmd = buildRoll20Command(model, req);
    const m = cmd.match(/cs>(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThan(20);
    expect(cmd).toContain('cs>19');
  });

  it('elven-accuracy advantage effect -> super-advantage r2 uses 2d20kh1', () => {
    const req: RollRequest = {
      kind: 'attack',
      key: 'Shortsword',
      advantage: 'advantage',
      effects: [{ op: 'advantage', target: 'attack', mode: 'elven-accuracy' }],
    };
    const composed = composeRoll(model, req);
    expect(composed.advantage).toBe('super-advantage');
    expect(composed.command).toContain('2d20kh1');
    expect(composed.command).toContain('{{advantage=1}}');
  });

  it('whisper -> command starts with /w gm', () => {
    const req: RollRequest = { kind: 'skill', key: 'perception', whisper: true };
    const cmd = buildRoll20Command(model, req);
    expect(cmd.startsWith('/w gm')).toBe(true);
  });

  it('save resolves the ability save modifier (INT save = +7)', () => {
    const cmd = buildRoll20Command(model, { kind: 'save', key: 'INT' });
    expect(cmd).toContain('{{rname=INT Save}}');
    expect(cmd).toContain('+ 7');
  });

  it('initiative uses a single tracker die', () => {
    const cmd = buildRoll20Command(model, { kind: 'initiative' });
    expect(cmd).toContain('&{tracker}');
    expect(cmd).toContain('{{rname=Initiative}}');
    expect(cmd).toContain('+ 2');
  });
});

describe('composeRoll — confirmed-bug regressions', () => {
  it('attack-only advantage does NOT leak onto a save (Bug 1)', () => {
    const req: RollRequest = {
      kind: 'save',
      key: 'INT',
      effects: [{ op: 'advantage', target: 'attack', mode: 'advantage' }],
    };
    const composed = composeRoll(model, req);
    expect(composed.advantage).toBe('normal');
    expect(countD20(composed.command)).toBe(1); // stays a single d20 column
    expect(composed.command).not.toContain('{{r2=');
    expect(composed.command).toContain('{{normal=1}}');
  });

  it('save-target advantage still applies to a save (control for Bug 1)', () => {
    const composed = composeRoll(model, {
      kind: 'save',
      key: 'INT',
      effects: [{ op: 'advantage', target: 'save', mode: 'advantage' }],
    });
    expect(composed.advantage).toBe('advantage');
    expect(countD20(composed.command)).toBe(2);
  });

  it('default-mode attack crit doubles the damage dice via {{Crit}} (Bug 3a)', () => {
    const base: RollRequest & AttackExtras = {
      kind: 'attack',
      key: 'Greatsword',
      templateStyle: 'default',
      baseAttackMod: 5,
      baseDamage: '2d6',
    };
    const crit = buildRoll20Command(model, { ...base, crit: true });
    expect(crit).toContain('&{template:default}');
    expect(crit).toContain('{{Damage=[[2d6]]}}');
    expect(crit).toContain('{{Crit=[[2d6]]}}'); // dice rolled a second time

    const noCrit = buildRoll20Command(model, { ...base, crit: false });
    expect(noCrit).not.toContain('{{Crit=');
  });

  it('default-mode damage honors GWF reroll and min-die on the base dice (Bug 3b)', () => {
    const reroll: RollRequest & AttackExtras = {
      kind: 'attack',
      key: 'Maul',
      templateStyle: 'default',
      baseAttackMod: 4,
      baseDamage: '2d6',
      effects: [{ op: 'reroll', target: 'damage', threshold: 2, label: 'GWF' }],
    };
    expect(buildRoll20Command(model, reroll)).toContain('{{Damage=[[2d6ro<=2]]}}');

    const min: RollRequest & AttackExtras = {
      kind: 'attack',
      key: 'Maul',
      templateStyle: 'default',
      baseAttackMod: 4,
      baseDamage: '2d6',
      effects: [{ op: 'min-die', target: 'damage', min: 3, label: 'GWF' }],
    };
    expect(buildRoll20Command(model, min)).toContain('{{Damage=[[2d6min3]]}}');
  });

  it('default standalone damage honors reroll and crit-doubling (Bug 3b)', () => {
    const req: RollRequest & AttackExtras = {
      kind: 'damage',
      key: 'Sneak',
      templateStyle: 'default',
      baseDamage: '3d6',
      crit: true,
      effects: [{ op: 'reroll', target: 'damage', threshold: 2 }],
    };
    const cmd = buildRoll20Command(model, req);
    expect(cmd).toContain('3d6ro<=2 + 3d6ro<=2');
  });

  it('a d20-target reroll (Halfling Lucky) applies to a skill roll (Bug 4)', () => {
    const withLucky = buildRoll20Command(model, {
      kind: 'skill',
      key: 'perception',
      effects: [{ op: 'reroll', target: 'd20', threshold: 1, label: 'Lucky' }],
    });
    expect(withLucky).toContain('ro<=1');

    // an attack-only reroll must NOT reach a skill roll
    const attackOnly = buildRoll20Command(model, {
      kind: 'skill',
      key: 'perception',
      effects: [{ op: 'reroll', target: 'attack', threshold: 1 }],
    });
    expect(attackOnly).not.toContain('ro<=');
  });

  it('a d20-target flat (Exhaustion 2024) lands on both attacks and saves (Bug 5)', () => {
    const atk = composeRoll(model, {
      kind: 'attack',
      key: 'Sword',
      baseAttackMod: 5,
      effects: [{ op: 'flat', target: 'd20', value: -2, label: 'Exhaustion (2024)' }],
    } as RollRequest & AttackExtras);
    expect(atk.d20Mod).toBe(3); // 5 - 2

    const sav = composeRoll(model, {
      kind: 'save',
      key: 'INT',
      effects: [{ op: 'flat', target: 'd20', value: -2, label: 'Exhaustion (2024)' }],
    });
    expect(sav.d20Mod).toBe(5); // INT save +7 - 2
  });

  it('default-mode attack shows an expanded crit range as cs>N (Bug 8)', () => {
    const cmd = buildRoll20Command(model, {
      kind: 'attack',
      key: 'Rapier',
      templateStyle: 'default',
      baseAttackMod: 5,
      effects: [{ op: 'crit-range', target: 'attack', range: 18, label: 'Superior Critical' }],
    } as RollRequest & AttackExtras);
    expect(cmd).toContain('cs>18');
  });

  // Regression for H1: a weapon's flat damage mod is baked into baseDamage ("2d6 + 3") by the
  // producers (weaponToRequest / the renderer's weaponReq). It must NOT be doubled on a crit, and
  // GWF reroll/min-die must attach to the dice, not the flat mod.
  describe('baked damage modifier (crit + GWF)', () => {
    it('crit doubles only the dice, not the flat modifier', () => {
      const r = composeRoll(model, {
        kind: 'attack', key: 'Greatsword', templateStyle: 'sheet',
        baseAttackMod: 5, baseDamage: '2d6 + 3', damageType: 'slashing', crit: true,
      } as RollRequest & AttackExtras);
      // damage card shows dice + flat once; crit re-rolls the dice ONLY (no second +3).
      expect(r.command).toContain('{{dmg1=[[2d6 + 3]]}}');
      expect(r.command).toContain('{{crit1=[[2d6]]}}');
      expect(r.command).not.toContain('crit1=[[2d6 + 3]]');
    });
    it('Great Weapon Fighting reroll attaches to the dice, not the +3', () => {
      const r = composeRoll(model, {
        kind: 'attack', key: 'Greatsword', templateStyle: 'sheet',
        baseAttackMod: 5, baseDamage: '2d6 + 3', damageType: 'slashing',
        effects: [{ op: 'reroll', target: 'damage', threshold: 2, label: 'GWF' }],
      } as RollRequest & AttackExtras);
      expect(r.command).toContain('2d6ro<=2');       // reroll on the dice
      expect(r.command).not.toContain('3ro<=2');      // NOT on the flat modifier
      expect(r.command).toContain('+ 3');             // flat still added once
    });
    it('default-style crit also doubles dice only', () => {
      const cmd = buildRoll20Command(model, {
        kind: 'attack', key: 'Greatsword', templateStyle: 'default',
        baseAttackMod: 5, baseDamage: '2d6 + 3', crit: true,
      } as RollRequest & AttackExtras);
      expect(cmd).toContain('{{Damage=[[2d6 + 3]]}}');
      expect(cmd).toContain('{{Crit=[[2d6]]}}');
    });
  });
});
