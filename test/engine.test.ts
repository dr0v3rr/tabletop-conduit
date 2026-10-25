/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import { computeSpells } from '../src/engine/spells';
import { computeDefenses } from '../src/engine/defenses';
import { computeWeapons } from '../src/engine/weapons';
import type { CharacterData, RollModel, SkillKey } from '../src/engine';
import fixture from './fixtures/aldric-144074405.json';

// Golden fixture is produced by a parallel harvest agent and may not exist yet.
// import.meta.glob (vite/vitest) resolves to an empty map when the file is absent,
// so we can cross-check gracefully without touching the filesystem / node types.
const goldenModules = import.meta.glob('./fixtures/aldric-golden.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;
const goldenEntry = Object.values(goldenModules)[0];

const data = (fixture as { data: CharacterData }).data;
const model: RollModel = computeRollModel(data);

describe('computeRollModel — Aldric (Artificer 8)', () => {
  it('ability scores and mods', () => {
    expect(model.abilities.STR).toEqual({ score: 8, mod: -1 });
    expect(model.abilities.DEX).toEqual({ score: 14, mod: 2 });
    expect(model.abilities.CON).toEqual({ score: 14, mod: 2 });
    expect(model.abilities.INT).toEqual({ score: 18, mod: 4 });
    expect(model.abilities.WIS).toEqual({ score: 14, mod: 2 });
    expect(model.abilities.CHA).toEqual({ score: 8, mod: -1 });
  });

  it('proficiency bonus', () => {
    expect(model.profBonus).toBe(3);
    expect(model.level).toBe(8);
  });

  it('saving throws', () => {
    expect(model.saves.CON.mod).toBe(5);
    expect(model.saves.CON.proficient).toBe(true);
    expect(model.saves.INT.mod).toBe(7);
    expect(model.saves.INT.proficient).toBe(true);
    expect(model.saves.STR.mod).toBe(-1);
    expect(model.saves.DEX.mod).toBe(2);
    expect(model.saves.WIS.mod).toBe(2);
    expect(model.saves.CHA.mod).toBe(-1);
  });

  it('skills (including flat item bonus on Sleight of Hand)', () => {
    expect(model.skills.insight.mod).toBe(5);
    expect(model.skills.insight.proficient).toBe(true);
    expect(model.skills.investigation.mod).toBe(7);
    expect(model.skills.investigation.proficient).toBe(true);
    expect(model.skills.perception.mod).toBe(5);
    expect(model.skills.perception.proficient).toBe(true);
    expect(model.skills.stealth.mod).toBe(5);
    expect(model.skills.stealth.proficient).toBe(true);
    // DEX(+2) + prof(+3) + item(+5) = +10
    expect(model.skills['sleight-of-hand'].mod).toBe(10);
    expect(model.skills['sleight-of-hand'].proficient).toBe(true);
  });

  it('War Caster CON-save advantage is conditional, not unconditional', () => {
    const warCasterCon = model.conditional.find(
      (c) =>
        c.subType === 'constitution-saving-throws' &&
        c.type === 'advantage' &&
        /concentration/i.test(c.restriction),
    );
    expect(warCasterCon).toBeDefined();
    expect(warCasterCon?.source).toBe('War Caster');

    // CON save must NOT carry unconditional advantage.
    expect(model.saves.CON.advantage ?? []).toEqual([]);
  });

  it('unconditional save advantages are surfaced as flags', () => {
    // Vedalken race grants unrestricted advantage on INT/WIS/CHA saves.
    expect((model.saves.INT.advantage ?? []).length).toBeGreaterThan(0);
    expect((model.saves.WIS.advantage ?? []).length).toBeGreaterThan(0);
    expect((model.saves.CHA.advantage ?? []).length).toBeGreaterThan(0);
  });

  it('passives', () => {
    expect(model.passives.perception).toBe(15);
    expect(model.passives.investigation).toBe(17);
    expect(model.passives.insight).toBe(15);
  });

  it('initiative', () => {
    expect(model.initiative).toBe(2);
  });

  it('spellcasting (Artificer = INT)', () => {
    const sc = computeSpells(data, model).classes[0];
    expect(sc).toBeDefined();
    expect(sc?.ability).toBe('INT');
    expect(sc?.saveDc).toBe(15); // 8 + 3 + 4
    expect(sc?.attackBonus).toBe(7); // 3 + 4
  });
});

// ---------------------------------------------------------------------------
// Regression tests for the three fixed engine bugs. These use SYNTHETIC mutations
// of the single-class Artificer fixture to exercise behaviors it does not itself
// contain (item gating, `set` score mods, global half-proficiency).
// ---------------------------------------------------------------------------
const clone = (d: CharacterData): CharacterData => JSON.parse(JSON.stringify(d)) as CharacterData;
const SKILL_KEYS = Object.keys(model.skills) as SkillKey[];

describe('bug #1 — item modifiers gated on equipped/attunement', () => {
  it('an UNEQUIPPED item drops its skill modifier (Gloves of Thievery +5 Sleight of Hand)', () => {
    // Baseline: Gloves of Thievery equipped -> Sleight of Hand +10 (asserted above).
    expect(model.skills['sleight-of-hand'].mod).toBe(10);

    const d = clone(data);
    const gloves = (d.inventory ?? []).find((it) => it.definition?.id === 5352);
    expect(gloves).toBeDefined();
    gloves!.equipped = false; // unequip -> the +5 item bonus must be dropped

    const m2 = computeRollModel(d);
    expect(m2.skills['sleight-of-hand'].mod).toBe(5); // DEX(+2) + prof(+3), no item +5
  });

  it('an equipped item still applies (control — golden unchanged)', () => {
    const m2 = computeRollModel(clone(data));
    expect(m2.skills['sleight-of-hand'].mod).toBe(10);
  });
});

describe('bug — modifier-level attunement gating (Cloak of Protection pattern)', () => {
  // DDB often leaves the ITEM's definition.requiresAttunement unset and instead flags the MODIFIER
  // with requiresAttunement. An equipped-but-UNATTUNED such item must NOT grant its bonus; attuning
  // it must. (Cloak/Ring of Protection: +1 to all saving throws only while attuned.)
  const withCloak = (attuned: boolean): CharacterData => {
    const d = clone(data);
    (d.inventory ??= []).push({
      id: 987654, entityTypeId: 0,
      definition: { id: 99991, name: 'Test Cloak of Protection', canAttune: true, grantedModifiers: [] },
      equipped: true, isAttuned: attuned,
    } as never);
    (d.modifiers as { item?: unknown[] }).item = [
      ...(((d.modifiers as { item?: unknown[] }).item) ?? []),
      { type: 'bonus', subType: 'saving-throws', value: 1, componentId: 99991, requiresAttunement: true, restriction: '' },
    ];
    return d;
  };
  it('UNATTUNED → the +1 to all saves is withheld', () => {
    const m2 = computeRollModel(withCloak(false));
    expect(m2.saves.CON.mod).toBe(model.saves.CON.mod);
    expect(m2.saves.STR.mod).toBe(model.saves.STR.mod);
    expect(m2.saves.CHA.mod).toBe(model.saves.CHA.mod);
  });
  it('ATTUNED → the +1 applies to every save', () => {
    const m2 = computeRollModel(withCloak(true));
    expect(m2.saves.CON.mod).toBe(model.saves.CON.mod + 1);
    expect(m2.saves.STR.mod).toBe(model.saves.STR.mod + 1);
    expect(m2.saves.CHA.mod).toBe(model.saves.CHA.mod + 1);
  });
});

describe('bug — ungranted RACE ability increase (2024 origin rules) is not applied', () => {
  // Under 2024 rules ability increases come from the BACKGROUND; a legacy species ASI is left in the
  // data flagged isGranted:false and must NOT apply (seen live: a Gem Dragonborn's +2 CHA, isGranted
  // false, inflating CHA by 2). But feat/background ability bonuses (half-feats, the chosen ASI) DO
  // apply even when DDB flags them isGranted:false — so the drop is scoped to race `*-score` bonuses —
  // and a species' own increases still apply when the background grants none (Acerē: Half-Elf +1s).
  const withCha = (bucket: 'race' | 'feat', granted: boolean, bgAsi = true): CharacterData => {
    const d = clone(data);
    const mods = d.modifiers as Record<string, unknown[]>;
    mods[bucket] = [...(mods[bucket] ?? []), { type: 'bonus', subType: 'charisma-score', value: 2, isGranted: granted }];
    if (bgAsi) mods.background = [...(mods.background ?? []), { type: 'bonus', subType: 'wisdom-score', value: 1, isGranted: true }];
    return d;
  };
  const wisBump = 1; // the background ASI added alongside (2024 origin)
  it('an ungranted RACE ability-score bonus is dropped when the background grants the increases', () => {
    const m = computeRollModel(withCha('race', false));
    expect(m.abilities.CHA.score).toBe(model.abilities.CHA.score);
    expect(m.abilities.WIS.score).toBe(model.abilities.WIS.score + wisBump);
  });
  it('an ungranted RACE ability-score bonus still applies when the background grants none (legacy origin)', () => {
    expect(computeRollModel(withCha('race', false, false)).abilities.CHA.score).toBe(model.abilities.CHA.score + 2);
  });
  it('a granted RACE ability-score bonus still applies', () => {
    expect(computeRollModel(withCha('race', true)).abilities.CHA.score).toBe(model.abilities.CHA.score + 2);
  });
  it('an ungranted FEAT ability-score bonus still applies (half-feat / chosen ASI)', () => {
    expect(computeRollModel(withCha('feat', false)).abilities.CHA.score).toBe(model.abilities.CHA.score + 2);
  });
});

describe('bonus equal to an ability modifier (statId, no value)', () => {
  // D&D Beyond encodes "add your Charisma modifier" (Aura of Protection) as a bonus with value null
  // and statId 6 — it used to count as 0.
  const withStatBonus = (subType: string, statId: number, restriction = ''): CharacterData => {
    const d = clone(data);
    const mods = d.modifiers as Record<string, unknown[]>;
    mods.class = [...(mods.class ?? []), { type: 'bonus', subType, value: null, statId, restriction }];
    return d;
  };
  it('adds the named ability modifier to every save', () => {
    const m = computeRollModel(withStatBonus('saving-throws', 6));
    const cha = model.abilities.CHA.mod;
    for (const ab of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const) expect(m.saves[ab].mod).toBe(model.saves[ab].mod + cha);
  });
  it('adds it to initiative', () => {
    expect(computeRollModel(withStatBonus('initiative', 5)).initiative).toBe(model.initiative + model.abilities.WIS.mod);
  });
  it('a restricted one stays conditional', () => {
    expect(computeRollModel(withStatBonus('initiative', 5, 'while raging')).initiative).toBe(model.initiative);
  });
});

describe('bug #2 — `set`-type ability-score modifiers', () => {
  it('an equipped+attuned item that SETs STR to 21 raises the score and cascades', () => {
    const d = clone(data);
    (d.inventory ??= []).push({
      id: 990001001,
      equipped: true,
      isAttuned: true,
      entityTypeId: 1439493548,
      definition: {
        id: 990001,
        name: 'Gauntlets of Ogre Power (synthetic)',
        requiresAttunement: true,
        grantedModifiers: [
          { type: 'set', subType: 'strength-score', value: 21, componentId: 990001 },
        ],
      },
    });
    (d.modifiers ??= {} as any)!.item = [
      ...(d.modifiers!.item ?? []),
      { type: 'set', subType: 'strength-score', value: 21, componentId: 990001 },
    ];

    const m2 = computeRollModel(d);
    // Base STR 8 (mod -1) -> set 21 (mod +5).
    expect(m2.abilities.STR).toEqual({ score: 21, mod: 5 });
    // Cascade to STR-based skill (Athletics) and STR save: delta = +5 - (-1) = +6.
    expect(m2.skills.athletics.mod).toBe(model.skills.athletics.mod + 6);
    expect(m2.saves.STR.mod).toBe(model.saves.STR.mod + 6);
  });

  it('the SAME set-STR-21 mod from an UNEQUIPPED item is DROPPED (no cascade)', () => {
    const d = clone(data);
    (d.inventory ??= []).push({
      id: 990002001,
      equipped: false, // not equipped -> gated out
      isAttuned: false,
      entityTypeId: 1439493548,
      definition: {
        id: 990002,
        name: 'Gauntlets of Ogre Power (synthetic, stowed)',
        requiresAttunement: true,
        grantedModifiers: [
          { type: 'set', subType: 'strength-score', value: 21, componentId: 990002 },
        ],
      },
    });
    (d.modifiers ??= {} as any)!.item = [
      ...(d.modifiers!.item ?? []),
      { type: 'set', subType: 'strength-score', value: 21, componentId: 990002 },
    ];

    const m2 = computeRollModel(d);
    expect(m2.abilities.STR).toEqual({ score: 8, mod: -1 }); // unchanged
    expect(m2.skills.athletics.mod).toBe(model.skills.athletics.mod);
    expect(m2.saves.STR.mod).toBe(model.saves.STR.mod);
  });
});

describe('bug #3 — global half-proficiency (Jack of All Trades / Remarkable Athlete)', () => {
  it('raises non-proficient skills and initiative by floor(prof/2), leaving proficient skills alone', () => {
    // Pick a skill with no proficiency/expertise/half of its own.
    const plainSkill = SKILL_KEYS.find(
      (sk) => !model.skills[sk].proficient && !model.skills[sk].expertise,
    ) as SkillKey;
    expect(plainSkill).toBeDefined();

    const d = clone(data);
    (d.modifiers ??= {} as any)!.class = [
      ...(d.modifiers!.class ?? []),
      // Global marker: half-proficiency with a NON-skill subType.
      { type: 'half-proficiency', subType: 'ability-checks', value: null, componentId: 12345 },
    ];

    const m2 = computeRollModel(d);
    const half = Math.floor(model.profBonus / 2); // profBonus 3 -> 1

    // Non-proficient skill gains half-prof.
    expect(m2.skills[plainSkill].mod).toBe(model.skills[plainSkill].mod + half);
    expect(m2.skills[plainSkill].proficient).toBe(false);
    // Proficient skill is unchanged (no double-apply).
    expect(m2.skills.investigation.mod).toBe(model.skills.investigation.mod);
    // Initiative gains half-prof.
    expect(m2.initiative).toBe(model.initiative + half);
  });

  it('does NOT fire when only skill-specific half-proficiency mods exist', () => {
    const d = clone(data);
    (d.modifiers ??= {} as any)!.class = [
      ...(d.modifiers!.class ?? []),
      // Skill-keyed subType -> NOT a global marker.
      { type: 'half-proficiency', subType: 'acrobatics', value: null, componentId: 12346 },
    ];
    const m2 = computeRollModel(d);
    // Initiative and unrelated non-proficient skills untouched.
    expect(m2.initiative).toBe(model.initiative);
    const other = SKILL_KEYS.find(
      (sk) => sk !== 'acrobatics' && !model.skills[sk].proficient && !model.skills[sk].expertise,
    ) as SkillKey;
    expect(m2.skills[other].mod).toBe(model.skills[other].mod);
  });
});

describe('goldens unchanged after fixes (single-class Artificer L8)', () => {
  it('re-computing the unmutated fixture yields identical output', () => {
    const again = computeRollModel(clone(data));
    expect(again).toEqual(model);
    // Spot-check load-bearing golden values.
    expect(again.abilities.INT).toEqual({ score: 18, mod: 4 });
    expect(again.skills['sleight-of-hand'].mod).toBe(10);
    expect(again.initiative).toBe(2);
    expect(again.passives).toEqual({ perception: 15, investigation: 17, insight: 15 });
  });
});

describe('golden fixture cross-check (skipped if absent)', () => {
  it('matches every overlapping value', () => {
    if (!goldenEntry) {
      // Produced by a parallel harvest agent; skip gracefully if not present yet.
      return;
    }
    const golden = goldenEntry.default as any;
    const g = golden.data ?? golden;

    const disagreements: string[] = [];
    const check = (label: string, mine: unknown, theirs: unknown) => {
      if (theirs === undefined || theirs === null) return; // only cross-check overlapping keys
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        disagreements.push(`${label}: mine=${JSON.stringify(mine)} golden=${JSON.stringify(theirs)}`);
      }
    };

    // profBonus / level
    check('profBonus', model.profBonus, g.profBonus ?? g.prof);
    if (g.level !== undefined) check('level', model.level, g.level);

    // abilities
    if (g.abilities) {
      for (const ab of Object.keys(g.abilities)) {
        const mine = model.abilities[ab as keyof typeof model.abilities];
        const theirs = g.abilities[ab];
        if (theirs?.score !== undefined) check(`abilities.${ab}.score`, mine?.score, theirs.score);
        if (theirs?.mod !== undefined) check(`abilities.${ab}.mod`, mine?.mod, theirs.mod);
      }
    }

    // saves — golden may store number or {mod}
    if (g.saves) {
      for (const ab of Object.keys(g.saves)) {
        const mine = model.saves[ab as keyof typeof model.saves];
        const t = g.saves[ab];
        const theirsMod = typeof t === 'number' ? t : t?.mod;
        check(`saves.${ab}.mod`, mine?.mod, theirsMod);
        if (t && typeof t === 'object' && t.proficient !== undefined) {
          check(`saves.${ab}.proficient`, mine?.proficient, t.proficient);
        }
      }
    }

    // skills — golden may store number or {mod}
    if (g.skills) {
      for (const sk of Object.keys(g.skills)) {
        const mine = model.skills[sk as keyof typeof model.skills];
        const t = g.skills[sk];
        const theirsMod = typeof t === 'number' ? t : t?.mod;
        check(`skills.${sk}.mod`, mine?.mod, theirsMod);
      }
    }

    // passives
    if (g.passives) {
      for (const p of Object.keys(g.passives)) {
        check(`passives.${p}`, (model.passives as any)[p], g.passives[p]);
      }
    }

    if (disagreements.length) {
      throw new Error('Golden fixture disagreements:\n' + disagreements.join('\n'));
    }
  });
});

