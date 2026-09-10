import { describe, it, expect, vi, afterEach } from 'vitest';
import { POKE5E_STATUSES, poke5eStatusName } from '../src/poke5e/status';
import { updatePokemonStatus } from '../src/poke5e/source';

afterEach(() => { vi.unstubAllGlobals(); });

describe('poke5e status catalog', () => {
  it('lists poke5e\'s eight status ids in poke5e\'s canonical form', () => {
    expect(POKE5E_STATUSES.map((s) => s.id)).toEqual([
      'Asleep', 'Burned', 'Frozen', 'Paralysis', 'Poisoned', 'BadlyPoisoned', 'Confused', 'Flinched',
    ]);
  });
  it('gives BadlyPoisoned a friendly display name and falls back to the id otherwise', () => {
    expect(poke5eStatusName('BadlyPoisoned')).toBe('Badly Poisoned');
    expect(poke5eStatusName('Poisoned')).toBe('Poisoned');
    expect(poke5eStatusName('Nonsense')).toBe('Nonsense');
  });
});

describe('poke5e updatePokemonStatus', () => {
  it('writes _status on the SAME row via update_pokemon, preserving everything else', async () => {
    let url = ''; let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    const pk = { id: 7, species: 'gengar', nickname: 'Spook', level: 20, hp_cur: 60, hp_max: 60, status: '' };
    await updatePokemonStatus('WKEY', pk, 'Poisoned');
    expect(url).toContain('/rpc/update_pokemon');
    expect(body._write_key).toBe('WKEY');
    expect(body._id).toBe(7);        // same row
    expect(body._status).toBe('Poisoned');
    expect(body._nickname).toBe('Spook'); // untouched fields carry through
    expect(body._hp_cur).toBe(60);
  });

  it('clears the status by writing null', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    await updatePokemonStatus('WKEY', { id: 7, species: 'gengar', status: 'Poisoned' }, null);
    expect(body._status).toBeNull();
  });
});
