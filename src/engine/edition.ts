// Rules edition (2014 vs 2024) of a D&D Beyond definition.
//
// Many feats and features share a name across the 2014 and 2024 rules but work differently
// (Great Weapon Master's -5/+10 vs +Proficiency Bonus damage; Divine Smite the feature vs the spell).
// D&D Beyond doesn't flag the edition on a definition, but it does name the source book: 145 is the
// 2024 Player's Handbook, and every book after it (2024 DMG 146, Forge of the Artificer 191, …) is
// 2024-rules content while every earlier book has a lower id. Content with no source (homebrew) is
// taken as 2024, D&D Beyond's default, so a homebrew feat never picks up BOTH versions of a rule.
export type Edition = "2014" | "2024";
const FIRST_2024_SOURCE_ID = 145;

export interface SourcedDef {
  name?: string;
  sourceId?: number | null;
  sources?: Array<{ sourceId?: number | null } | null> | null;
}

export function editionOf(def: SourcedDef): Edition {
  const ids = [def.sourceId, ...(def.sources ?? []).map((s) => s?.sourceId)].filter((n): n is number => typeof n === "number" && n > 0);
  return !ids.length || ids.some((n) => n >= FIRST_2024_SOURCE_ID) ? "2024" : "2014";
}
