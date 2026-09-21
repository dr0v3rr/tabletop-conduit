// Per-move mechanic overlay for poke5e moves whose behaviour the base engine can't infer from the
// structured data. Two things are applied:
//   • a PATCH to the raw move data (before moveStat computes) — for deterministic re-renders: a heal
//     whose dice live only in prose, a flat/level fixed damage, a bogus to-hit that should be a save /
//     self-buff / guaranteed hit, or a fixed multi-hit count.
//   • a NOTE surfaced prominently when the move is used — the exact rule the engine cannot auto-apply
//     (damage that scales with runtime state, counter/redirect, fractional-HP, OHKO outcome, the
//     "roll a d4 to keep hitting" chains). We never fabricate a number we can't know; we state the rule.
// Keyed by the poke5e move id (kebab). Sourced from the move-coverage audit + each move's rules text.

export interface MoveFix {
  /** Raw-data patch merged into the move BEFORE moveStat runs. */
  patch?: {
    /** Replace the move's damage block (dice map + modifier tokens + type). type:["healing"] → a heal. */
    damage?: { dice: Record<string, string>; modifier: string | number; type: string[] };
    /** Remove the damage entirely. */
    damageNull?: boolean;
    /** Strip the to-hit (re-render as save / utility / guaranteed-hit). */
    removeAttack?: boolean;
    /** Strip the save block. */
    removeSave?: boolean;
  };
  /** FIXED number of separate attack rolls the move makes (Swift = 2, Population Bomb = 10). */
  attacks?: number;
  /** The move never misses (guaranteed hit). */
  autoHit?: boolean;
  /** Suppress STAB — the move deals FIXED damage independent of the user (Seismic Toss, Sonic Boom). */
  noStab?: boolean;
  /** One-sentence rule reminder shown when the move is used (what the engine does NOT apply). */
  note: string;
}

