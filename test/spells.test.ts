import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import type { Ability, CharacterData, RollModel } from '../src/engine';
import { computeSpells } from '../src/engine/spells';
import type { Spell } from '../src/engine/spells';
import { computeSpellSlots } from '../src/engine/spell-slots';
import type { SlotLevel } from '../src/engine/spell-slots';
import fixture from './fixtures/aldric-144074405.json';
import fixture160 from './fixtures/aldric-160931906.json';
import fixture11 from './fixtures/aldric-160931906.json';

const data = (fixture as { data: CharacterData }).data;
const model: RollModel = computeRollModel(data);
const info = computeSpells(data, model);

// Print the parsed spell list so exact values are visible in test output.
console.log('\n=== Aldric spellcasting classes ===');
console.log(JSON.stringify(info.classes, null, 2));
console.log('\n=== Aldric parsed spells ===');
for (const s of info.spells) {
  console.log(
    `${s.name} (L${s.level}${s.isCantrip ? ', cantrip' : ''}) casting=${s.casting}` +
      (s.attackBonus !== undefined ? ` atk=+${s.attackBonus}` : '') +
      (s.saveAbility !== undefined ? ` save=${s.saveAbility} DC${s.saveDc}` : '') +
      (s.damageDice !== undefined ? ` dmg=${s.damageDice} ${s.damageType ?? ''}` : '') +
      (s.scalesWithLevel ? ' [scales]' : ''),
  );
}

const find = (name: string): Spell | undefined =>
  info.spells.find((s) => s.name.toLowerCase() === name.toLowerCase());

describe('computeSpells — Aldric (Artificer 8)', () => {
  it('exposes an Artificer spellcasting class: INT, +7 attack, DC 15', () => {
    const art = info.classes.find((c) => c.className === 'Artificer');
    expect(art).toBeDefined();
    expect(art!.ability).toBe('INT');
    expect(art!.attackBonus).toBe(7);
    expect(art!.saveDc).toBe(15);
  });

  it('produces a non-empty spell list', () => {
    expect(info.spells.length).toBeGreaterThan(0);
  });

  it('Fire Bolt: attack cantrip, 2d10 Fire at character level 8', () => {
    const fb = find('Fire Bolt');
    expect(fb).toBeDefined();
    expect(fb!.casting).toBe('attack');
    expect(fb!.isCantrip).toBe(true);
    expect(fb!.level).toBe(0);
    expect(fb!.damageDice).toBe('2d10');
    expect(fb!.damageType).toBe('Fire');
    expect(fb!.attackBonus).toBe(7);
  });

  it('attack spells carry an attack bonus and no save fields', () => {
    for (const s of info.spells.filter((x) => x.casting === 'attack')) {
      expect(s.attackBonus).toBe(7);
      expect(s.saveAbility).toBeUndefined();
    }
  });

  it('a save spell (Heat Metal) is casting=save with a saveAbility and DC 15', () => {
    const hm = find('Heat Metal');
    expect(hm).toBeDefined();
    expect(hm!.casting).toBe('save');
    expect(hm!.saveAbility).toBe('CON');
    expect(hm!.saveDc).toBe(15);
  });

  it('every save spell captures a saveDc of 15 and a save ability', () => {
    const saves = info.spells.filter((s) => s.casting === 'save');
    expect(saves.length).toBeGreaterThan(0);
    for (const s of saves) {
      expect(s.saveDc).toBe(15);
      expect(s.saveAbility).toBeDefined();
    }
  });

  it('a leveled damage spell scales with level and has at-higher-levels text', () => {
    const hm = find('Heat Metal');
    expect(hm).toBeDefined();
    expect(hm!.isCantrip).toBe(false);
    expect(hm!.scalesWithLevel).toBe(true);
    expect(typeof hm!.atHigherLevels).toBe('string');
    expect(hm!.damageDice).toBe('2d8');
  });
});

// ---- Synthetic spell-slot helpers & regression tests ----

interface SynthClass {
  name: string;
  level: number;
  subclass?: string;
  id?: number;
  ability?: number; // stat id 1..6
}

function slotData(classes: SynthClass[], extra: Record<string, unknown> = {}): CharacterData {
  return {
    name: 'Synthetic',
    stats: [],
    classes: classes.map((c) => ({
      level: c.level,
      definition: {
        id: c.id,
        name: c.name,
        canCastSpells: true,
        spellCastingAbilityId: c.ability ?? null,
      },
      subclassDefinition: c.subclass ? { name: c.subclass } : null,
    })),
    ...extra,
  } as unknown as CharacterData;
}

