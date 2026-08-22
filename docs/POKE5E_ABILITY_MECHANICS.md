# poke5e Pokémon Ability Mechanics Catalog

Classified 330 abilities.

## Auto (static — always applicable)

- **Adaptability** (adaptability) — roll STAB-move damage twice, keep either total  _[damage]_
- **Battle Armor** (battle-armor) — negate the extra dice from crits against it  _[damage,resistance-immunity]_
- **Big Pecks** (big-pecks) — AC can't be lowered by foes' moves  _[ac]_
- **Clear Body** (clear-body) — foes can't lower this Pokemon's stats  _[other]_
- **Compound Eyes** (compound-eyes) — +1 to attack rolls  _[to-hit]_
- **Dark Aura** (dark-aura) — dark-type moves deal double damage within 100ft (including its own)  _[damage]_
- **Dauntless Shield** (dauntless-shield) — melee attacks against this Pokemon are at disadvantage  _[to-hit]_
- **Dragon's Maw** (dragons-maw) — roll dragon-move damage twice, keep either total  _[damage]_
- **Fairy Aura** (fairy-aura) — fairy-type moves deal double damage within 100ft (including its own)  _[damage]_
- **Guard Dog** (guard-dog) — intimidation rolls vs it have disadvantage; immune to Intimidate; no forced switch  _[ability-check,resistance-immunity]_
- **Heatproof** (heatproof) — resist fire damage; immune to burning  _[resistance-immunity,status-infliction]_
- **Huge Power** (huge-power) — double damage dice for one damage roll (1/short rest)  _[damage]_
- **Ice Scales** (ice-scales) — resist damage from INT/WIS/CHA-powered (special) moves  _[resistance-immunity]_
- **Intrepid Sword** (intrepid-sword) — advantage on melee attack rolls  _[to-hit]_
- **Keen Eye** (keen-eye) — ignore disadvantage related to sight  _[to-hit]_
- **Levitate** (levitate) — immune to ground-type moves  _[resistance-immunity]_
- **Mind's Eye** (minds-eye) — ignore Normal/Fighting immunity; ignore disadvantage vs seen targets  _[to-hit,other]_
- **No Guard** (no-guard) — advantage on attack rolls by and against this Pokemon  _[to-hit]_
- **Overcoat** (overcoat) — immune to weather damage  _[resistance-immunity]_
- **Purifying Salt** (purifying-salt) — resist Ghost damage; immune to non-volatile status  _[resistance-immunity,status-infliction]_
- **Quick Draw** (quick-draw) — advantage on initiative rolls  _[initiative]_
- **Rock Head** (rock-head) — takes no recoil damage  _[resistance-immunity]_
- **Serene Grace** (serene-grace) — +1 to this Pokemon's move save DC  _[save-dc]_
- **Shell Armor** (shell-armor) — immune to extra critical-hit damage  _[resistance-immunity,damage]_
- **Soundproof** (soundproof) — immune to sound-based moves  _[resistance-immunity]_
- **Stall** (stall) — always acts last in initiative  _[initiative]_
- **Super Luck** (super-luck) — increase crit range by 1 (crit on 19-20)  _[to-hit]_
- **Telepathy** (telepathy) — immune to allies' attack damage  _[resistance-immunity]_
- **Thick Fat** (thick-fat) — resist (half) Fire and Ice damage  _[resistance-immunity]_
- **Victory Star** (victory-star) — +1 to attack rolls for self and all allies  _[to-hit]_
- **Vital Spirit** (vital-spirit) — immune to sleep  _[resistance-immunity]_
- **Volt Absorb** (volt-absorb) — immune to Electric damage; heal half of it instead  _[resistance-immunity,hp-healing]_
- **Water Absorb** (water-absorb) — immune to Water damage; heal half of it instead  _[resistance-immunity,hp-healing]_
- **Water Bubble** (water-bubble) — resist Fire damage; immune to burn  _[resistance-immunity]_
- **Water Veil** (water-veil) — immune to burning  _[resistance-immunity]_
- **Wonder Guard** (wonder-guard) — immune to damaging moves not in its vulnerabilities list  _[resistance-immunity]_
- **Wonder Skin** (wonder-skin) — advantage on saves vs burn/freeze/poison/paralysis  _[saving-throw]_

## State-knowable (depends on our Pokémon's HP% / own type / status / level)