describe('spellcasting focus bonuses only count while the item is in use', () => {
  // A +2 focus (Rod of the Pact Keeper style): bonus spell-attacks / spell-save-dc, attunement required.
  const withFocus = (equipped: boolean, attuned: boolean): CharacterData => {
    const d = clone(data);
    (d.inventory ??= []).push({
      id: 990002001, equipped, isAttuned: attuned,
      definition: { id: 990002, name: 'Focus (synthetic)', requiresAttunement: true },
    } as never);
    const mods = d.modifiers as Record<string, unknown[]>;
    mods.item = [...(mods.item ?? []),
      { type: 'bonus', subType: 'spell-attacks', value: 2, componentId: 990002 },
      { type: 'bonus', subType: 'spell-save-dc', value: 2, componentId: 990002 }];
    return d;
  };
  const base = computeSpells(data, model).classes[0]!;
  const cast = (d: CharacterData) => computeSpells(d, computeRollModel(d)).classes[0]!;
  it('equipped and attuned → +2 to spell attack and save DC', () => {
    const c = cast(withFocus(true, true));
    expect(c.attackBonus).toBe(base.attackBonus + 2);
    expect(c.saveDc).toBe(base.saveDc + 2);
  });
  it('carried but not attuned → no bonus', () => {
    const c = cast(withFocus(true, false));
    expect([c.attackBonus, c.saveDc]).toEqual([base.attackBonus, base.saveDc]);
  });
  it('not equipped → no bonus', () => {
    const c = cast(withFocus(false, true));
    expect([c.attackBonus, c.saveDc]).toEqual([base.attackBonus, base.saveDc]);
  });
});

