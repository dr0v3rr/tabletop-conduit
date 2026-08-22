/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import { computeSpells } from '../src/engine/spells';
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
