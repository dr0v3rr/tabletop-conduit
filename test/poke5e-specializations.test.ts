import { describe, it, expect } from "vitest";
import { specCounts, specSkillBonus } from "../src/poke5e/specializations";
import { pokemonToCharacter } from "../src/poke5e/pokemon";

describe("specCounts (read trainer row)", () => {
  it("reads per-type counts, drops zeros, caps each at 5", () => {
    expect(specCounts({ special_electric: 1, special_fire: 3, special_water: 0 })).toEqual({ electric: 1, fire: 3 });
    expect(specCounts({ special_dragon: 9 })).toEqual({ dragon: 5 }); // poke5e caps a specialization at 5
    expect(specCounts({})).toEqual({});
    expect(specCounts(null)).toEqual({});
  });
});

describe("specSkillBonus (per-Pokémon)", () => {
  it("sums +1 per stack for each matching type", () => {
    expect(specSkillBonus({ electric: 1 }, ["electric"])).toBe(1);
    expect(specSkillBonus({ fire: 2, flying: 1, water: 5 }, ["fire", "flying"])).toBe(3); // water doesn't match
    expect(specSkillBonus({ fire: 2 }, ["electric"])).toBe(0); // off-type → nothing
    expect(specSkillBonus({ fire: 2 }, [])).toBe(0);
  });
});

describe("pokemonToCharacter — specialization applied to skill checks only", () => {
  const pk = (over: any = {}) => ({ level: 1, type: ["electric"], strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10, hp_max: 10, ...over });

  it("adds the bonus to every skill (and derived passives), not saves", () => {
    const { model } = pokemonToCharacter(pk(), [], {}, [], [], "", { electric: 1 }); // Engineer ×1 on an Electric Pokémon
    expect(model.specBonus).toBe(1);
    expect(model.skills.athletics.mod).toBe(1); // 0 ability + 0 prof + 1 spec
    expect(model.skills.stealth.mod).toBe(1);
    expect(model.passives.perception).toBe(11); // 10 + (0 + 1 spec)
    expect(model.saves.DEX.mod).toBe(0); // saves are NOT boosted
    expect(model.initiative).toBe(0); // nor initiative
  });

  it("does nothing for an off-type Pokémon", () => {
    const { model } = pokemonToCharacter(pk(), [], {}, [], [], "", { fire: 2 }); // fire spec, Electric Pokémon
    expect(model.specBonus).toBeUndefined();
    expect(model.skills.athletics.mod).toBe(0);
  });

  it("sums across a dual-type Pokémon and stacks", () => {
    const { model } = pokemonToCharacter(pk({ type: ["fire", "flying"] }), [], {}, [], [], "", { fire: 2, flying: 1, water: 5 });
    expect(model.specBonus).toBe(3);
    expect(model.skills.arcana.mod).toBe(3);
  });
});