describe('multiclass: only the starting class grants its starting proficiencies', () => {
  // D&D Beyond flags a class's starting proficiencies availableToMulticlass:false. Seen live: a
  // Rogue-first Rogue/Ranger was given Ranger's STR save proficiency.
  const multiclass = (rangerFirst: boolean): CharacterData => {
    const d = clone(data);
    d.classes = [
      { level: 5, isStartingClass: rangerFirst, definition: { name: 'Ranger' }, classFeatures: [{ definition: { id: 9001, name: 'Proficiencies' } }] },
      { level: 15, isStartingClass: !rangerFirst, definition: { name: 'Rogue' }, classFeatures: [{ definition: { id: 9002, name: 'Proficiencies' } }] },
    ] as never;
    const mods = d.modifiers as Record<string, unknown[]>;
    mods.class = [
      { type: 'proficiency', subType: 'strength-saving-throws', componentId: 9001, availableToMulticlass: false },
      { type: 'proficiency', subType: 'intelligence-saving-throws', componentId: 9002, availableToMulticlass: false },
    ];
    return d;
  };
  it('Rogue first → INT save proficient, STR not', () => {
    const m = computeRollModel(multiclass(false));
    expect(m.saves.INT.proficient).toBe(true);
    expect(m.saves.STR.proficient).toBe(false);
  });
  it('Ranger first → STR save proficient, INT not', () => {
    const m = computeRollModel(multiclass(true));
    expect(m.saves.STR.proficient).toBe(true);
    expect(m.saves.INT.proficient).toBe(false);
  });
});

