// poke5e's Pokémon status conditions — a source-specific list for the sheet's condition dropdown.
//
// poke5e stores ONE status id per Pokémon (the `_status` column, written via update_pokemon). These
// ids and names come straight from poke5e's own client bundle. They are the classic Pokémon-game
// statuses, NOT D&D 5e conditions — so a Pokémon sheet shows this list instead of the D&D one. The
// non-volatile statuses are mutually exclusive; poke5e's single column means one status at a time.
// The Pokémon roll engine (statusMoveMods, paralysis saves, ability conditions) already reads the
// live status off `pokeMeta.status`, so setting it here lights those effects with no extra wiring.

export interface Poke5eStatus {
  id: string; // exact value stored in the `_status` column
  name: string; // display label
}

export const POKE5E_STATUSES: Poke5eStatus[] = [
  { id: "Asleep", name: "Asleep" },
  { id: "Burned", name: "Burned" },
  { id: "Frozen", name: "Frozen" },
  { id: "Paralysis", name: "Paralysis" },
  { id: "Poisoned", name: "Poisoned" },
  { id: "BadlyPoisoned", name: "Badly Poisoned" },
  { id: "Confused", name: "Confused" },
  { id: "Flinched", name: "Flinched" },
];

/** Friendly display name for a stored status id (falls back to the raw id for anything unknown). */
export function poke5eStatusName(id: string): string {
  return POKE5E_STATUSES.find((s) => s.id === id)?.name || id;
}
