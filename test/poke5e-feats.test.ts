import { describe, it, expect } from 'vitest';
import { moveFeatMods } from '../src/poke5e/feats-engine';

const ctx = { pb: 3 };
const atk = (o: any = {}) => ({ casting: 'attack' as const, hasDamage: true, ...o });

describe('poke5e feats engine', () => {
  it('Combo Master: reminder on multi-hit moves only', () => {
    expect(moveFeatMods(['Combo Master'], atk({ name: 'Fury Swipes' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/hit/i) });
    expect(moveFeatMods(['Combo Master'], atk({ name: 'Tackle' }), ctx)).toEqual([]);
  });
  it('Melee Master: +PB damage on melee STR moves only', () => {
    expect(moveFeatMods(['Melee Master'], atk({ name: 'Slam', scope: 'melee', powerHasStr: true }), ctx)[0]).toMatchObject({ ability: 'Melee Master', damageAdd: 3 });
    // ranged, or non-STR → no effect
    expect(moveFeatMods(['Melee Master'], atk({ name: 'Ember', scope: 'ranged', powerHasStr: false }), ctx)).toEqual([]);
    expect(moveFeatMods(['Melee Master'], atk({ name: 'Confusion', scope: 'melee', powerHasStr: false }), ctx)).toEqual([]);
  });
  it('Ranged Master: reminder on ranged attacks only', () => {
    expect(moveFeatMods(['Ranged Master'], atk({ name: 'Ember', scope: 'ranged' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/cover/i) });
    expect(moveFeatMods(['Ranged Master'], atk({ name: 'Slam', scope: 'melee' }), ctx)).toEqual([]);
  });
  it('Terrain Adept / Wrangler: situational reminders on attack moves', () => {
    expect(moveFeatMods(['Terrain Adept'], atk({ name: 'Tackle', scope: 'melee' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/terrain/i) });
    expect(moveFeatMods(['Wrangler'], atk({ name: 'Tackle', scope: 'melee' }), ctx)[0]).toMatchObject({ note: expect.stringMatching(/grappl/i) });
  });
  it('non-actionable feats (AC Up, Tireless, Gifted…) produce no move mods', () => {
    expect(moveFeatMods(['AC Up', 'Tireless', 'Gifted', 'Extra Move', 'Ambidextrous', 'Able-Bodied'], atk({ name: 'Slam', scope: 'melee', powerHasStr: true }), ctx)).toEqual([]);
  });
  it('feat names are matched case-insensitively', () => {
    expect(moveFeatMods(['combo master'], atk({ name: 'Double Slap' }), ctx).length).toBe(1);
  });
});
