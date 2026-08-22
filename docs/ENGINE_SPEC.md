# RollModel Engine Spec (Layers 1–2: static/deterministic)

Goal: compute a **RollModel** from a D&D Beyond `character-service/v5` character JSON
(`data` object). This is the deterministic tier — abilities, saves, skills, proficiency,
passives, spellcasting. Conditional/interactive effects (Tier 3) are NOT applied here; they
are *surfaced* for the rules registry (see below).

Reference implementations (Python, first-cut — port to TS but APPLY THE FIXES noted):
- `docs/reference-rollmodel.py` — score/save/skill computation
- `docs/reference-mechanics.py` — modifier taxonomy dump
Fixture: `test/fixtures/aldric-144074405.json` (Aldric, Artificer 8). Golden expected values
land in `test/fixtures/aldric-golden.json` (produced by the harvest agent — read it in tests).

## Data model (character-service v5 `data`)

- `stats` / `bonusStats` / `overrideStats`: arrays of `{id, value}`, `id` 1..6.
- **Stat id map:** `1=STR 2=DEX 3=CON 4=INT 5=WIS 6=CHA`.
- `classes`: `[{level, definition:{name}, subclassDefinition, ...}]`. Total level = sum of levels.
- `modifiers`: object bucketed by source — `race|class|background|item|feat|condition`,
  each a list of modifier objects.
- `choices`: resolves generic modifier subtypes (e.g. `choose-an-ability-score`) to concrete targets.
- `spells`, `classSpells`, `spellSlots`, `pactMagic`, `actions`, `inventory`, `feats`, `features`.

### Modifier object shape (fields we use)
`type` (bonus|proficiency|expertise|half-proficiency|advantage|disadvantage|set|damage|resistance|language|...),
`subType` (kebab, e.g. `perception`, `intelligence-saving-throws`, `intelligence-score`, `sleight-of-hand`, `magic`),
`value` (number|null), `dice` (`{diceString}`|null), `statId`, `componentId`, `restriction`
(TEXT condition — e.g. "to maintain concentration"), `friendlyTypeName`, `friendlySubtypeName`,
`isGranted`, `requiresAttunement`, `availableToMulticlass`, `entityId`/`entityTypeId`.

### Aldric's actual modifier taxonomy (ground truth for tests)
```
advantage: intelligence/wisdom/charisma/constitution-saving-throws, stealth
bonus:     intelligence-score(+2 race,+1 feat), wisdom-score(+1 race,+1 feat),
           sleight-of-hand(+5 item), hit-points(2d4+2 item), magic(+2 item), choose-an-ability-score(x4)
proficiency: sleight-of-hand, disguise-kit, light/medium-armor, shields, simple-weapons,
           thieves-tools, tinkers-tools, smiths-tools, investigation, perception, firearms,
           intelligence/constitution-saving-throws, woodcarvers-tools, insight, stealth, ...
set:       subclass, innate-speed-climbing
stealth-disadvantage: remove   (removes armor stealth disadvantage)
```

## Formulas

- **Ability score** = `stats[id]` + `bonusStats[id]` + Σ(`bonus` mods, subType `{ability}-score`).
  If `overrideStats[id]` set → that absolute value wins.
- **Ability mod** = `floor((score - 10) / 2)`.
- **Proficiency bonus** = `ceil(totalLevel / 4) + 1`  (Aldric L8 → +3).
- **Saving throw** = abilityMod + (proficient ? prof : 0) + Σ(`bonus` mods subType `{ability}-saving-throws`).
  Proficient if a `proficiency` mod exists for `{ability}-saving-throws`.
- **Skill** = abilityMod + profComponent + Σ(flat `bonus` mods whose subType == skill kebab).
  - profComponent: `expertise` → 2×prof, `proficiency` → 1×prof, `half-proficiency` → floor(prof/2), else 0.
  - **FIX (reference-rollmodel.py MISSED this):** add flat `bonus` mods to the skill —
    e.g. Aldric Sleight of Hand = DEX(+2) + prof(+3) + item(+5) = **+10**, not +5.
- **Advantage / disadvantage:** collect `advantage`/`disadvantage` mods per target as FLAGS with
  their `restriction` text. Do NOT fold into the number. If `restriction` is non-empty the effect is
  CONDITIONAL → mark it and emit into the conditional list (registry decides when to apply).
- **Passive Perception** = 10 + Perception skill total (+5 if unconditional advantage on Perception).
- **Initiative** = DEX mod + Σ(`bonus` mods subType `initiative`).
- **Spellcasting** (per class): ability = class spellcasting ability (Artificer=INT); save DC = 8 + prof + abilMod;
  spell attack = prof + abilMod.

## Skill → ability map (kebab subType → stat id)
acrobatics=2 animal-handling=5 arcana=4 athletics=1 deception=6 history=4 insight=5
intimidation=6 investigation=4 medicine=5 nature=4 perception=5 performance=6 persuasion=6
religion=4 sleight-of-hand=2 stealth=2 survival=5

## CRITICAL: conditional/lossy modifiers → do NOT apply blindly
Some modifiers look unconditional but aren't. Emit these into `RollModel.conditional[]` (with the
`restriction` text and source) instead of baking into base numbers. Examples in Aldric:
- War Caster: `advantage/constitution-saving-throws` is **concentration-only** (restriction text) — must
  NOT grant advantage on generic CON saves.
- Tool Expertise (class feature): "double prof for ability checks using a tool" — conditional, not global.
The rules registry (Layer 3, separate agent) consumes `conditional[]` and the interactive catalog.

## Output type (sketch — finalize in src/engine/types.ts)
```ts
interface RollModel {
  name: string; level: number; profBonus: number;
  abilities: Record<Ability, { score: number; mod: number }>;
  saves: Record<Ability, { mod: number; proficient: boolean; advantage?: Condition[] }>;
  skills: Record<SkillKey, { mod: number; ability: Ability; proficient: boolean; expertise: boolean; advantage?: Condition[] }>;
  passives: { perception: number; investigation: number; insight: number };
  initiative: number;
  spellcasting?: { ability: Ability; saveDc: number; attackBonus: number }[];
  conditional: Array<{ source: string; type: string; subType: string; restriction: string; value?: number }>;
}
```
Ability = 'STR'|'DEX'|'CON'|'INT'|'WIS'|'CHA'.

Keep the engine PURE (JSON in → RollModel out), no DOM/network, so it runs headless and in Electron.