describe('speed comes from the species plus speed modifiers', () => {
  const withSpeedMods = (mods: unknown[], armour = false): CharacterData => {
    const d = clone(data);
    (d.race as { weightSpeeds?: unknown }).weightSpeeds = { normal: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 } };
    (d.modifiers as Record<string, unknown[]>).feat = [...((d.modifiers as Record<string, unknown[]>).feat ?? []), ...mods];
    d.inventory = (d.inventory ?? []).filter((it) => typeof (it.definition as { armorTypeId?: unknown } | undefined)?.armorTypeId !== 'number');
    if (armour) d.inventory.push({ id: 1, equipped: true, definition: { id: 1, name: 'Chain Mail', armorTypeId: 3 } } as never);
    return d;
  };
  it('"your walking speed is 35" then +10 (Fleet of Foot + Mobile) → 45', () => {
    const m = computeRollModel(withSpeedMods([
      { type: 'set', subType: 'innate-speed-walking', value: 35 },
      { type: 'bonus', subType: 'speed', value: 10 },
    ]));
    expect(m.speed).toBe(45);
  });
  it('a fly speed "equal to your walking speed" lists alongside walking; a conditional one does not', () => {
    const m = computeRollModel(withSpeedMods([
      { type: 'set', subType: 'innate-speed-flying', value: null },
      { type: 'set', subType: 'innate-speed-swimming', value: 40, restriction: 'In dim light' },
    ]));
    expect(m.speeds).toEqual([{ type: 'walking', value: 30 }, { type: 'flying', value: 30 }]);
  });
  it('Unarmored Movement only without armour', () => {
    const um = [{ type: 'bonus', subType: 'unarmored-movement', value: 15 }];
    expect(computeRollModel(withSpeedMods(um)).speed).toBe(45);
    expect(computeRollModel(withSpeedMods(um, true)).speed).toBe(30);
  });
});

