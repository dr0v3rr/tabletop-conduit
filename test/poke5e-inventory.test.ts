import { describe, it, expect, vi, afterEach } from 'vitest';
import { addInventoryItem, removeInventoryItem, fetchItemsCatalog, buildInventory, resetItemsCacheForTests, removePokemon, evolvePokemon, itemHealDice, itemHealFlat, bagItemUsable, trainerToRollModel } from '../src/poke5e/source';
import { rollFrom } from '../src/pipeline';

afterEach(() => { vi.unstubAllGlobals(); resetItemsCacheForTests(); });

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

  it('re-adds a custom item (Undo on a used-up row) by name and description', async () => {
    let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    await addInventoryItem('WKEY', null, 1, { name: 'Lucky Charm', description: 'Reroll once' });
    expect(body).toMatchObject({ _item_id: null, _quantity: 1, _custom_name: 'Lucky Charm', _description: 'Reroll once' });
  });
});

describe('poke5e removeInventoryItem', () => {
  it('POSTs remove_inventory_item with the write key and bag row id', async () => {
    let url = ''; let body: any = null;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: any) => {
      url = u; body = JSON.parse(init.body);
      return { ok: true, json: async () => 1 } as any;
    }));
    expect(await removeInventoryItem('WKEY', 7)).toBe(true);
    expect(url).toContain('/rpc/remove_inventory_item');
    expect(body).toEqual({ _write_key: 'WKEY', _id: 7 });
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
  // TMs live only in poke5e's SRD items API (/srd/v1/<edition>/items.json), not /data/items.json.
  const STATIC = { items: [{ id: 'potion', name: 'Potion', type: 'medicine' }] };
  const SRD = { values: [
    { id: 'potion', name: 'Potion (srd)', type: 'medicine' },
    { id: 'tm-10', name: 'TM 010 - Ice Beam', type: 'TM', description: 'When used, allows a Pokémon to learn the Ice Beam move.' },
    { id: 'tm-2', name: 'TM 002 - Dragon Claw', type: 'TM' },
  ] };
  const stubBy = (routes: Record<string, any>) => vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    const hit = Object.keys(routes).find((k) => String(u).includes(k));
    const body = hit ? routes[hit] : null;
    return body === 'fail' || !hit ? ({ ok: false, status: 500, json: async () => ({}), text: async () => '' } as any)
      : ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any);
  }));

  it('merges TMs from the SRD API (only TMs — the static file stays authoritative for the rest)', async () => {
    stubBy({ '/data/items.json': STATIC, '/srd/v1/2024/items.json': SRD });
    const cat = await fetchItemsCatalog();
    expect(cat.map((c) => c.id)).toEqual(['potion', 'tm-2', 'tm-10']); // numeric-aware: 002 before 010
    expect(cat.find((c) => c.id === 'potion')!.name).toBe('Potion');
    expect(cat.find((c) => c.id === 'tm-10')).toEqual({ id: 'tm-10', name: 'TM 010 - Ice Beam', type: 'TM' });
  });

  it('still returns the regular items when the SRD API is down, and picks TMs up on a later call', async () => {
    stubBy({ '/data/items.json': STATIC, '/srd/v1/2024/items.json': 'fail' });
    expect((await fetchItemsCatalog()).map((c) => c.id)).toEqual(['potion']);
    stubBy({ '/data/items.json': STATIC, '/srd/v1/2024/items.json': SRD });
    expect((await fetchItemsCatalog()).map((c) => c.id)).toContain('tm-10');
  });

  it('names a TM in the bag instead of "(unnamed item)"', async () => {
    stubBy({
      '/rpc/get_inventory_items': [{ id: 5, item_id: 'tm-10', quantity: 1, custom_name: null, description: null }],
      '/data/items.json': STATIC, '/srd/v1/2024/items.json': SRD,
    });
    const [tm] = await buildInventory('READKEY');
    expect(tm).toMatchObject({ name: 'TM 010 - Ice Beam', itemId: 'tm-10', typeName: 'TM', rowId: 5 });
    expect(tm.note).toContain('Ice Beam');
  });
});

