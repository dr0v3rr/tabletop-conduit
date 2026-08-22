// Shared roll contract — imported by BOTH the rules registry (src/rules) and the
// compose/output layer (src/compose, src/roll20). Owned by neither agent; do not
// redefine these types elsewhere.

export type RollTarget = "attack" | "damage" | "check" | "save" | "skill" | "initiative" | "cast" | "d20";

export type AdvantageMode = "normal" | "advantage" | "disadvantage" | "super-advantage" | "super-disadvantage";

/** An atomic, already-resolved modification a rule applies to a roll. The registry
 *  turns a toggled option (e.g. "Bless", "Sharpshooter") into one or more of these;
 *  the compose layer consumes them and never needs to know the rule's name. */
export type RuleEffect =
  | { op: "flat"; target: RollTarget; value: number; label?: string }              // +N / -N (Sharpshooter -5 atk / +10 dmg, etc.); target "d20" applies to every d20 roll (Exhaustion 2024)
  | { op: "add-dice"; target: "attack" | "damage" | "check" | "save"; dice: string; label?: string } // "1d4" (Bless), "2d6" (Sneak Attack), "1d4" (Guidance)
  | { op: "advantage"; target: "attack" | "check" | "save"; mode: "advantage" | "disadvantage" | "elven-accuracy"; label?: string }
  | { op: "reroll"; target: "attack" | "damage" | "d20"; threshold: number; label?: string }  // reroll dice <= threshold (Great Weapon Fighting ro<=2, Halfling Lucky ro=1; "d20" = every d20 kind)
  | { op: "min-die"; target: "damage"; min: number; label?: string }                  // treat each die as >= min
  | { op: "crit-range"; target: "attack"; range: number; label?: string }             // crit on d20 >= range (Champion 19-20)
  | { op: "reroll-keep-higher"; target: "damage"; label?: string };                   // Savage Attacker: reroll damage dice once, keep higher

/** A request to build one roll. `effects` are the resolved toggles from the registry. */
export interface RollRequest {
  kind: RollTarget;
  /** skill key (kebab, e.g. "perception"), ability ("INT"), or weapon/spell name */
  key?: string;
  advantage?: AdvantageMode;
  /** resolved rule effects (from src/rules resolveEffects); default [] */
  effects?: RuleEffect[];
  /** force critical damage for a damage roll */
  crit?: boolean;
  /** character name → matched against Roll20 #speakingas <option> text */
  speakingAs?: string;
  /** verb for a no-dice 'cast' announcement (default "Casts"; poke5e moves use "Uses"). */
  verb?: string;
  /** whisper to GM */
  whisper?: boolean;
  /** ad-hoc situational modifier added to the d20 (attack/check/save/skill/initiative). */
  adhocMod?: number;
  /**
   * Which Roll20 roll-template family to emit:
   *  - 'sheet'   → D&D-5e sheet templates (simple/atkdmg/spell). Prettier, but ONLY render
   *                if the campaign has the D&D 5e by Roll20 character sheet installed.
   *  - 'default' → universal &{template:default}; renders in ANY campaign. Advantage handled
   *                with 2d20kh1 / 2d20kl1 so the kept-die math is correct without a sheet.
   * composeRoll() defaults to 'sheet' (back-compat); the pipeline defaults to 'default'.
   */
  templateStyle?: "sheet" | "default";
  /** For kind:'attack' — base to-hit before effects (weapon/spell engine output). */
  baseAttackMod?: number;
  /** For kind:'attack'|'damage' — base damage formula, e.g. "1d8 + 2". */
  baseDamage?: string;
  /** Damage type label, e.g. "Slashing". */
  damageType?: string;
}