describe('an item\'s spells and resistances need the item in use', () => {
  // Staff of Fire (requires attunement): fire resistance "while held" and three spells cast from charges.
  const withStaff = (equipped: boolean, attuned: boolean): CharacterData => {
    const d = clone(data);
    (d.inventory ??= []).push({ id: 990003001, equipped, isAttuned: attuned, definition: { id: 990003, name: 'Staff of Fire', requiresAttunement: true } } as never);
    const mods = d.modifiers as Record<string, unknown[]>;
    mods.item = [...(mods.item ?? []), { type: 'resistance', subType: 'fire', componentId: 990003, restriction: 'While Staff is Held' }];
    const spells = (d as unknown as { spells: Record<string, unknown[]> }).spells;
    spells.item = [...(spells.item ?? []), { componentId: 990003, usesSpellSlot: false, definition: { name: 'Fireball (synthetic)', level: 3 } }];
    return d;
  };
  const fireball = (d: CharacterData) => computeSpells(d, computeRollModel(d)).spells.find((s) => s.name === 'Fireball (synthetic)');
  it('in use → resistance and the spell, cast from the item without a slot', () => {
    const d = withStaff(true, true);
    expect(computeDefenses(d).resist).toContain('fire');
    expect(fireball(d)).toMatchObject({ fromItem: true, noSlot: true });
  });
  it('carried unequipped or unattuned → neither', () => {
    for (const d of [withStaff(false, false), withStaff(true, false)]) {
      expect(computeDefenses(d).resist).not.toContain('fire');
      expect(fireball(d)).toBeUndefined();
    }
  });
});

