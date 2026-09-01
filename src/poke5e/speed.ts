// Movement speed for poke5e species. Pure + dependency-free so it's unit-testable and shared by the
// Pokédex, the loaded-pokémon sheet, and the main process.
//
// poke5e stores speed only on the SPECIES (pokemon.json), never on a caught-pokémon row — the
// pokemon table has no speed column (see POKEMON_PARAMS in source.ts). So a Pokémon's movement is
// always derived from its species. Each species carries an array of modes, e.g. Snivy is
// [{type:"walking",value:25},{type:"climbing",value:25}]; 128 species have no walking mode at all
// (Diglett → burrowing, Magnemite/Gastly → hover, some fish → swimming), and a handful have up to
// four (Koraidon: walking/swimming/climbing/flying).

export interface SpeedMode {
  type: string; // walking | flying | swimming | climbing | hover | burrowing
  value: number; // feet
}

/** Normalize a raw species `speed` array, dropping malformed / non-positive entries. */
export function parseSpeeds(raw: unknown): SpeedMode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s: any) => s && Number(s.value) > 0)
    .map((s: any) => ({ type: String(s.type || "walking"), value: Number(s.value) }));
}

/** The single number a sheet shows as "Speed": the walking mode if the species has one, otherwise
 *  its leading (fastest-listed) mode. Falls back only when a species has no speed data at all. */
export function primarySpeed(speeds: SpeedMode[], fallback = 30): number {
  const walk = speeds.find((s) => s.type === "walking");
  if (walk) return walk.value;
  return speeds[0]?.value ?? fallback;
}

/** "25 ft, climbing 25 ft" — walking is shown bare, other modes are prefixed with their type. */
export function formatSpeeds(speeds: SpeedMode[]): string {
  return speeds.map((s) => (s.type === "walking" ? `${s.value} ft` : `${s.type} ${s.value} ft`)).join(", ");
}

/** True when there's more than one movement mode (i.e. worth offering an expanded display). */
export function hasMultipleSpeeds(speeds: SpeedMode[]): boolean {
  return speeds.length > 1;
}