- **Anger Shell** (anger-shell) — below half HP: -2 AC, +2 STR & DEX (max 22)  _trigger: hp-threshold_
- **Berserk** (berserk) — below 25% HP: attacks at disadvantage but deal double damage; targets get advantage on saves  _trigger: hp-threshold_
- **Blaze** (blaze) — double STAB bonus at <=25% HP  _trigger: hp-threshold_
- **Competitive** (competitive) — +PB to damage rolls while poisoned/burned/confused/paralyzed  _trigger: status-on-self_
- **Defeatist** (defeatist) — all attacks at disadvantage below 25% HP  _trigger: hp-threshold_
- **Defiant** (defiant) — +2 to attack rolls while under a foe-imposed negative status/stat change  _trigger: status-on-self_
- **Disguise** (disguise) — temp HP shield equal to 2x level; breaks then needs short rest  _trigger: first-turn_
- **Early Bird** (early-bird) — advantage on the d20 roll to wake from sleep  _trigger: status-on-self_
- **Embody Aspect (Cornerstone)** (embody-aspect-cornerstone) — set CON to 23 on Terastallize (if lower)  _trigger: other-conditional_
- **Embody Aspect (Heartflame)** (embody-aspect-heartflame) — set STR to 23 on Terastallize (if lower)  _trigger: other-conditional_
- **Embody Aspect (Teal)** (embody-aspect-teal) — set DEX to 23 on Terastallize (if lower)  _trigger: other-conditional_
- **Embody Aspect (Wellspring)** (embody-aspect-wellspring) — set CHA to 23 on Terastallize (if lower)  _trigger: other-conditional_
- **Flare Boost** (flare-boost) — +PB to damage rolls while burned  _trigger: status-on-self_
- **Gale Wings** (gale-wings) — +1 to hit with flying-type attacks  _trigger: type-match_
- **Guts** (guts) — ignore burn/poison attack and damage penalties  _trigger: status-on-self_
- **Iron Fist** (iron-fist) — roll damage twice and keep either for punch-based moves  _trigger: type-match_
- **Libero** (libero) — own type becomes the used move's type, gaining STAB  _trigger: type-match_
- **Marvel Scale** (marvel-scale) — +2 AC while suffering a negative status condition  _trigger: status-on-self_
- **Mega Launcher** (mega-launcher) — +PB damage/healing to Aura and Pulse moves  _trigger: type-match_
- **Multiscale** (multiscale) — halve first damage taken while at full HP  _trigger: hp-threshold_
- **Overgrow** (overgrow) — double STAB bonus at <=25% HP  _trigger: hp-threshold_
- **Poison Heal** (poison-heal) — ignore poison drawbacks; heal half of would-be poison damage  _trigger: status-on-self_
- **Punk Rock** (punk-rock) — sound moves add STAB to damage; resist sound moves  _trigger: type-match_
- **Quick Feet** (quick-feet) — +15ft speed while suffering a negative status  _trigger: status-on-self_
- **Reckless** (reckless) — double STAB bonus on recoil moves  _trigger: type-match_
- **Rocky Payload** (rocky-payload) — roll damage twice choose either on Rock moves  _trigger: type-match_
- **Schooling** (schooling) — School Form (lvl5+, >25% HP): +5 AC/STR/DEX/CON  _trigger: hp-threshold_
- **Shadow Shield** (shadow-shield) — halve first damage taken while at full HP  _trigger: hp-threshold_
- **Sharpness** (sharpness) — double MOVE damage modifier on Cut/Blade/Slash/etc named moves  _trigger: type-match_
- **Shed Skin** (shed-skin) — 1d4 at end of turn while statused; on 4 cured  _trigger: status-on-self_
- **Sheer Force** (sheer-force) — double MOVE modifier on moves with a secondary effect (effect lost)  _trigger: type-match_
- **Shields Down** (shields-down) — Core Form below 50% HP: +6 DEX, -4 AC (Meteor Form immune to non-volatile status)  _trigger: hp-threshold_
- **Skill Link** (skill-link) — multi-hit combo moves guaranteed to land at least twice  _trigger: type-match_
- **Steelworker** (steelworker) — +PB to damage on Steel-type moves  _trigger: type-match_
- **Strong Jaw** (strong-jaw) — roll damage dice twice, keep either, on biting moves  _trigger: type-match_
- **Swarm** (swarm) — double STAB bonus at HP <=25%  _trigger: hp-threshold_
- **Tangled Feet** (tangled-feet) — attackers have disadvantage while this Pokemon is confused  _trigger: status-on-self_
- **Technician** (technician) — roll damage twice, keep either, for moves with >=15 max PP  _trigger: other-conditional_
- **Tera Shell** (tera-shell) — resist all damage types while at full HP  _trigger: hp-threshold_
- **Torrent** (torrent) — double STAB bonus at HP <=25%  _trigger: hp-threshold_
- **Tough Claws** (tough-claws) — melee attacks gain STAB; double STAB if already applicable  _trigger: on-hit_
- **Transistor** (transistor) — roll damage dice twice, keep either, on Electric-type moves  _trigger: type-match_
- **Zen Mode** (zen-mode) — below 50% HP: type -> Fire/Psychic, +4 AC, swap STR/WIS  _trigger: hp-threshold_
- **Zen Mode (Galarian)** (zen-mode-galarian) — below 50% HP: type -> Ice/Fire, +2 STR and +2 DEX  _trigger: hp-threshold_