describe('2014 Divine Smite is castable like a spell', () => {
  const paladin = (sourceId: number): CharacterData => {
    const d = clone(data);
    d.classes = [{ level: 6, definition: { name: 'Paladin' }, classFeatures: [{ definition: { id: 1, name: 'Divine Smite', requiredLevel: 2, sources: [{ sourceId }] } }] }] as never;
    return d;
  };
  const smite = (d: CharacterData) => computeSpells(d, computeRollModel(d)).spells.find((s) => s.name === 'Divine Smite');
  it('2014: 2d8 radiant, +1d8 per slot level, capped at a 4th-level slot (5d8)', () => {
    expect(smite(paladin(2))).toMatchObject({ level: 1, autoHit: true, damageDice: '2d8', damageType: 'Radiant', higherLevelDice: '1d8', maxCastLevel: 4 });
  });
  it('2024: not added — the 2024 Divine Smite is a real spell', () => {
    expect(smite(paladin(145))).toBeUndefined();
  });
});

describe('weapon-style actions add the ability modifier to damage; spell-style ones do not', () => {
  const withAction = (a: Record<string, unknown>): CharacterData => {
    const d = clone(data);
    (d as unknown as { actions: Record<string, unknown[]> }).actions = { feat: [{ name: 'Test Attack', dice: { diceString: '1d4' }, attackTypeRange: 1, damageTypeId: 1, abilityModifierStatId: 1, isProficient: true, ...a }] };
    return d;
  };
  const dmgMod = (d: CharacterData) => computeWeapons(d, computeRollModel(d)).find((w) => w.name === 'Test Attack')!.damageMod;
  it("Polearm Master's butt end: 1d4 + STR", () => {
    expect(dmgMod(withAction({ actionType: 3 }))).toBe(model.abilities.STR.mod);
  });
  it('Eldritch Cannon (spell-style): dice only', () => {
    expect(dmgMod(withAction({ actionType: 2, spellRangeType: 3 }))).toBe(0);
  });
});

