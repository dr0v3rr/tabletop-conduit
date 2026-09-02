import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAbilities } from '../src/poke5e/pokemon';

afterEach(() => { vi.unstubAllGlobals(); });

// The reference lives at /data/abilities.json with an `items` array of {id,name,description}.
const SYNC_DESC = 'If this Pokémon becomes burned, paralyzed, or poisoned, its attacker receives the negative status condition as well (if not immune).';
const ABILITIES_JSON = { items: [{ id: 'synchronize', name: 'Synchronize', description: SYNC_DESC }] };

describe('resolveAbilities gives abilities their proper name + text', () => {
  it('fetches the abilities reference and resolves an id string to name + description', async () => {
    let requested = '';
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { requested = u; return { ok: true, json: async () => ABILITIES_JSON } as any; }));

    const out = await resolveAbilities({ abilities: ['synchronize'] });
    expect(requested).toContain('/data/abilities.json'); // not the old 404 /abilities.json
    expect(out).toEqual([{
      name: 'Synchronize', // proper-cased, not the raw "synchronize" id
      description: SYNC_DESC,
    }]);
    expect(out[0]?.description).not.toBe(''); // the reported bug: text was blank
  });

  it('falls back to a description carried inline on the row when the reference lacks the id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ABILITIES_JSON } as any)));
    const out = await resolveAbilities({ abilities: [{ id: 'custom-trait', name: 'Custom Trait', description: 'Homebrew text.' }] });
    expect(out).toEqual([{ name: 'Custom Trait', description: 'Homebrew text.' }]);
  });
});