describe('poke5e healing items roll on Use', () => {
  it('reads the healing dice from the item wording', () => {
    expect(itemHealDice('A trainer may use an action to restore 2d4 + 2 HP to an adjacent Pokémon.')).toBe('2d4+2');
    expect(itemHealDice('A trainer may use an action to restore 4d12 + 10 HP to a fainted Pokémon.')).toBe('4d12+10');
    expect(itemHealDice('Consume to restore 2d4 + 2 HP.')).toBe('2d4+2');
    // Not a heal: an extra on another effect, a flat amount, or dice that aren't HP.
    expect(itemHealDice('…heal the holder restore an additional 1d12 HP to the holder.')).toBeUndefined();
    expect(itemHealDice('10 minutes after consumption, the Pokémon regains 70 HP.')).toBeUndefined();
    expect(itemHealDice('it reduces the Hatch Time by 1d20 each day')).toBeUndefined();
    expect(itemHealDice(undefined)).toBeUndefined();
  });

  it('makes a Potion in the bag a heal item that sends its dice to Roll20', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const body = String(u).includes('/rpc/get_inventory_items')
        ? [{ id: 3, item_id: 'potion', quantity: 2, custom_name: null, description: null },
           { id: 4, item_id: 'antidote', quantity: 1, custom_name: null, description: null }]
        : { items: [
          { id: 'potion', name: 'Potion', type: 'medicine', description: ['A trainer may use an action to restore 2d4 + 2 HP to an adjacent Pokémon. Consumed on use.'] },
          { id: 'antidote', name: 'Antidote', type: 'medicine', description: ['Cures poison.'] },
        ] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
    }));
    const bag = await buildInventory('READKEY');
    const potion = bag.find((b) => b.itemId === 'potion')!;
    expect(potion).toMatchObject({ kind: 'heal', dice: '2d4+2', consumable: true });
    expect(bag.find((b) => b.itemId === 'antidote')).toMatchObject({ kind: 'item', dice: undefined });
    // The request the sheet's Use builds for it (itemReq) makes a real roll for a trainer.
    const { model } = trainerToRollModel({ name: 'Ash', level: 5, hp_max: 40, hp_cur: 31, strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
    const { command } = rollFrom({} as any, { kind: 'damage', key: 'Potion (heal)', baseDamage: potion.dice }, [], model);
    expect(command).toContain('[[2d4 + 2]]');
    expect(command).toContain('Potion (heal)');
  });
});

describe('poke5e bag items: what Use does', () => {
  it('reads a fixed heal (Sitrus Berry, Max Potion) but not temp HP or dice', () => {
    expect(itemHealFlat('Consume to restore 30 HP. Can be consumed as a reaction to dropping below half health.')).toBe(30);
    expect(itemHealFlat('When consumed, restores 7 HP. A trainer may use a bonus action…')).toBe(7);
    expect(itemHealFlat('10 minutes after consumption, the Pokémon regains 70 HP and is cured of all status conditions.')).toBe(70);
    expect(itemHealFlat('When consumed by a Pokémon, it gains 20 temp HP for 1 minute.')).toBeUndefined();
    expect(itemHealFlat('restore 2d4 + 2 HP')).toBeUndefined();
  });

  it('only gives a Use to things that are used up from the bag', () => {
    expect(bagItemUsable('potion', 'medicine')).toBe(true);
    expect(bagItemUsable('sitrus-berry', 'berry')).toBe(true);
    expect(bagItemUsable('escape-rope', 'trainer gear')).toBe(true);
    expect(bagItemUsable('pokedex', 'trainer gear')).toBe(false); // kept — using it mustn't remove it
    expect(bagItemUsable('key-stone', 'trainer gear')).toBe(false);
    expect(bagItemUsable('leftovers', 'held item')).toBe(false);
    expect(bagItemUsable('fire-stone', 'evolution')).toBe(false);
    expect(bagItemUsable('tm-1', 'TM')).toBe(false);
    expect(bagItemUsable('poke-ball', 'pokeball')).toBe(false); // Throw instead
    expect(bagItemUsable(null, undefined)).toBe(true); // a custom item could be anything
  });

  it('carries usable + the fixed heal onto bag rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      const body = String(u).includes('/rpc/get_inventory_items')
        ? [{ id: 1, item_id: 'sitrus-berry', quantity: 1 }, { id: 2, item_id: 'pokedex', quantity: 1 }]
        : { items: [
          { id: 'sitrus-berry', name: 'Sitrus Berry', type: 'berry', description: ['Consume to restore 30 HP.'] },
          { id: 'pokedex', name: 'Pokédex', type: 'trainer gear', description: ['A hand-held computer.'] },
        ] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as any;
    }));
    const bag = await buildInventory('READKEY');
    expect(bag.find((b) => b.itemId === 'sitrus-berry')).toMatchObject({ usable: true, healFlat: 30, kind: 'item' });
    expect(bag.find((b) => b.itemId === 'pokedex')).toMatchObject({ usable: false, consumable: true });
  });
});