describe('cross-check against D&D Beyond sheets (Oct 2026)', () => {
  const spellsOf = (d: CharacterData) => computeSpells(d, computeRollModel(d)).spells;
  const withSpell = (bucket: string, entry: Record<string, unknown>, extra: (d: CharacterData) => void = () => {}): CharacterData => {
    const d = clone(data);
    const sp = (d as unknown as { spells: Record<string, unknown[]> }).spells;
    sp[bucket] = [...(sp[bucket] ?? []), entry];
    extra(d);
    return d;
  };

  it('a choice of damage type is one roll (Absorb Elements 1d6, not 5d6); two real types both roll (Meteor Swarm)', () => {
    const choice = 'Triggering damage - acid, cold, fire, lightning, or thunder damage';
    const ae = withSpell('race', { definition: { name: 'Absorb Elements (synthetic)', level: 1, modifiers: ['acid', 'cold', 'fire'].map((t) => ({ type: 'damage', subType: t, die: { diceString: '1d6' }, restriction: choice })) } });
    expect(spellsOf(ae).find((s) => s.name === 'Absorb Elements (synthetic)')!.damages).toEqual([{ dice: '1d6', type: 'Acid/Cold/Fire' }]);
    const ms = withSpell('race', { definition: { name: 'Meteor Swarm (synthetic)', level: 9, modifiers: ['fire', 'bludgeoning'].map((t) => ({ type: 'damage', subType: t, die: { diceString: '20d6' }, restriction: '' })) } });
    expect(spellsOf(ms).find((s) => s.name === 'Meteor Swarm (synthetic)')!.damages!.map((x) => x.dice)).toEqual(['20d6', '20d6']);
  });

  it('Agonizing Blast adds CHA to each beam; Eldritch Blast fires 1 + beams by character level', () => {
    const eb = withSpell('race', {
      definition: { name: 'Eldritch Blast', level: 0, requiresAttackRoll: true, scaleType: 'characterlevel',
        modifiers: [{ type: 'damage', subType: 'force', die: { diceString: '1d10' } }],
        atHigherLevels: { higherLevelDefinitions: [{ level: 5, value: 1, details: 'Beams' }, { level: 11, value: 2, details: 'Beams' }, { level: 17, value: 3, details: 'Beams' }] } },
    }, (d) => { ((d.modifiers as Record<string, unknown[]>).class ??= []).push({ type: 'eldritch-blast', subType: 'bonus-damage', value: null, statId: 6 }); });
    const s = spellsOf(eb).find((x) => x.name === 'Eldritch Blast')!;
    const cha = computeRollModel(eb).abilities.CHA.mod;
    expect(s.damageDice).toBe(cha >= 0 ? `1d10 + ${cha}` : `1d10 - ${-cha}`);
    expect(s.attacks).toBe(computeRollModel(eb).level >= 11 ? 3 : 2); // Aldric fixture is level 8 → 2 beams
  });

  it("a class's focus bonus applies to spells its features grant, not to a chosen option's, a species' or a feat's", () => {
    const focus = (d: CharacterData) => {
      (d.inventory ??= []).push({ id: 990004001, equipped: true, isAttuned: true, definition: { id: 990004, name: 'Focus', requiresAttunement: true } } as never);
      ((d.modifiers as Record<string, unknown[]>).item ??= []).push({ type: 'bonus', subType: 'artificer-spell-attacks', value: 3, componentId: 990004 });
    };
    const ray = (componentId: number) => withSpell('class', { componentId, definition: { name: 'Ray (synthetic)', level: 2, requiresAttackRoll: true } }, focus);
    const featureId = (data.classes![0]!.classFeatures![0]!.definition as { id: number }).id;
    const base = spellsOf(ray(featureId)).find((s) => s.name === 'Ray (synthetic)')!.attackBonus!;
    expect(spellsOf(ray(123456789)).find((s) => s.name === 'Ray (synthetic)')!.attackBonus).toBe(base - 3);
  });

  it('a speed typed on the sheet overrides the computed one', () => {
    const d = clone(data);
    (d as unknown as { customSpeeds: unknown[] }).customSpeeds = [{ movementId: 1, distance: 40 }, { movementId: 4, distance: 60 }];
    const m = computeRollModel(d);
    expect(m.speed).toBe(40);
    expect(m.speeds).toContainEqual({ type: 'flying', value: 60 });
  });

  it('only equipped weapons are attacks', () => {
    const names = (d: CharacterData) => computeWeapons(d, computeRollModel(d)).filter((w) => w.source === 'inventory').map((w) => w.name);
    const d = clone(data);
    const dagger = (d.inventory ?? []).find((it) => it.definition?.name === 'Dagger')!;
    dagger.equipped = false;
    expect(names(d)).not.toContain('Dagger');
    dagger.equipped = true;
    expect(names(d)).toContain('Dagger');
  });

  it('an action D&D Beyond does not list as an attack (Eldritch Cannon) adds no ability mod', () => {
    const d = clone(data);
    (d as unknown as { actions: Record<string, unknown[]> }).actions = { class: [{ name: 'Cannon (synthetic)', dice: { diceString: '2d8' }, attackTypeRange: 2, damageTypeId: 13, abilityModifierStatId: 4, isProficient: true, actionType: 3, displayAsAttack: false }] };
    expect(computeWeapons(d, computeRollModel(d)).find((w) => w.name === 'Cannon (synthetic)')!.damageMod).toBe(0);
  });
});

