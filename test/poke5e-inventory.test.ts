import { describe, it, expect, vi, afterEach } from 'vitest';
import { addInventoryItem, fetchItemsCatalog, removePokemon, evolvePokemon } from '../src/poke5e/source';

afterEach(() => { vi.unstubAllGlobals(); });

describe('poke5e addInventoryItem', () => {
  it('POSTs add_inventory_item with no _id (fresh row) and the standard-item fields', async () => {
    let url = ''; let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    await addInventoryItem('WKEY', 'pokeball', 2);
    expect(url).toContain('/rpc/add_inventory_item');
    expect(body._write_key).toBe('WKEY');
    expect(body._item_id).toBe('pokeball');
    expect(body._quantity).toBe(2);
    expect(body._custom_name).toBeNull();
    expect(body._description).toBeNull();
    // add_inventory_item must NOT carry a row id — that's how it creates a new row rather than update.
    expect('_id' in body).toBe(false);
  });

  it('defaults quantity to 1', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    await addInventoryItem('WKEY', 'potion');
    expect(body._quantity).toBe(1);
  });
});

describe('poke5e removePokemon', () => {
  it('POSTs remove_pokemon with the write key and pokemon row id', async () => {
    let url = ''; let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    await removePokemon('WKEY', 42);
    expect(url).toContain('/rpc/remove_pokemon');
    expect(body).toEqual({ _write_key: 'WKEY', _id: 42 });
  });
});

describe('poke5e evolvePokemon (in-place species change)', () => {
  it('updates the SAME row: new species + types, everything else preserved from the row', async () => {
    let url = ''; let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    const pk = { id: 42, species: 'bulbasaur', type: ['grass', 'poison'], nickname: 'Magnum', level: 6, hp_cur: 20, hp_max: 20, strength: 12, dexterity: 12 };
    // overrides = the re-stat the evolve wizard produces (species/type/ac/hp + post-ASI scores)
    await evolvePokemon('WKEY', pk, { _species: 'ivysaur', _type: ['grass', 'poison'], _ac: 13, _hp_max: 27, _hp_cur: 27, _constitution: 14 });
    expect(url).toContain('/rpc/update_pokemon');
    expect(body._write_key).toBe('WKEY');
    expect(body._id).toBe(42); // same row — not a new Pokémon
    expect(body._species).toBe('ivysaur'); // evolved
    expect(body._ac).toBe(13);
    expect(body._hp_max).toBe(27);
    expect(body._constitution).toBe(14); // ASI folded in
    // fields not in overrides carry through from the row
    expect(body._nickname).toBe('Magnum');
    expect(body._level).toBe(6);
    expect(body._strength).toBe(12);
  });
});

describe('poke5e fetchItemsCatalog', () => {
  it('maps items.json to {id,name,type} and sorts by name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [
        { id: 'potion', name: 'Potion', type: 'medicine' },
        { id: 'pokeball', name: 'Poké Ball', type: 'pokeball' },
        { id: 'antidote', name: 'Antidote', type: 'medicine' },
      ] }),
    } as any)));
    const cat = await fetchItemsCatalog();
    expect(cat.map((c) => c.name)).toEqual(['Antidote', 'Poké Ball', 'Potion']);
    const ball = cat.find((c) => c.id === 'pokeball');
    expect(ball).toEqual({ id: 'pokeball', name: 'Poké Ball', type: 'pokeball' });
  });
});