// NOTE: populated from the authoring pass. Keyed by move id.
export const MOVE_FIXES: Record<string, MoveFix> = {
  "arm-thrust": { note: "On a hit deal 1d4+MOVE fighting damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 fighting damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "bone-rush": { note: "On a hit deal 1d4+MOVE ground damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 ground damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "bullet-seed": { note: "On a hit deal 1d4+MOVE grass damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 grass damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "comet-punch": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "barrage": { note: "Make one ranged attack; on a hit roll 1d4 to determine the number of projectiles, and each projectile deals 1d4 normal damage." },
  "beat-up": { note: "Make one melee attack plus one additional separate attack for each other conscious creature your trainer is currently carrying, dealing 2d6 dark damage on each hit." },
  "double-slap": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "fury-attack": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "fury-swipes": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "icicle-spear": { note: "On a hit deal 1d4+MOVE ice damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 ice damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "pin-missile": { note: "On a hit deal 1d4+MOVE bug damage, then roll a d4; on a 3 or 4 another projectile hits again for an additional 1d4 bug damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "rock-blast": { note: "On a hit deal 1d4+MOVE rock damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 rock damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "spike-cannon": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "tail-slap": { note: "On a hit deal 1d4+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "thrash": { note: "On a hit deal 1d10+MOVE normal damage, then roll a d4; on a 3 or 4 immediately hit again for an additional 1d10 normal damage, up to a maximum of two additional hits, and you become confused at the end of the attack." },
  "water-shuriken": { note: "Base hit is 1d4 + MOVE; after a successful hit roll a d4, and on a 3 or 4 it hits again for an additional 1d4 water damage, repeating up to 4 extra times." },
  "dragon-energy": { note: "Deal an additional 1d6 dragon damage for every 20 HP you currently have (excluding temporary HP)." },
  "electro-ball": { note: "Compare your highest speed to the target's highest speed; if yours is higher, roll the next damage tier up (at level 17+ double the damage dice instead)." },
  "flail": { note: "Double the damage if you are below 50% of your maximum HP, or triple it if at 10% or below, applied before any resistance or vulnerability multiplier." },
  "fling": { note: "On a hit the dark damage equals the flung item's manual price divided by 100 (rounded down) plus STAB, and certain items apply a status (Flame Orb burns, Toxic Orb badly poisons, Light Ball paralyzes, King's Rock/Razor Fang flinch, Poison Barb poisons); the item is consumed on hit or miss." },
  "last-respects": { note: "Increase the damage dice by 2d6 for each of your currently downed allies this combat, up to a maximum of 10d6." },
  "magnitude": { note: "Roll a d100 to set the damage (1-5: 1d4+MOVE, 6-15: 1d8+MOVE, 16-35: 1d10+MOVE, 36-65: 1d12+MOVE, 66-85: 2d6+MOVE, 86-95: 2d8+MOVE, 96-100: 2d12+MOVE) for a DEX save (half on success); burrowed/Dig targets take double, raised creatures are immune." },
  "payback": { note: "Double the damage if the target has dealt any damage to you since the end of your last turn." },
  "power-trip": { note: "Add one additional damage die for each unique stat change currently affecting the user." },
  "power-up-punch": { note: "Add one additional damage die for each consecutive successful hit against the same creature (max double the base dice); the count resets on a miss or when targeting a different creature." },
  "punishment": { note: "Add one additional damage die for each active effect boosting the target's attack, damage, or AC." },
  "rage-fist": { note: "Deal 1 additional damage for every 10 points of HP you are currently below your maximum HP." },
  "return": { note: "Add a bonus to both the attack roll and damage equal to the number of levels you are above zero on the Loyalty Chart." },
  "reversal": { note: "Double the damage if you are below 50% of your maximum HP, or triple it if at 10% or below, applied before any resistance or vulnerability multiplier." },
  "rollout": { note: "This shows the first hit only; on consecutive rounds double the dice on each successful attack (1d6, 2d6, 4d6, 8d6, 16d6, max 5 attacks), resetting if an attack fails to damage, your speed drops to 0, or you are incapacitated." },
  "skitter-smack": { note: "If the attack is made with advantage (or you have an adjacent non-incapacitated ally and no disadvantage), add Xd6 bug damage where X is your level divided by two, rounded up." },
  "smelling-salts": { note: "Double the rolled damage dice if the target is paralyzed." },
  "snipe-shot": { note: "Double the rolled damage dice if the attack was made with advantage." },
  "spit-up": { note: "Double the rolled dice if two rounds of energy were Stockpiled, or triple them if three rounds were Stockpiled." },
  "stomping-tantrum": { note: "Double the rolled damage dice if your last attack missed." },
  "stored-power": { note: "Add one additional damage die of the current tier for each distinct stat-changing effect active on the user." },
  "bide": { note: "On your next turn deal typeless damage equal to double the total damage you took since activating Bide (a ranged attack that must hit)." },
  "foul-play": { patch: { damage: { dice: {"1": "2d8"}, modifier: 0, type: ["dark"] } }, note: "Add the target's level to the 2d8 dark damage (the to-hit uses your MOVE power)." },
  "night-shade": { patch: { damage: { dice: {"1": "1d6"}, modifier: "LEVEL", type: ["ghost"] } }, noStab: true, note: "Damage is a flat 1d6 + your trainer level at all levels (no dice scaling, no STAB)." },
  "seismic-toss": { patch: { damage: { dice: {"1": "1d6"}, modifier: "LEVEL", type: ["fighting"] } }, noStab: true, note: "Damage is a flat 1d6 + your trainer level at all levels (no STAB), and this move scores a critical hit on a roll of 19 or 20." },
  "sonic-boom": { patch: { damage: { dice: {"1": "16"}, modifier: 0, type: ["normal"] } }, noStab: true, note: "The 16 damage is fixed and cannot be modified by STAB, resistance, bonus damage, or damage reduction (only immunity prevents it); a successful CON save halves it." },
  "endeavor": { note: "On a failed WIS save the target's current HP is reduced to equal your own, but the reduction can be no more than 5x the target's level, and this move cannot be used in the first round of combat." },
  "final-gambit": { note: "You faint on use; on a failed CON save the target takes fighting damage equal to your remaining HP (plus STAB if applicable), or half as much on a success." },
  "metal-burst": { note: "As a reaction to being hit by a damaging melee attack, make a melee attack with disadvantage that on a hit deals steel damage equal to the damage that hit dealt you, capped at 5x your current level." },
  "mirror-coat": { note: "Reduce the incoming ranged attack's damage by 1d6 + MOVE, and only if that reduces it below zero may you make a ranged attack to reflect 1d6 + MOVE psychic damage back at the attacker." },
  "revenge": { note: "Make the retaliatory melee attack roll with disadvantage; on a hit deal fighting damage equal to the amount of damage the triggering melee attack dealt to you, capped at 5x your current level." },
  "natures-madness": { note: "On a failed CON save the target loses half its current HP (minimum 1) directly — this is not rolled damage." },
  "pain-split": { note: "On a failed CON save, set both you and the target's current HP to the average of your two current HP totals (if that exceeds either's HP maximum, use that maximum instead)." },
  "ruination": { note: "On a failed CON save the target loses half of its current HP and its HP maximum is reduced by that same amount." },
  "floral-healing": { patch: { damage: { dice: {"1": "2d8"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals 2d8 + MOVE HP; if the terrain is grassy, double the MOVE modifier." },
  "milk-drink": { patch: { damage: { dice: {"1": "2d6"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals the recipient (self or ally) for 2d6 + MOVE HP." },
  "moonlight": { patch: { damage: { dice: {"1": "2d12"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals the user for 2d12 + MOVE HP; if activated during the day, halve the total healing." },
  "morning-sun": { patch: { damage: { dice: {"1": "2d12"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals the user for 2d12 + MOVE HP; if activated at night, halve the total healing." },
  "roost": { patch: { damage: { dice: {"1": "2d6"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "The healing (2d6 + MOVE HP) only occurs at the start of your next turn if you are still grounded; while grounded your flying speed is 0 and you lose your flying type." },
  "shore-up": { patch: { damage: { dice: {"1": "2d8"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals 2d8 + MOVE HP; if used during a Sandstorm, double the MOVE modifier." },
  "synthesis": { patch: { damage: { dice: {"1": "1d12"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals yourself for 1d12 + MOVE HP; if activated in harsh sunlight, double the healing dice (2d12)." },
  "swift": { attacks: 2, note: "Fires two auto-hitting projectiles (choose targets freely); roll damage separately for each, and it can strike targets in the invulnerable stage of Dig/Fly/Bounce, etc." },
  "tachyon-cutter": { attacks: 2, note: "Guaranteed to hit twice; roll the damage separately for each hit, unless the target is in the invulnerable stage of Fly/Dig/Bounce/Dive, etc." },
  "hyperspace-fury": { attacks: 3, note: "Auto-deals damage with each of three balls (choose targets freely) and cannot be negated by Protect/Detect; afterward, attacks against you are made at advantage until the start of your next turn." },
  "population-bomb": { patch: { damage: { dice: {"1": "1"}, modifier: "MOVE", type: ["normal"] } }, attacks: 10, note: "Make 10 separate melee attack rolls against the target; each hit deals 1 + MOVE normal damage." },
  "outrage": { patch: { damage: { dice: {"1": "1d6"}, modifier: "MOVE", type: ["dragon"] }, removeAttack: true, removeSave: true }, autoHit: true, note: "Round 1 shown (auto-hit 1d6 + MOVE dragon); it escalates to 2d6 + MOVE round 2 and 4d6 + MOVE round 3, after which — or on breaking concentration — the user becomes confused." },
  "fissure": { note: "Roll a d20; only on a natural 20 does the target fall into the abyss and faint (no effect otherwise, against flyers, or if the target's level is 10+ above yours) — this deals no damage." },
  "guillotine": { note: "Roll a d20; only on a natural 20 does the target instantly faint (no effect otherwise, or if the target's level is 10+ above yours) — this deals no damage." },
  "horn-drill": { note: "Roll a d20; only on a natural 20 is the target impaled and immediately faints (miss otherwise, or automatic fail if the target's level is 10+ above yours) — this deals no damage." },
  "sheer-cold": { note: "Roll a d20; only on a natural 20 does the target faint (no effect otherwise, or if the target's level is 10+ above yours) — this deals no damage." },
  "explosion": { note: "Roll a d20; only on a natural 20 do all creatures within 5 feet of the chosen point faint (fizzles otherwise, or auto-fails if the target's level is 10+ above yours or their SR is 15) — this deals no damage." },
  "baneful-bunker": { patch: { damageNull: true, removeAttack: true }, note: "The first use each combat automatically negates the triggering attack's damage (and poisons the attacker if it was melee); every later use this combat only succeeds if you roll higher than 15 on a d20." },
  "kinesis": { patch: { damageNull: true, removeAttack: true }, note: "Utility with no attack or damage: increase one nonzero movement speed by 20 and gain +2 AC against ranged attacks for the duration; cannot be stacked." },
  "hyperspace-hole": { patch: { removeAttack: true }, autoHit: true, note: "Guaranteed hit (no attack roll); damage-negating reactions such as Protect or Detect cannot prevent it." },
  "torment": { patch: { damageNull: true, removeAttack: true }, note: "No attack or damage: the attacker that hit you makes a WIS save vs your Move DC, and on a failure cannot use that same move on its next turn." },
  "withdraw": { patch: { damageNull: true, removeAttack: true }, note: "No attack or damage: as a reaction increase your AC by +2, effective only if it would cause the triggering attack to miss." },
  "curse": { note: "Ghost-type only: target makes a WIS save vs your Move DC, on a fail you take 1d6 immediately and the target takes 1d6 ghost damage at the end of each of its turns for the duration; any other type instead buffs yourself (+2 STR and CON, -4 DEX) with no save or damage." },
};

/** Apply a fix's raw-data patch to a move BEFORE moveStat computes. Returns the move unchanged when
 *  there is no patch. Never mutates the input. */
export function patchMoveData(move: any): any {
  const id = move && move.id != null ? String(move.id) : "";
  const fix = MOVE_FIXES[id];
  if (!fix || !fix.patch) return move;
  const p = fix.patch;
  const m = { ...move };
  if (p.damageNull) delete m.damage;
  else if (p.damage) m.damage = p.damage;
  if (p.removeAttack) delete m.attack;
  if (p.removeSave) delete m.save;
  return m;
}

/** The fix metadata (attacks / autoHit / note) for a move id — applied AFTER moveStat computes. */
export function moveFix(id: unknown): MoveFix | undefined {
  return id == null ? undefined : MOVE_FIXES[String(id)];
}
