// Layer-3 rules registry — rule shape.
//
// A `Rule` is one roll-time option (feat / class feature / racial trait / generic
// effect). It knows whether a given character+roll can use it (`appliesTo`) and how
// to turn itself into concrete, already-resolved `RuleEffect`s (`toEffects`) that the
// compose layer consumes. The Rule never sends anything itself.

import type { RollRequest, RollTarget, RuleEffect } from "../shared/roll-types.js";
import type { CharacterData, RollModel } from "../engine/types.js";

/** The catalog `kind` tag — a coarse category from the Beyond20 analysis. */
export type RuleKind =
  | "attack-mod"
  | "damage-mod"
  | "add-dice"
  | "advantage"
  | "reroll"
  | "flat"
  | "save-mod";

export interface Rule {
  /** stable kebab id (matches the catalog / used by enabledToggleIds) */
  id: string;
  /** human-readable name shown in a UI */
  name: string;
  /** coarse catalog category */
  kind: RuleKind;
  /** the primary roll this rule modifies */
  target: RollTarget;
  /** true => user opt-in (shown as a toggle); false => automatic when it applies */
  toggle: boolean;
  /** human-readable applicability note (may stay a free string) */
  condition?: string;
  /**
   * Best-effort predicate: can THIS character use THIS rule on THIS roll?
   * Scans feats / class-features / racial-traits by name where possible; falls
   * back to permissive for purely situational, user-controlled toggles.
   */
  appliesTo(data: CharacterData, request: RollRequest): boolean;
  /**
   * Turn the rule into concrete atomic effects for this character+roll.
   * May return [] when the rule has no atomic representation for this roll.
   */
  toEffects(data: CharacterData, rollModel: RollModel, request: RollRequest): RuleEffect[];
}
