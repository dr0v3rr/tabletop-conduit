/// <reference types="vite/client" />
// Regression: validate the roll engine against D&D Beyond's OWN computed sheet for
// Aldric 160931906 (Artificer/Artillerist 11). Ground-truth golden values were harvested
// directly from DDB's rendered React sheet on 2026-08-17.
//
// Everything the engine handles (abilities/saves/skills/passives/profBonus/initiative,
// and Unarmed Strike to-hit) matches DDB exactly and is asserted for equality below.
//
// KNOWN DIVERGENCE (documented, not silently accepted): DDB's spell attack (+11) and
// spell save DC (19) include a +3 from the equipped "All-Purpose Tool, +3" magic item
// (item modifiers `bonus/artificer-spell-attacks` and `bonus/artificer-spell-save-dc`).
// The engine's spellcasting math is prof + INT only (8 / 16) and does not fold in these
// item-granted spell bonuses. That gap is pinned by an explicit assertion so a future
// fix (or regression) is caught. NB: the Dark Bargain feat carries no mechanical
// modifiers on DDB, so it is (correctly) a no-op here.
import { describe, it, expect } from 'vitest';
import { computeRollModel } from '../src/engine';
import { computeWeapons } from '../src/engine/weapons';
import { computeSpells } from '../src/engine/spells';
import type { CharacterData, RollModel, SkillKey, Ability } from '../src/engine';
import fixture from './fixtures/aldric-160931906.json';
import golden from './fixtures/aldric-160931906-golden.json';

const data = (fixture as { data: CharacterData }).data;
const model: RollModel = computeRollModel(data);
const weapons = computeWeapons(data, model);
const spellInfo = computeSpells(data, model);

describe('golden 160931906 — Aldric (Artificer/Artillerist 11) vs DDB sheet', () => {
  it('proficiency bonus and level', () => {
    expect(model.profBonus).toBe(golden.profBonus);
    expect(model.level).toBe(11);
  });

  it('ability scores and mods', () => {
    for (const ab of Object.keys(golden.abilities) as Ability[]) {
      const g = golden.abilities[ab];
      expect(model.abilities[ab]).toEqual({ score: g.score, mod: g.mod });
    }
  });

  it('saving throws (mod + proficient flag)', () => {
    for (const ab of Object.keys(golden.saves) as Ability[]) {
      const g = golden.saves[ab];
      expect(model.saves[ab].mod).toBe(g.mod);
      expect(model.saves[ab].proficient).toBe(g.proficient);
    }
  });

  it('all 18 skills (mod + proficient flag)', () => {
    for (const sk of Object.keys(golden.skills) as SkillKey[]) {
      const g = golden.skills[sk];
      expect(model.skills[sk].mod).toBe(g.mod);
      expect(model.skills[sk].proficient).toBe(g.proficient);
    }
  });

  it('passives', () => {
    expect(model.passives.perception).toBe(golden.passives.perception);
    expect(model.passives.investigation).toBe(golden.passives.investigation);
    expect(model.passives.insight).toBe(golden.passives.insight);
  });

  it('initiative', () => {
    expect(model.initiative).toBe(golden.initiative);
  });

  it('weapon to-hit where DDB renders it (Unarmed Strike)', () => {
    const unarmed = weapons.find((w) => w.name === 'Unarmed Strike');
    expect(unarmed).toBeDefined();
    const g = golden.attacks['Unarmed Strike'];
    expect(unarmed?.attackMod).toBe(g.toHit); // -1 STR + 4 prof = +3, and 1 + (-1) = 0 damage
  });

  // ---- FIXED: item-granted spell bonuses (All-Purpose Tool +3) now folded in ----
  it('spell attack / save DC include the All-Purpose Tool +3 and match DDB', () => {
    const cls = spellInfo.classes[0];
    // Engine now matches DDB's ground truth: prof 4 + INT 4 + item 3.
    expect(golden.spellAttack).toBe(11);
    expect(golden.spellSaveDc).toBe(19);
    expect(cls?.attackBonus).toBe(golden.spellAttack); // 11
    expect(cls?.saveDc).toBe(golden.spellSaveDc); // 19
  });

  it('spell attack-roll spells match DDB to-hit (+11)', () => {
    for (const s of spellInfo.spells.filter((x) => x.casting === 'attack')) {
      const g = (golden.attacks as Record<string, { toHit: number | null }>)[s.name];
      if (!g || g.toHit == null) continue;
      expect(s.attackBonus).toBe(g.toHit); // 11 for Fire Bolt / Ray of Frost / Scorching Ray
    }
  });
});
