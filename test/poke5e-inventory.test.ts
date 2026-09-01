import { describe, it, expect, vi, afterEach } from 'vitest';
import { addInventoryItem, fetchItemsCatalog, removePokemon } from '../src/poke5e/source';

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
