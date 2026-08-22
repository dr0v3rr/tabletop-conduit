// poke5e Pokémon FEAT rules-engine — the feat counterpart to abilities-engine.ts. A Pokémon's feats
// are stored by name only (get_pokemon_feats); their text comes from poke5e's /reference/feats. Of
// the 14 Pokémon feats, most affect AC / PP / stats / status / mounting (no roll effect); these are
// the ones that touch a MOVE roll. Effects reuse the AbilityMod shape so they render/apply exactly
// like ability mods (⚡ badge + notes, numeric bakes).
import type { AbilityMod } from "./abilities-engine";

// Multi-hit "combo" moves (same list the Skill Link ability uses) — Combo Master guarantees ≥2 hits.
const MULTIHIT = /bullet seed|rock blast|pin missile|icicle spear|bone rush|tail slap|arm thrust|double slap|fury swipes|spike cannon|comet punch|barrage|fury attack|water shuriken|scale shot|triple axel|triple kick|population bomb|double kick|double hit|dual chop|dual wingbeat|twineedle|gear grind|bonemerang|surging strikes/i;

/** Feat modifiers that apply to a given move. `pb` is the proficiency bonus. `scope` is the move's
 *  attack scope ("melee"/"ranged"), `powerHasStr` whether STR is one of the move's power options. */
export function moveFeatMods(
  feats: string[],
  move: { casting: "attack" | "save" | "utility"; name?: string; scope?: string; powerHasStr?: boolean; hasDamage?: boolean },
  ctx: { pb: number },
): AbilityMod[] {
  const names = new Set(feats.map((f) => String(f || "").trim().toLowerCase()));
  const has = (n: string) => names.has(n.toLowerCase());
  const out: AbilityMod[] = [];
  const name = String(move.name || "");
  const atk = move.casting === "attack";
  const dmg = move.hasDamage !== false;

  // Combo Master — multi-hit moves are guaranteed to hit at least twice.
  if (has("Combo Master") && MULTIHIT.test(name)) {
    out.push({ ability: "Combo Master", cond: "always", note: "multi-hit: at least 2 hits land" });
  }
  // Melee Master — +PB damage when you hit with a melee STR-power move (as part of the Attack action).
  if (has("Melee Master") && atk && dmg && move.scope === "melee" && move.powerHasStr) {
    out.push({ ability: "Melee Master", cond: "always", damageAdd: ctx.pb });
  }
  // Ranged Master — ranged attacks ignore cover and take no disadvantage from being in melee range.
  if (has("Ranged Master") && atk && move.scope === "ranged") {
    out.push({ ability: "Ranged Master", cond: "always", note: "ignores half/¾ cover; no disadvantage in melee range" });
  }
  // Terrain Adept — +3 to hit while on your chosen terrain (we can't know the terrain, so remind).
  if (has("Terrain Adept") && atk) {
    out.push({ ability: "Terrain Adept", cond: "always", note: "+3 to hit while on your chosen terrain" });
  }
  // Wrangler — advantage on attacks against a creature you have grappled.
  if (has("Wrangler") && atk) {
    out.push({ ability: "Wrangler", cond: "always", note: "advantage vs a creature you've grappled" });
  }
  return out;
}
