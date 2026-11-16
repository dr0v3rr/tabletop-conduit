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
    /** Damage to use only when the data has none (older data kept these dice only in prose; poke5e's
     *  SRD now carries them, and a 2024-edition change must win over this copy). */
    fallbackDamage?: { dice: Record<string, string>; modifier: string | number; type: string[] };
    /** Remove the damage entirely. */
    damageNull?: boolean;
    /** Strip the to-hit (re-render as save / utility / guaranteed-hit). */
    removeAttack?: boolean;
    /** Strip the save block. */
    removeSave?: boolean;
    /** Add a to-hit the data lacks (Focus Punch's "make an attack roll"). */
    attack?: { scope: string };
    /** Add a save the data lacks (Electrify / Spore: "the attacker makes a CON save"). */
    save?: { attribute: string[] };
  };
  /** FIXED number of separate attack rolls the move makes (Population Bomb = 10), or a count that
   *  grows with level, keyed like the damage dice (Swift: 2, then 4 at level 5, 5 at 10, 6 at 17). */
  attacks?: number | Record<string, number>;
  /** The move never misses (guaranteed hit). */
  autoHit?: boolean;
  /** Suppress STAB — the move deals FIXED damage independent of the user (Seismic Toss, Sonic Boom). */
  noStab?: boolean;
  /** Don't surface a use-time die from the prose: the "roll a dN" in the description is a REACTIVE /
   *  conditional mechanic (e.g. Double Team's duplicate absorbs on a later d4), not something to roll
   *  when the move is used — so the move stays a display-only utility that just announces + spends PP. */
  noRollDie?: boolean;
  /** A die to roll when there's no damage to roll (Magnitude's d100, Sing's hit-point pool, Spite's PP
   *  drain), optionally per level like the damage dice. */
  rollDie?: string | Record<string, string>;
  /** What that die is for, shown on the card ("self-damage", "PP drained") — default "roll". */
  rollLabel?: string;
  /** Extra dice the card rolls alongside the main roll, each as its own labelled line (a status d6, the
   *  d20 for a later Protect, Hidden Power's type) — dice per level like the damage, when it scales. */
  extraRolls?: { label: string; dice: string | Record<string, string> }[];
  /** The move's own attack roll is made with advantage (Dig, Fly, Feint Attack …) or disadvantage
   *  (Metal Burst, Revenge). */
  advantage?: "advantage" | "disadvantage";
  /** Hits after the first deal only the dice — MOVE is added once (Scale Shot). */
  moveOnce?: boolean;
  /** The move also deals the same dice + MOVE of a second, chosen type (Draco Power) — rolled as an
   *  extra line labelled with the choice. */
  secondDamage?: string;
  /** The hits may land on different creatures (the STAB-per-target reminder applies). */
  multiTarget?: boolean;
  /** Don't read a crit range from the wording (Triple Arrows' 19-20 is the first arrow only). */
  noCritRange?: boolean;
  /** One-sentence rule reminder shown when the move is used (what the engine does NOT apply). */
  note: string;
}

