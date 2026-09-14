// poke5e PP-restore items (Ether family). These sit in a TRAINER's bag but restore PP on a
// Pokémon's move; the amounts/scopes come from poke5e's items.json descriptions.
//   scope "one" → restore a single chosen move; "all" → every move on the target Pokémon.

export interface PpItemSpec {
  restore: number; // PP restored
  scope: "one" | "all";
}

export const PP_ITEMS: Record<string, PpItemSpec> = {
  "ether": { restore: 5, scope: "one" },
  "max-ether": { restore: 10, scope: "one" },
  "elixir": { restore: 5, scope: "all" },
  "max-elixir": { restore: 10, scope: "all" },
  "leppa-berry": { restore: 10, scope: "one" },
};

/** The PP-restore spec for a poke5e item id, or null if the item doesn't restore PP. */
export function ppItemSpec(itemId: string | null | undefined): PpItemSpec | null {
  return itemId ? PP_ITEMS[itemId] ?? null : null;
}

/** New PP after applying a restore amount, clamped to [0, max]. */
export function restoredPp(cur: number, max: number, amount: number): number {
  return Math.min(max, Math.max(0, cur) + Math.max(0, amount));
}

/** A short human label for an item's effect, e.g. "+5 PP to one move" / "+10 PP to all moves". */
export function ppItemEffect(spec: PpItemSpec): string {
  return `+${spec.restore} PP to ${spec.scope === "all" ? "all moves" : "one move"}`;
}