describe('2024 background increases on an __INITIAL_ASI feat; customised weapons', () => {
  // A Gem Dragonborn with a 2024 background: the species' legacy +2 CHA is ungranted, and the
  // background's increases sit on a background "feat" tagged __INITIAL_ASI, not in the background bucket.
  const gem = (): CharacterData => {
    const d = clone(data);
    d.feats = [...(d.feats ?? []), { definition: { id: 777001, name: 'Charlatan Ability Score Improvements', categories: [{ tagName: '__INITIAL_ASI' }] } }] as never;
    const mods = d.modifiers as Record<string, unknown[]>;
    mods.background = [];
    mods.race = [...(mods.race ?? []), { type: 'bonus', subType: 'charisma-score', value: 2, isGranted: false }];
    mods.feat = [...(mods.feat ?? []),
      { type: 'bonus', subType: 'charisma-score', value: 2, isGranted: false, componentId: 777001 },
      // Resilient: the restriction describes the choice, it isn't a condition
      { type: 'bonus', subType: 'constitution-score', value: 1, isGranted: false, restriction: 'That you do not have Saving Throw Proficiency in.' }];
    return d;
  };
  it('drops the species +2 and applies the background +2 and Resilient +1', () => {
    const m = computeRollModel(gem());
    expect(m.abilities.CHA.score).toBe(model.abilities.CHA.score + 2);
    expect(m.abilities.CON.score).toBe(model.abilities.CON.score + 1);
  });
  it("a weapon customised on the sheet adds its to-hit and damage bonus", () => {
    const d = equipDagger(clone(data));
    const dagger = d.inventory!.find((it) => it.definition?.name === 'Dagger')! as { id?: number };
    (d as unknown as { characterValues: unknown[] }).characterValues = [
      { typeId: 10, value: 2, valueId: String(dagger.id), valueTypeId: '1439493548' },
      { typeId: 12, value: 2, valueId: String(dagger.id), valueTypeId: '1439493548' },
    ];
    const before = computeWeapons(equipDagger(clone(data)), model).find((w) => w.name === 'Dagger')!;
    const after = computeWeapons(d, model).find((w) => w.name === 'Dagger')!;
    expect([after.attackMod - before.attackMod, after.damageMod - before.damageMod]).toEqual([2, 2]);
  });
});
function equipDagger(d: CharacterData): CharacterData {
  for (const it of d.inventory ?? []) if (it.definition?.name === 'Dagger') it.equipped = true;
  return d;
}