/** Reduce computed slots (excluding pact) to [spellLevel, total] pairs. */
const tableOf = (slots: SlotLevel[]): Array<[number, number]> =>
  slots.filter((s) => !s.pact).map((s) => [s.level, s.total]);

describe('computeSpellSlots — single-class half/third casters (bug 1)', () => {
  it('Paladin 5 -> 4x1st / 2x2nd', () => {
    expect(tableOf(computeSpellSlots(slotData([{ name: 'Paladin', level: 5 }])))).toEqual([
      [1, 4],
      [2, 2],
    ]);
  });

  it('Paladin 9 -> 4/3/2', () => {
    expect(tableOf(computeSpellSlots(slotData([{ name: 'Paladin', level: 9 }])))).toEqual([
      [1, 4],
      [2, 3],
      [3, 2],
    ]);
  });

  it('Paladin 3 -> 3x1st (not 2)', () => {
    expect(tableOf(computeSpellSlots(slotData([{ name: 'Paladin', level: 3 }])))).toEqual([[1, 3]]);
  });

  it('Ranger 5 -> 4/2', () => {
    expect(tableOf(computeSpellSlots(slotData([{ name: 'Ranger', level: 5 }])))).toEqual([
      [1, 4],
      [2, 2],
    ]);
  });

  it('Eldritch Knight 7 -> 4/2', () => {
    expect(
      tableOf(
        computeSpellSlots(slotData([{ name: 'Fighter', level: 7, subclass: 'Eldritch Knight' }])),
      ),
    ).toEqual([
      [1, 4],
      [2, 2],
    ]);
  });

  it('Eldritch Knight 13 -> 4/3/2', () => {
    expect(
      tableOf(
        computeSpellSlots(slotData([{ name: 'Fighter', level: 13, subclass: 'Eldritch Knight' }])),
      ),
    ).toEqual([
      [1, 4],
      [2, 3],
      [3, 2],
    ]);
  });

  it('Arcane Trickster 3 -> 2x1st', () => {
    expect(
      tableOf(computeSpellSlots(slotData([{ name: 'Rogue', level: 3, subclass: 'Arcane Trickster' }]))),
    ).toEqual([[1, 2]]);
  });
});

describe('computeSpellSlots — Warlock Pact Magic (bug 2)', () => {
  it('Warlock 5 -> 2 pact slots at level 3', () => {
    const slots = computeSpellSlots(slotData([{ name: 'Warlock', level: 5 }]));
    const pact = slots.filter((s) => s.pact);
    expect(pact).toHaveLength(1);
    expect(pact[0]).toMatchObject({ level: 3, total: 2, pact: true });
    // Warlock alone contributes NO Vancian-table slots.
    expect(tableOf(slots)).toEqual([]);
  });

  it('Warlock 1 -> 1 pact slot at level 1; Warlock 11 -> 3 slots at level 5', () => {
    const w1 = computeSpellSlots(slotData([{ name: 'Warlock', level: 1 }])).filter((s) => s.pact);
    expect(w1[0]).toMatchObject({ level: 1, total: 1 });
    const w11 = computeSpellSlots(slotData([{ name: 'Warlock', level: 11 }])).filter((s) => s.pact);
    expect(w11[0]).toMatchObject({ level: 5, total: 3 });
  });

  it('reports Pact Magic used from the pactMagic tracker', () => {
    const slots = computeSpellSlots(
      slotData([{ name: 'Warlock', level: 5 }], { pactMagic: [{ level: 3, used: 1 }] }),
    );
    expect(slots.find((s) => s.pact)!.used).toBe(1);
  });

  it('multiclass Warlock 3 / Cleric 4 keeps Pact Magic separate from the shared table', () => {
    const slots = computeSpellSlots(
      slotData([
        { name: 'Warlock', level: 3 },
        { name: 'Cleric', level: 4 },
      ]),
    );
    // Cleric 4 => effective caster level 4 => 4/3.
    expect(tableOf(slots)).toEqual([
      [1, 4],
      [2, 3],
    ]);
    const pact = slots.filter((s) => s.pact);
    expect(pact[0]).toMatchObject({ level: 2, total: 2, pact: true });
  });
});

