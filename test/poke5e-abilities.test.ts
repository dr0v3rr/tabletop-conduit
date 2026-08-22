import { describe, it, expect } from 'vitest';
import { moveAbilityMods, passiveAbilityEffects, abilityIds } from '../src/poke5e/abilities-engine';

const ctx = { types: ['fire'], stab: 3, pb: 3 };
const dmgMove = (o: any = {}) => ({ casting: 'attack', type: 'normal', ...o });

describe('poke5e ability engine', () => {
  it('abilityIds reads the referenceId shape', () => {
    expect(abilityIds({ abilities: [{ referenceId: 'blaze' }, { referenceId: 'solar-power' }] })).toEqual(['blaze', 'solar-power']);
  });
  it('Blaze: double STAB on own-type moves when HP <= 25%', () => {
    const m = moveAbilityMods(['blaze'], { casting: 'attack', type: 'fire' }, ctx);
    expect(m).toEqual([{ ability: 'Blaze', cond: { hpPctMax: 25 }, damageAdd: 3 }]);
  });
  it('Blaze does NOT apply to non-STAB moves', () => {
    expect(moveAbilityMods(['blaze'], { casting: 'attack', type: 'normal' }, ctx)).toEqual([]);
  });
  it('Compound Eyes: +1 to hit on attack moves', () => {
    expect(moveAbilityMods(['compound-eyes'], { casting: 'attack', type: 'bug' }, ctx)).toEqual([{ ability: 'Compound Eyes', cond: 'always', attackAdd: 1 }]);
  });
  it('Serene Grace: +1 save DC on save moves only', () => {
    expect(moveAbilityMods(['serene-grace'], { casting: 'save', type: 'normal' }, ctx)[0]).toMatchObject({ saveDcAdd: 1 });
    expect(moveAbilityMods(['serene-grace'], { casting: 'attack', type: 'normal' }, ctx)).toEqual([]);
  });
  it('Adaptability: reminder note on STAB moves (not auto)', () => {
    expect(moveAbilityMods(['adaptability'], { casting: 'attack', type: 'fire' }, ctx)[0]).toMatchObject({ note: expect.stringContaining('twice') });
  });
  it('Transistor: reroll-damage note on electric moves (NOT +PB)', () => {
    const m = moveAbilityMods(['transistor'], { casting: 'attack', type: 'electric' }, { types: ['electric'], stab: 3, pb: 3 });
    expect(m[0]).toMatchObject({ note: expect.stringContaining('twice') });
    expect(m[0]?.damageAdd).toBeUndefined();
  });
  it('Steelworker: +PB damage on steel moves only', () => {
    expect(moveAbilityMods(['steelworker'], { casting: 'attack', type: 'steel' }, ctx)[0]).toMatchObject({ damageAdd: 3 });
    expect(moveAbilityMods(['steelworker'], { casting: 'attack', type: 'fire' }, ctx)).toEqual([]);
  });
  it("Dragon's Maw: reroll note on dragon moves regardless of own type", () => {
    expect(moveAbilityMods(['dragons-maw'], { casting: 'attack', type: 'dragon' }, ctx)[0]).toMatchObject({ note: expect.stringContaining('twice') });
    expect(moveAbilityMods(['dragons-maw'], { casting: 'attack', type: 'fire' }, ctx)).toEqual([]);
  });
  it('Flare Boost: +PB damage while burned, gated to the burn stem', () => {
    expect(moveAbilityMods(['flare-boost'], { casting: 'attack', type: 'normal' }, ctx)[0]).toMatchObject({ cond: { status: 'burn' }, damageAdd: 3 });
  });
  it('Competitive: +PB damage while afflicted', () => {
    expect(moveAbilityMods(['competitive'], { casting: 'attack', type: 'normal' }, ctx)[0]).toMatchObject({ cond: { status: 'any' }, damageAdd: 3 });
  });
  it('Guts: reminder only, adds no damage', () => {
    const m = moveAbilityMods(['guts'], { casting: 'attack', type: 'normal' }, ctx)[0];
    expect(m).toMatchObject({ cond: { status: 'any' } });
    expect(m?.damageAdd).toBeUndefined();
    expect(m?.note).toMatch(/ignore/i);
  });
  it('flat-damage abilities never attach to a no-damage move', () => {
    expect(moveAbilityMods(['flare-boost', 'competitive', 'steelworker'], { casting: 'utility', type: 'steel', hasDamage: false }, ctx)).toEqual([]);
  });

  // ── new move-roll abilities ──────────────────────────────────────────────────────
  it('Victory Star: +1 to hit', () => {
    expect(moveAbilityMods(['victory-star'], dmgMove(), ctx)[0]).toMatchObject({ attackAdd: 1 });
  });
  it('Gale Wings: +1 to hit only on flying moves', () => {
    expect(moveAbilityMods(['gale-wings'], dmgMove({ type: 'flying' }), ctx)[0]).toMatchObject({ attackAdd: 1 });
    expect(moveAbilityMods(['gale-wings'], dmgMove({ type: 'normal' }), ctx)).toEqual([]);
  });
  it('Defiant: +2 to hit gated to a status', () => {
    expect(moveAbilityMods(['defiant'], dmgMove(), ctx)[0]).toMatchObject({ cond: { status: 'any' }, attackAdd: 2 });
  });
  it('No Guard: advantage on our attacks', () => {
    expect(moveAbilityMods(['no-guard'], dmgMove(), ctx)[0]).toMatchObject({ attackAdvantage: true });
  });
  it('Defeatist: disadvantage strictly below 25% HP', () => {
    expect(moveAbilityMods(['defeatist'], dmgMove(), ctx)[0]).toMatchObject({ cond: { hpPctBelow: 25 }, attackDisadvantage: true });
  });
  it('Berserk: disadvantage + double-damage note strictly below 25% HP', () => {
    const m = moveAbilityMods(['berserk'], dmgMove(), ctx)[0];
    expect(m).toMatchObject({ cond: { hpPctBelow: 25 }, attackDisadvantage: true });
    expect(m?.note).toMatch(/double/i);
  });
  it('"below N%" (berserk) uses a strict threshold; STAB doublers (blaze) use "N% or less"', () => {
    // Prose: berserk fires "below 25%", blaze fires "25% or less" — different at exactly 25%.
    expect(moveAbilityMods(['berserk'], dmgMove(), ctx)[0]?.cond).toEqual({ hpPctBelow: 25 });
    expect(moveAbilityMods(['blaze'], dmgMove({ type: 'fire' }), ctx)[0]?.cond).toEqual({ hpPctMax: 25 });
  });
  it('status-specific passives are gated to their status stem, not any status', () => {
    expect(passiveAbilityEffects(['tangled-feet'])[0]).toMatchObject({ cond: { status: 'confus' } });
    expect(passiveAbilityEffects(['early-bird'])[0]).toMatchObject({ cond: { status: 'sleep' } });
    expect(passiveAbilityEffects(['poison-heal'])[0]).toMatchObject({ cond: { status: 'poison' } });
    // generic "negative status" abilities correctly stay broad:
    expect(passiveAbilityEffects(['marvel-scale'])[0]).toMatchObject({ cond: { status: 'any' } });
  });
  it('poison-heal and shields-down carry their full effect text', () => {
    expect(passiveAbilityEffects(['poison-heal'])[0]?.effect).toMatch(/ignore the poison disadvantage/i);
    expect(passiveAbilityEffects(['shields-down'])[0]?.effect).toMatch(/non-volatile status/i);
  });
  it('Mega Launcher: +PB on pulse/aura moves only', () => {
    expect(moveAbilityMods(['mega-launcher'], dmgMove({ type: 'water', name: 'Water Pulse' }), ctx)[0]).toMatchObject({ damageAdd: 3 });
    expect(moveAbilityMods(['mega-launcher'], dmgMove({ name: 'Tackle' }), ctx)).toEqual([]);
  });
  it('Technician: reroll only when max PP >= 15', () => {
    expect(moveAbilityMods(['technician'], dmgMove({ ppMax: 20 }), ctx)[0]).toMatchObject({ note: expect.stringContaining('twice') });
    expect(moveAbilityMods(['technician'], dmgMove({ ppMax: 5 }), ctx)).toEqual([]);
  });
  it('Iron Fist / Strong Jaw: reroll only on the named move family', () => {
    expect(moveAbilityMods(['iron-fist'], dmgMove({ name: 'Fire Punch' }), ctx)[0]).toMatchObject({ note: expect.stringContaining('twice') });
    expect(moveAbilityMods(['iron-fist'], dmgMove({ name: 'Tackle' }), ctx)).toEqual([]);
    expect(moveAbilityMods(['strong-jaw'], dmgMove({ name: 'Crunch' }), ctx)[0]).toMatchObject({ note: expect.stringContaining('twice') });
  });
  it('Skill Link / Sharpness: name-gated reminders', () => {
    expect(moveAbilityMods(['skill-link'], dmgMove({ name: 'Bullet Seed' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/hit/i) });
    expect(moveAbilityMods(['sharpness'], dmgMove({ name: 'Slash' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/modifier/i) });
  });
  it('Sharpness: matches all prose keywords but not substrings like "Pledge"', () => {
    expect(moveAbilityMods(['sharpness'], dmgMove({ name: 'Stone Edge' }), ctx).length).toBe(1);
    expect(moveAbilityMods(['sharpness'], dmgMove({ name: 'Sacred Sword' }), ctx).length).toBe(1);
    expect(moveAbilityMods(['sharpness'], dmgMove({ name: 'Fire Pledge' }), ctx).length).toBe(0); // "edge" inside "Pledge" must not match
    expect(moveAbilityMods(['sharpness'], dmgMove({ name: 'Tackle' }), ctx).length).toBe(0);
  });
  it('No Guard also surfaces its downside as a passive', () => {
    expect(passiveAbilityEffects(['no-guard'])[0]).toMatchObject({ effect: expect.stringMatching(/against it/i) });
  });
  it('Libero: STAB note only on non-STAB moves', () => {
    expect(moveAbilityMods(['libero'], dmgMove({ type: 'water' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/STAB/i) });
    expect(moveAbilityMods(['libero'], dmgMove({ type: 'fire' }), ctx)).toEqual([]); // already STAB
  });

  // ── passives ─────────────────────────────────────────────────────────────────────
  it('passiveAbilityEffects returns effect text for a resistance ability', () => {
    const p = passiveAbilityEffects(['thick-fat']);
    expect(p).toEqual([{ ability: 'Thick Fat', cond: 'always', effect: expect.stringMatching(/resist/i) }]);
  });
  it('Multiscale is a full-HP passive; Anger Shell is a low-HP passive', () => {
    expect(passiveAbilityEffects(['multiscale'])[0]).toMatchObject({ cond: { hpFull: true } });
    expect(passiveAbilityEffects(['anger-shell'])[0]).toMatchObject({ cond: { hpPctBelow: 50 } });
  });
  it('passives ignore unknown / move-only ids', () => {
    expect(passiveAbilityEffects(['blaze', 'not-a-real-ability'])).toEqual([]);
  });

  // ── COVERAGE: every actionable ability (81 from the catalog) is handled somewhere ──
  it('all 81 actionable abilities are covered by a move mod or a passive', () => {
    const ALL_81 = [
      // Auto (37)
      'adaptability', 'battle-armor', 'big-pecks', 'clear-body', 'compound-eyes', 'dark-aura',
      'dauntless-shield', 'dragons-maw', 'fairy-aura', 'guard-dog', 'heatproof', 'huge-power',
      'ice-scales', 'intrepid-sword', 'keen-eye', 'levitate', 'minds-eye', 'no-guard', 'overcoat',
      'purifying-salt', 'quick-draw', 'rock-head', 'serene-grace', 'shell-armor', 'soundproof',
      'stall', 'super-luck', 'telepathy', 'thick-fat', 'victory-star', 'vital-spirit', 'volt-absorb',
      'water-absorb', 'water-bubble', 'water-veil', 'wonder-guard', 'wonder-skin',
      // State-knowable (44)
      'anger-shell', 'berserk', 'blaze', 'competitive', 'defeatist', 'defiant', 'disguise',
      'early-bird', 'embody-aspect-cornerstone', 'embody-aspect-heartflame', 'embody-aspect-teal',
      'embody-aspect-wellspring', 'flare-boost', 'gale-wings', 'guts', 'iron-fist', 'libero',
      'marvel-scale', 'mega-launcher', 'multiscale', 'overgrow', 'poison-heal', 'punk-rock',
      'quick-feet', 'reckless', 'rocky-payload', 'schooling', 'shadow-shield', 'sharpness',
      'shed-skin', 'sheer-force', 'shields-down', 'skill-link', 'steelworker', 'strong-jaw', 'swarm',
      'tangled-feet', 'technician', 'tera-shell', 'torrent', 'tough-claws', 'transistor', 'zen-mode',
      'zen-mode-galarian',
    ];
    expect(ALL_81.length).toBe(81);

    // A move probe crafted to satisfy each move-affecting ability's structural gate (type/name/PP).
    const PROBES: Record<string, { move: any; ctx?: any }> = {
      'compound-eyes': { move: dmgMove() }, 'victory-star': { move: dmgMove() },
      'gale-wings': { move: dmgMove({ type: 'flying' }) }, 'defiant': { move: dmgMove() },
      'serene-grace': { move: { casting: 'save', type: 'normal' } }, 'super-luck': { move: dmgMove() },
      'steelworker': { move: dmgMove({ type: 'steel' }) },
      'mega-launcher': { move: dmgMove({ type: 'water', name: 'Water Pulse' }) },
      'flare-boost': { move: dmgMove() }, 'competitive': { move: dmgMove() }, 'guts': { move: dmgMove() },
      'blaze': { move: dmgMove({ type: 'fire' }) }, 'overgrow': { move: dmgMove({ type: 'fire' }) },
      'torrent': { move: dmgMove({ type: 'fire' }) }, 'swarm': { move: dmgMove({ type: 'fire' }) },
      'no-guard': { move: dmgMove() }, 'intrepid-sword': { move: dmgMove() },
      'defeatist': { move: dmgMove() }, 'berserk': { move: dmgMove() },
      'adaptability': { move: dmgMove({ type: 'fire' }) }, 'dragons-maw': { move: dmgMove({ type: 'dragon' }) },
      'transistor': { move: dmgMove({ type: 'electric' }) }, 'rocky-payload': { move: dmgMove({ type: 'rock' }) },
      'iron-fist': { move: dmgMove({ name: 'Fire Punch' }) }, 'strong-jaw': { move: dmgMove({ name: 'Crunch' }) },
      'technician': { move: dmgMove({ ppMax: 20 }) }, 'sharpness': { move: dmgMove({ name: 'Slash' }) },
      'sheer-force': { move: dmgMove() }, 'huge-power': { move: dmgMove() }, 'pure-power': { move: dmgMove() },
      'libero': { move: dmgMove({ type: 'water' }) }, 'reckless': { move: dmgMove({ type: 'fire' }) },
      'tough-claws': { move: dmgMove() }, 'skill-link': { move: dmgMove({ name: 'Bullet Seed' }) },
      'dark-aura': { move: dmgMove({ type: 'dark' }) }, 'fairy-aura': { move: dmgMove({ type: 'fairy' }) },
      'punk-rock': { move: dmgMove({ name: 'Hyper Voice' }) },
    };

    for (const id of ALL_81) {
      const asPassive = passiveAbilityEffects([id]).length > 0;
      const p = PROBES[id];
      const asMove = p ? moveAbilityMods([id], p.move, p.ctx || ctx).length > 0 : false;
      expect(asPassive || asMove, `ability "${id}" is not handled`).toBe(true);
    }
  });
});