// NOTE: populated from the authoring pass. Keyed by move id.
export const MOVE_FIXES: Record<string, MoveFix> = {
  "arm-thrust": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 fighting damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "bone-rush": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 ground damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "bullet-seed": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 grass damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "comet-punch": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "double-team": { noRollDie: true, note: "Creates a duplicate image. Nothing to roll on use — when you're later hit by a ≤5-ft attack/save, roll a d4; on a 3 or 4 the image absorbs it and disappears. (Reuse for up to 3 images; 2 images → attacker needs 5-6 on a d6, 3 → 7-8 on a d8.)" },
  "barrage": { note: "This rolls one projectile's damage; on a hit roll 1d4 for the number of projectiles, each dealing that much normal damage (roll it for each)." },
  "beat-up": { note: "Make one melee attack plus one additional separate attack for each other conscious creature your trainer is currently carrying, dealing 2d6 dark damage on each hit." },
  "double-slap": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "fury-attack": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "fury-swipes": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "icicle-spear": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 ice damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "pin-missile": { note: "After this hit, roll a d4; on a 3 or 4 another projectile hits again for an additional 1d4 bug damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "rock-blast": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 rock damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "spike-cannon": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "tail-slap": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d4 normal damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "thrash": { note: "After this hit, roll a d4; on a 3 or 4 immediately hit again for an additional 1d10 normal damage, up to a maximum of two additional hits, and you become confused at the end of the attack." },
  "water-shuriken": { note: "After this hit, roll a d4; on a 3 or 4 another shuriken strikes for an additional 1d4 water damage, repeating until you fail the d4 roll, up to a maximum of four additional hits." },
  "dragon-energy": { note: "Deal an additional 1d6 dragon damage for every 20 HP you currently have (excluding temporary HP)." },
  "electro-ball": { note: "Compare your highest speed to the target's highest speed; if yours is higher, roll the next damage tier up (at level 17+ double the damage dice instead)." },
  "flail": { note: "Double the damage if you are below 50% of your maximum HP, or triple it if at 10% or below, applied before any resistance or vulnerability multiplier." },
  "fling": { note: "On a hit the dark damage equals the flung item's manual price divided by 100 (rounded down) plus STAB, and certain items apply a status (Flame Orb burns, Toxic Orb badly poisons, Light Ball paralyzes, King's Rock/Razor Fang flinch, Poison Barb poisons); the item is consumed on hit or miss." },
  "last-respects": { note: "Increase the damage dice by 2d6 for each of your currently downed allies this combat, up to a maximum of 10d6." },
  "magnitude": { patch: { damageNull: true }, rollDie: "1d100", note: "The d100 sets the damage for this DEX save (half on success): 1-5: 1d4, 6-15: 1d8, 16-35: 1d10, 36-65: 1d12, 66-85: 2d6, 86-95: 2d8, 96-100: 2d12, + MOVE ground damage (+ STAB if Ground-type). Multiply the number of dice by 2 at level 5, 3 at level 10, 4 at level 17 (e.g. 2d6 → 4d6). Burrowed/Dig targets take double; raised creatures are immune." },
  "payback": { note: "Double the damage if the target has dealt any damage to you since the end of your last turn." },
  "power-trip": { note: "Add one additional damage die for each unique stat change currently affecting the user." },
  "power-up-punch": { note: "Add one additional damage die for each consecutive successful hit against the same creature (max double the base dice); the count resets on a miss or when targeting a different creature." },
  "punishment": { note: "Add one additional damage die for each active effect boosting the target's attack, damage, or AC." },
  "rage-fist": { note: "Deal 1 additional damage for every 10 points of HP you are currently below your maximum HP." },
  "return": { note: "Add a bonus to both the attack roll and damage equal to the number of levels you are above zero on the Loyalty Chart." },
  "reversal": { note: "Double the damage if you are below 50% of your maximum HP, or triple it if at 10% or below, applied before any resistance or vulnerability multiplier." },
  "rollout": { note: "This rolls the first hit (one die); on consecutive rounds double the number of dice on each successful attack (1, 2, 4, 8, then 16 dice — max 5 attacks), resetting if an attack fails to damage, your speed drops to 0, or you are incapacitated." },
  "skitter-smack": { note: "If the attack is made with advantage (or you have an adjacent non-incapacitated ally and no disadvantage), add Xd6 bug damage where X is your level divided by two, rounded up." },
  "smelling-salts": { note: "Double the rolled damage dice if the target is paralyzed." },
  "snipe-shot": { note: "Double the rolled damage dice if the attack was made with advantage." },
  "spit-up": { note: "Double the rolled dice if two rounds of energy were Stockpiled, or triple them if three rounds were Stockpiled." },
  "stomping-tantrum": { note: "Double the rolled damage dice if your last attack missed." },
  "stored-power": { note: "Add one additional damage die of the current tier for each distinct stat-changing effect active on the user." },
  "bide": { note: "On your next turn deal typeless damage equal to double the total damage you took since activating Bide (a ranged attack that must hit)." },
  "foul-play": { patch: { fallbackDamage: { dice: {"1": "2d8", "5": "2d10", "10": "3d10", "17": "4d12"}, modifier: 0, type: ["dark"] } }, note: "Add the target's level to this dark damage (the to-hit uses your MOVE power)." },
  "night-shade": { noStab: true, note: "Damage is the dice + your level (no MOVE modifier, no STAB)." },
  "seismic-toss": { noStab: true, note: "Damage is the dice + your level (no MOVE modifier, no STAB), and this move scores a critical hit on a roll of 19 or 20." },
  "sonic-boom": { patch: { damage: { dice: {"1": "16"}, modifier: 0, type: ["normal"] } }, noStab: true, note: "The 16 damage is fixed and cannot be modified by STAB, resistance, bonus damage, or damage reduction (only immunity prevents it); a successful CON save halves it." },
  "endeavor": { note: "On a failed WIS save the target's current HP is reduced to equal your own, but the reduction can be no more than 5x the target's level, and this move cannot be used in the first round of combat." },
  "final-gambit": { note: "You faint on use; on a failed CON save the target takes fighting damage equal to your remaining HP (plus STAB if applicable), or half as much on a success." },
  "metal-burst": { advantage: "disadvantage", note: "As a reaction to being hit by a damaging melee attack, make a melee attack with disadvantage that on a hit deals steel damage equal to the damage that hit dealt you, capped at 5x your current level." },
  "mirror-coat": { note: "Reduce the incoming ranged attack's damage by 1d6 + MOVE, and only if that reduces it below zero may you make a ranged attack to reflect 1d6 + MOVE psychic damage back at the attacker." },
  "revenge": { advantage: "disadvantage", note: "Make the retaliatory melee attack roll with disadvantage; on a hit deal fighting damage equal to the amount of damage the triggering melee attack dealt to you, capped at 5x your current level." },
  "natures-madness": { note: "On a failed CON save the target loses half its current HP (minimum 1) directly — this is not rolled damage." },
  "pain-split": { note: "On a failed CON save, set both you and the target's current HP to the average of your two current HP totals (if that exceeds either's HP maximum, use that maximum instead)." },
  "ruination": { note: "On a failed CON save the target loses half of its current HP and its HP maximum is reduced by that same amount." },
  "floral-healing": { patch: { fallbackDamage: { dice: {"1": "2d8", "5": "2d10", "10": "3d10", "17": "4d12"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals the target; if the terrain is grassy, double the MOVE modifier." },
  "milk-drink": { patch: { fallbackDamage: { dice: {"1": "2d6", "5": "3d6", "10": "5d6", "17": "8d6"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals the recipient (yourself or an ally)." },
  "moonlight": { patch: { fallbackDamage: { dice: {"1": "2d12", "5": "3d10", "10": "7d6", "17": "8d8"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals yourself; if activated during the day, halve the total healing." },
  "morning-sun": { patch: { fallbackDamage: { dice: {"1": "2d12", "5": "3d10", "10": "7d6", "17": "8d8"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals yourself; if activated at night, halve the total healing." },
  "roost": { patch: { fallbackDamage: { dice: {"1": "2d6", "5": "3d6", "10": "5d6", "17": "8d6"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "The healing only happens at the start of your next turn if you are still on the ground; until you leave the ground your flying speed is 0 and you lose your flying type." },
  "shore-up": { patch: { fallbackDamage: { dice: {"1": "2d8", "5": "2d10", "10": "3d10", "17": "4d12"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals yourself; if used during a Sandstorm, double the MOVE modifier." },
  "synthesis": { patch: { fallbackDamage: { dice: {"1": "1d12", "5": "2d8", "10": "2d12", "17": "6d6"}, modifier: "MOVE", type: ["healing"] }, removeAttack: true, removeSave: true }, note: "Heals yourself; if activated in harsh sunlight, double the healing dice." },
  "swift": { attacks: {"1": 2, "5": 4, "10": 5, "17": 6}, note: "Fires auto-hitting projectiles (2; 4 at level 5, 5 at level 10, 6 at level 17) at any creatures you choose — roll each separately; it also strikes targets in the invulnerable stage of Dig/Fly/Bounce, etc." },
  "tachyon-cutter": { attacks: 2, note: "Guaranteed to hit twice; roll the damage separately for each hit, unless the target is in the invulnerable stage of Fly/Dig/Bounce/Dive, etc." },
  "hyperspace-fury": { attacks: {"1": 3, "5": 4, "10": 5, "17": 6}, note: "Each ball (3; 4 at level 5, 5 at level 10, 6 at level 17) automatically deals its damage to any creatures you choose and can't be negated by Protect/Detect; afterward, attacks against you have advantage until the start of your next turn." },
  "population-bomb": { patch: { damage: { dice: {"1": "1"}, modifier: "MOVE", type: ["normal"] } }, attacks: 10, note: "Make 10 separate melee attack rolls against the target; each hit deals 1 + MOVE normal damage." },
  "outrage": { patch: { fallbackDamage: { dice: {"1": "Rd6", "5": "Rd8", "10": "Rd10", "17": "Rd12"}, modifier: "MOVE", type: ["dragon"] }, removeAttack: true, removeSave: true }, autoHit: true, note: "Round 1 shown (auto-hit, one die + MOVE dragon); round 2 rolls two dice and round 3 four dice + MOVE, after which — or on breaking concentration — the user becomes confused." },
  "fissure": { note: "Roll a d20; only on a natural 20 does the target fall into the abyss and faint (no effect otherwise, against flyers, or if the target's level is 10+ above yours) — this deals no damage." },
  "guillotine": { note: "Roll a d20; only on a natural 20 does the target instantly faint (no effect otherwise, or if the target's level is 10+ above yours) — this deals no damage." },
  "horn-drill": { note: "Roll a d20; only on a natural 20 is the target impaled and immediately faints (miss otherwise, or automatic fail if the target's level is 10+ above yours) — this deals no damage." },
  "sheer-cold": { note: "Roll a d20; only on a natural 20 does the target faint (no effect otherwise, or if the target's level is 10+ above yours) — this deals no damage." },
  "explosion": { note: "Roll a d20; only on a natural 20 do all creatures within 5 feet of the chosen point faint (fizzles otherwise, or auto-fails if the target's level is 10+ above yours or their SR is 15) — this deals no damage." },
  "baneful-bunker": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], patch: { damageNull: true, removeAttack: true }, note: "The first use each combat automatically negates the triggering attack's damage (and poisons the attacker if it was melee); every later use this combat only succeeds if you roll higher than 15 on a d20." },
  "kinesis": { patch: { damageNull: true, removeAttack: true }, note: "Utility with no attack or damage: increase one nonzero movement speed by 20 and gain +2 AC against ranged attacks for the duration; cannot be stacked." },
  "hyperspace-hole": { patch: { removeAttack: true }, autoHit: true, note: "Guaranteed hit (no attack roll); damage-negating reactions such as Protect or Detect cannot prevent it." },
  "torment": { patch: { damageNull: true, removeAttack: true }, note: "No attack or damage: the attacker that hit you makes a WIS save vs your Move DC, and on a failure cannot use that same move on its next turn." },
  "withdraw": { patch: { damageNull: true, removeAttack: true }, note: "No attack or damage: as a reaction increase your AC by +2 (+3 at level 10 and above), only if that would cause the triggering attack to miss." },
  "curse": { note: "Ghost-type only: target makes a WIS save vs your Move DC, on a fail you take 1d6 immediately and the target takes 1d6 ghost damage at the end of each of its turns for the duration; any other type instead buffs yourself (+2 STR and CON, -4 DEX) with no save or damage." },
  "bounce": { advantage: "advantage", note: "Turn 1 you bounce up, out of reach. This card is the slam on your next turn, rolled with advantage; on a natural 15+ the target is paralyzed." },
  "dig": { advantage: "advantage", note: "Turn 1 you burrow (immune to moves). This card is the strike on your next turn, rolled with advantage — but roll normally against a target with Tremorsense." },
  "dive": { advantage: "advantage", note: "Turn 1 you vanish below (immune to moves). This card is the attack on your next turn, rolled with advantage." },
  "fly": { advantage: "advantage", note: "Turn 1 you fly up out of reach (immune to moves). This card is the dive on your next turn, rolled with advantage." },
  "phantom-force": { advantage: "advantage", note: "Turn 1 you turn invisible and can't be targeted. This card is the attack on your next turn, rolled with advantage; Protect and Detect can't stop it." },
  "shadow-force": { advantage: "advantage", note: "Turn 1 you turn invisible and can't be targeted. This card is the attack on your next turn, rolled with advantage; Protect and Detect can't stop it." },
  "feint-attack": { advantage: "advantage", note: "This melee attack is made with advantage." },
  "glaive-rush": { advantage: "advantage", note: "Rolled with advantage; until the start of your next turn, attack rolls against you have advantage." },
  "electrify": { patch: { removeAttack: true, save: { attribute: ["con"] } }, note: "Reaction when hit by a melee attack: the attacker makes a CON save; on a failure its attacking move becomes electric-type." },
  "spore": { patch: { removeAttack: true, save: { attribute: ["con"] } }, note: "Reaction when targeted by a melee attack: the attacker makes a CON save or falls asleep." },
  "spiky-shield": { patch: { removeAttack: true }, extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Reaction when hit by a melee attack: ignore its damage, and the attacker takes grass damage equal to your proficiency bonus. The first use each combat is automatic; later uses need a d20 above 15." },
  "burning-bulwark": { patch: { removeAttack: true }, note: "Flames wreathe you for the duration. Roll this damage when a creature hits you with a melee attack — the attacker takes it." },
  "acid-armor": { note: "Your AC rises by 2 for the duration. Roll this when a creature hits you with a melee attack — it takes the damage if it fails the CON save." },
  "focus-punch": { patch: { attack: { scope: "melee" } }, note: "Turn 1 you focus (concentration). This card is the attack on your next turn, if you kept your concentration." },
  "origin-pulse": { attacks: 3, multiTarget: true, note: "Three beams, each its own ranged attack — they can go to different creatures." },
  "fire-blast": { attacks: 2, multiTarget: true, note: "Two pillars at up to two creatures; a creature saves against each pillar that targets it, and is burned if it fails a save by 5 or more." },
  "swords-dance": { attacks: {"10": 2}, note: "On use your AC rises by 1 (2 swords and +2 AC at level 10). Later, as a bonus action, drop concentration to release the sword — this card is that ranged attack (one per sword)." },
  "clangorous-soul": { rollDie: "3d6", rollLabel: "self-damage", note: "You take this typeless damage; in exchange gain +1 to attack rolls, AC and damage rolls for the encounter (stacks up to five times)." },
  "shed-tail": { rollDie: "2d6", rollLabel: "self-damage", note: "Reaction when hit: take this typeless damage to negate the attack's damage and effects, then switch out." },
  "sing": { rollDie: {"1": "5d8", "5": "7d8", "10": "6d12", "17": "11d8"}, rollLabel: "hit points it can put to sleep", note: "Creatures within 30 ft fall asleep in order of lowest current HP, each subtracting its HP from this total while it lasts." },
  "spite": { rollDie: {"1": "1d4", "5": "1d6", "10": "1d8", "17": "1d10"}, rollLabel: "PP drained on a failed save", note: "Reaction when hit by an attack: on a failed WIS save, the attacking move loses this much PP." },
  "hidden-power": { extraRolls: [{ label: "Damage type (d20: 1 Normal, 2 Fire, 3 Water, 4 Electric, 5 Grass, 6 Ice, 7 Fighting, 8 Poison, 9 Ground, 10 Flying, 11 Psychic, 12 Bug, 13 Rock, 14 Ghost, 15 Dragon, 16 Dark, 17 Steel, 18 Fairy, 19 Typeless, 20 your choice)", dice: "1d20" }], note: "The d20 on the card sets this hit's damage type." },
  "dire-claw": { extraRolls: [{ label: "Status if the CON save fails (1-2 Poisoned, 3-4 Paralyzed, 5-6 Asleep)", dice: "1d6" }], note: "On a hit the target makes a CON save; if it fails, the d6 on the card picks its status." },
  "tri-attack": { extraRolls: [{ label: "Status if a save fails by 5+ (1-2 Burned, 3-4 Frozen, 5-6 Paralyzed)", dice: "1d6" }], note: "A creature that fails its save by 5 or more gains the status the d6 on the card picks." },
  "secret-power": { extraRolls: [{ label: "Effect on a natural 15+ (1 Poison, 2 Burn, 3 Confusion, 4 Frozen, 5 Paralysis, 6 Sleep)", dice: "1d6" }], note: "On a natural attack roll of 15 or higher, the d6 on the card picks the effect." },
  "diamond-storm": { extraRolls: [{ label: "AC boost (3-4: +2 AC while the storm lasts)", dice: "1d4" }], note: "Zone damage for 3 rounds: a creature that enters the storm or starts its turn there takes this damage." },
  "eerie-impulse": { extraRolls: [{ label: "Rounds flinched (on a failed save)", dice: "1d4" }], note: "Each creature that fails the CON save flinches for the rolled number of rounds." },
  "throat-chop": { extraRolls: [{ label: "Turns it can't use sound moves (on a hit)", dice: "1d4" }], note: "On a hit, the target can't use sound-based moves for the rolled number of turns." },
  "steel-beam": { extraRolls: [{ label: "Your typeless self-damage if you were grounded", dice: "2d6" }], note: "The recoil pushes you back 10 ft and knocks you prone; if you were grounded you take the extra 2d6 typeless damage on the card." },
  "protect": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Avoid the damage and effects of a move aimed at you (not a natural 20). The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "detect": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Avoid the damage and effects of a move aimed at you (not a natural 20). The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "endure": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Drop to 1 HP instead of fainting. The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "kings-shield": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Avoid damage from this attack and any other damaging move until the start of your next turn. The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "obstruct": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Avoid the damage and effects of a move aimed at you (not a natural 20); a melee attacker also makes a CON save or flinches. The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "wide-guard": { extraRolls: [{ label: "d20 for a later use this combat (needs 16+)", dice: "1d20" }], note: "Halve the damage of an area move that hits several allies. The first use each combat is automatic; later uses need a d20 above 15 (rolled on the card)." },
  "draco-power": { secondDamage: "fire, water, grass or electric — your choice", note: "Deals both: the dragon damage, and the same dice + MOVE again of fire, water, grass or electric (your choice, rolled on its own line)." },
  "scale-shot": { moveOnce: true, note: "Five ranged attacks at one target; MOVE is added only once — to the first hit that lands (the other hits are the dice alone). Afterwards: +10 ft movement and -2 AC until the end of your next turn." },
  "ingrain": { patch: { fallbackDamage: { dice: {"1": "1d6", "5": "1d10", "10": "2d8", "17": "5d4"}, modifier: "MOVE", type: ["healing"] } }, note: "You heal this at the end of each of your next three turns (including this one) — one roll per turn. Your speed is 0 and you can't flee or be switched out." },
  "ice-ball": { note: "On consecutive turns, double the damage dice with each hit (up to 8x the starting dice); it resets on a miss or if you're incapacitated." },
  "fury-cutter": { note: "On consecutive turns, double the damage dice with each hit (up to 8x the starting dice); it resets on a miss or if you're incapacitated." },
  "trump-card": { note: "Add your MOVE modifier once more for each PP already spent on this move before this use (restoring PP resets it)." },
  "echoed-voice": { note: "Until the start of your next turn, another creature using Echoed Voice may double its damage dice on a hit — stacking up to 8x, resetting on a miss." },
  "leech-seed": { note: "No damage on the hit itself: the seeded target takes this damage at the end of each of its turns, and you (or your active Pokémon) regain half of it. Grass types are immune." },
  "petal-dance": { note: "On your next turn you may use it again and hit automatically, but you become confused at the end of that turn." },
  "poltergeist": { note: "The target first makes a CHA save; only if it fails do you make this attack (and may repeat it as a bonus action on later turns)." },
  "present": { note: "On a natural attack roll of 1 or 2, hit or miss, the present heals the target for 1d6 + MOVE instead." },
  "triple-arrows": { noCritRange: true, note: "Three ranged attacks at one target: the first crits on 19-20, the second lowers the target's AC by 1 on a hit (stacks to 5), the third flinches on a hit." },
  "mind-blown": { note: "Afterwards you take typeless damage equal to the full damage, as if you had failed the save." },
  "make-it-rain": { note: "You gain 1d10 ₽ for each creature that fails the save and 2d10 ₽ for each that succeeds." },
  "matcha-gotcha": { note: "You regain 1d6 HP for each creature that fails the save." },
  "growth": { note: "Nothing to roll now: the target adds a d4 (d6 from level 10) to its attack rolls and saving throws for the duration." },
  "sharpen": { note: "Nothing to roll now: add a d4 (d6 from level 10) to every attack roll for the duration." },
  "aromatic-mist": { note: "Nothing to roll now: you and allies within 5 ft add a d4 (d6 from level 10) to saving throws for the duration." },
  "helping-hand": { note: "Nothing to roll now: the ally adds a d6 (d8 at level 5, d10 at 10, d12 at 17) to one check, attack or save within 10 minutes." },
  "expanding-force": { note: "In Psychic Terrain it deals an extra 1d6 psychic damage and can target every creature on that terrain." },
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
  else if (p.fallbackDamage && !m.damage) m.damage = p.fallbackDamage;
  if (p.removeAttack) delete m.attack;
  if (p.removeSave) delete m.save;
  if (p.attack && !m.attack) m.attack = p.attack;
  if (p.save && !m.save) m.save = { attribute: p.save.attribute, dc: "MOVE" };
  return m;
}

/** The fix metadata (attacks / autoHit / note) for a move id — applied AFTER moveStat computes. */
export function moveFix(id: unknown): MoveFix | undefined {
  return id == null ? undefined : MOVE_FIXES[String(id)];
}