describe('computeSpellSlots — Artificer paths unchanged', () => {
  it('Artificer 8 (fixture) -> 4/3', () => {
    expect(tableOf(computeSpellSlots(data))).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it('Artificer 11 (fixture) -> 4/3/3', () => {
    const data11 = (fixture11 as { data: CharacterData }).data;
    expect(tableOf(computeSpellSlots(data11))).toEqual([
      [1, 4],
      [2, 3],
      [3, 3],
    ]);
  });
});

// ---- Per-spell focus-bonus scoping (bug 3) ----

function makeModel(overrides: { profBonus?: number; level?: number; mods?: Partial<Record<Ability, number>> } = {}): RollModel {
  const base: Record<Ability, number> = { STR: 0, DEX: 0, CON: 0, INT: 3, WIS: 2, CHA: 1 };
  const mods = { ...base, ...(overrides.mods ?? {}) };
  const abilities = Object.fromEntries(
    (Object.keys(mods) as Ability[]).map((a) => [a, { score: 10 + mods[a] * 2, mod: mods[a] }]),
  );
  return {
    profBonus: overrides.profBonus ?? 3,
    level: overrides.level ?? 5,
    abilities,
  } as unknown as RollModel;
}

describe('computeSpells — per-spell item focus is scoped to the spell\'s own class (bug 3)', () => {
  // Wizard (primary, INT) + Cleric (WIS). A +3 focus item belongs to the NON-primary class (Cleric).
  const multiData = {
    name: 'Multi',
    stats: [],
    classes: [
      { level: 3, definition: { id: 1, name: 'Wizard', canCastSpells: true, spellCastingAbilityId: 4 } },
      { level: 3, definition: { id: 2, name: 'Cleric', canCastSpells: true, spellCastingAbilityId: 5 } },
    ],
    modifiers: {
      item: [
        { type: 'bonus', subType: 'cleric-spell-attacks', value: 3 },
        { type: 'bonus', subType: 'cleric-spell-save-dc', value: 3 },
      ],
    },
    classSpells: [
      {
        characterClassId: 1,
        spells: [
          { definition: { name: 'Wizard Ray', level: 1, requiresAttackRoll: true }, spellCastingAbilityId: 4 },
        ],
      },
      {
        characterClassId: 2,
        spells: [
          { definition: { name: 'Cleric Bolt', level: 1, requiresAttackRoll: true }, spellCastingAbilityId: 5 },
        ],
      },
    ],
  } as unknown as CharacterData;

  const model = makeModel({ profBonus: 3, mods: { INT: 3, WIS: 2 } });
  const multi = computeSpells(multiData, model);
  const spell = (n: string) => multi.spells.find((s) => s.name === n)!;

  it('cleric-scoped +3 focus lands on the cleric spell', () => {
    // prof 3 + WIS 2 + focus 3 = 8
    expect(spell('Cleric Bolt').attackBonus).toBe(8);
  });

  it('cleric-scoped +3 focus does NOT leak onto the wizard (primary) spell', () => {
    // prof 3 + INT 3 + focus 0 = 6
    expect(spell('Wizard Ray').attackBonus).toBe(6);
  });

  it('class stat blocks are scoped correctly too', () => {
    const wiz = multi.classes.find((c) => c.className === 'Wizard')!;
    const cle = multi.classes.find((c) => c.className === 'Cleric')!;
    expect(wiz.attackBonus).toBe(6); // 3 + 3 + 0
    expect(cle.attackBonus).toBe(8); // 3 + 2 + 3
    expect(cle.saveDc).toBe(16); // 8 + 3 + 2 + 3
    expect(wiz.saveDc).toBe(14); // 8 + 3 + 3 + 0
  });
});

describe('computeSpells — concentration / ritual / casting-time tags', () => {
  const data: any = (fixture160 as any).data;
  const info = computeSpells(data, computeRollModel(data));
  const byName = (n: string) => info.spells.find((s) => s.name === n)!;

  it('flags concentration spells', () => {
    expect(byName('Web').concentration).toBe(true);
    expect(byName('Heat Metal').concentration).toBe(true);
    expect(byName('Fire Bolt').concentration).toBeUndefined(); // instantaneous
  });
  it('flags ritual spells', () => {
    expect(byName('Detect Magic').ritual).toBe(true);
    expect(byName('Web').ritual).toBeUndefined();
  });
  it('captures casting time', () => {
    expect(byName('Absorb Elements').castingTime).toBe('reaction');
    expect(byName('Fire Bolt').castingTime).toBe('action');
  });
});

describe('computeSpells — healing spells roll dice (Cure Wounds etc.)', () => {
  const data: any = (fixture160 as any).data;
  const info = computeSpells(data, computeRollModel(data));
  it('Cure Wounds carries a healDice formula (die + ability mod), not a bare cast', () => {
    const cw = info.spells.find((s) => s.name === 'Cure Wounds')!;
    expect(cw).toBeTruthy();
    expect(cw.healDice).toMatch(/\dd\d/); // e.g. "2d8 + 4"
  });
});
