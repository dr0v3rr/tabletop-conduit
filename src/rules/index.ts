// Layer-3 rules registry — public entry point.
export type { Rule, RuleKind } from "./types.js";
export { RULES, listAvailableToggles, resolveEffects } from "./registry.js";
