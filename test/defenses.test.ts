import { describe, it, expect } from 'vitest';
import { computeDefenses, applyDefense } from '../src/engine/defenses';
import type { CharacterData } from '../src/engine/types';

const data = {
  name: 'T', stats: [], classes: [],
  modifiers: {
    race: [{ type: 'resistance', subType: 'poison' }, { type: 'resistance', subType: 'fire' }],
    class: [{ type: 'immunity', subType: 'fire' }], // immunity should win over resistance for fire
    item: [{ type: 'vulnerability', subType: 'cold' }],
    feat: [{ type: 'bonus', subType: 'hit-points', value: 3 }], // ignored (not a damage type)
  },
} as unknown as CharacterData;

describe('computeDefenses', () => {
  const d = computeDefenses(data);
  it('collects resist/immune/vulnerable and resolves precedence (immune > resist)', () => {
    expect(d.immune).toEqual(['fire']);
    expect(d.resist).toEqual(['poison']); // fire promoted to immune, removed from resist
    expect(d.vulnerable).toEqual(['cold']);
  });
  it('applyDefense halves/zeros/doubles by type', () => {
    expect(applyDefense(20, 'fire', d)).toEqual({ amount: 0, effect: 'immune' });
    expect(applyDefense(21, 'poison', d)).toEqual({ amount: 10, effect: 'resist' }); // floor(21/2)
    expect(applyDefense(7, 'cold', d)).toEqual({ amount: 14, effect: 'vulnerable' });
    expect(applyDefense(9, 'acid', d)).toEqual({ amount: 9, effect: null });
    expect(applyDefense(9, null, d)).toEqual({ amount: 9, effect: null });
  });
});
