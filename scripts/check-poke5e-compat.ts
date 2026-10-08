// poke5e compatibility check — fails if poke5e has drifted from what Conduit expects.
//
//   npx tsx scripts/check-poke5e-compat.ts                 # data files + anon key + write-RPC signatures
//   npx tsx scripts/check-poke5e-compat.ts <readKey>       # also exercises read RPCs + full-row updates
//   npm run check:poke5e -- <readKey>                      # (same, via the npm script)
//
// poke5e has repeatedly broken Conduit by moving a data file (/items.json → /data/items.json) or
// changing an RPC's named-argument signature (update_trainer → full-row upsert; add_pokemon's
// `_rank_*` → `_prof_*`; dropping `_type`). This re-checks every assumption and exits non-zero on any
// mismatch, so it can gate a release or be run whenever poke5e ships an update. It reuses Conduit's OWN
// request builders (buildParams / buildAddPokemonParams) and its baked anon key, so it tests the exact
// call shape Conduit makes.
//
// SAFETY: write-RPC signature tests use a NON-EXISTENT write key, so update/delete/remove no-op (0 rows)
// and the add_* inserts resolve to a trainer that doesn't exist (constraint-rejected → no row created).
// Nothing in any real trainer/Pokémon is modified. Pass a read key you OWN or can read; it is used only
// for GET calls and is never written anywhere.

import { getPoke5eCredentials, buildParams, buildAddPokemonParams, TRAINER_PARAMS, POKEMON_PARAMS, type AddPokemonSpecies } from "../src/poke5e/source.ts";

const { url, anonKey } = getPoke5eCredentials();
const readKey = process.argv[2] || "";
const FAKE = "COMPATCHECK00000"; // not a real write key — ensures signature tests can't mutate

let breaks = 0;
const ok = (m: string) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const bad = (m: string) => { breaks++; console.log(`  \x1b[31mBREAK\x1b[0m ${m}`); };
const skip = (m: string) => console.log(`  \x1b[90m–    ${m}\x1b[0m`);

async function rpc(fn: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = JSON.parse(await r.text()); } catch { /* non-JSON */ }
  return { status: r.status, json };
}
const isMissingFn = (r: { json: any }) => !!r.json && (r.json.code === "PGRST202" || /Could not find the function/i.test(r.json.message || ""));

async function main() {
  console.log(`poke5e compatibility check — ${url}\n`);

  // 1. Data files (paths + shapes Conduit parses).
  console.log("Data files:");
  const files: [string, (j: any) => boolean, string][] = [
    ["https://poke5e.app/pokemon.json", (j) => Array.isArray(j) || Array.isArray(j.items) || Object.keys(j).length > 50, "species list"],
    ["https://poke5e.app/moves.json", (j) => !!j.moves || Array.isArray(j), "moves"],
    ["https://poke5e.app/data/items.json", (j) => Array.isArray(j.items) && j.items.length > 0, "items catalogue"],
    ["https://poke5e.app/data/abilities.json", (j) => !!j && Object.keys(j).length > 0, "abilities"],
  ];
  for (const [u, shapeOk, label] of files) {
    try {
      const r = await fetch(u);
      if (!r.ok) { bad(`${label}: HTTP ${r.status} — ${u}`); continue; }
      shapeOk(await r.json()) ? ok(`${label} — ${u}`) : bad(`${label}: unexpected shape — ${u}`);
    } catch (e) { bad(`${label}: ${String(e)} — ${u}`); }
  }

  // 2. Anon key accepted.
  console.log("\nAnon key:");
  const probe = await rpc("get_trainer", { _read_key: readKey || "compat-nonexistent" });
  if (probe.status === 401 || probe.status === 403) bad(`anon key rejected (HTTP ${probe.status}) — key may have rotated`);
  else if (isMissingFn(probe)) bad("get_trainer function missing (PGRST202)");
  else ok(`accepted (get_trainer resolves, HTTP ${probe.status})`);

  // 3. Read RPCs + full-row update signatures — need a real trainer, so only with a read key.
  let trainer: any = null, pk: any = null;
  if (readKey) {
    trainer = (await rpc("get_trainer", { _read_key: readKey })).json?.[0] || null;
    if (!trainer) bad(`get_trainer returned no trainer for the supplied read key`);
    else {
      const team = (await rpc("get_pokemon", { _trainer_id: trainer.id })).json || [];
      pk = team[0] || null;
      console.log("\nRead RPCs:");
      const reads: [string, any][] = [
        ["get_pokemon", { _trainer_id: trainer.id }], ["get_moveset", { _pokemon_id: pk?.id }],
        ["get_inventory_items", { _read_key: readKey }], ["get_held_items", { _pokemon_id: pk?.id }],
        ["get_pokemon_feats", { _pokemon_id: pk?.id }], ["get_trainer_feats", { _read_key: readKey }],
      ];
      for (const [fn, b] of reads) {
        const r = await rpc(fn, b);
        isMissingFn(r) ? bad(`${fn} missing (PGRST202)`) : Array.isArray(r.json) ? ok(`${fn} (${r.json.length} rows)`) : bad(`${fn}: unexpected (HTTP ${r.status})`);
      }
    }
  } else {
    skip("read RPCs + full-row update signatures (pass a read key to include them)");
  }

  // 4. Write-RPC signature compatibility (fake key → no mutation; PGRST202 = Conduit's call would break).
  console.log("\nWrite-RPC signatures (Conduit's exact params; fake key, no mutation):");
  const stub: AddPokemonSpecies = {
    id: "bulbasaur", name: "Bulbasaur", types: ["grass", "poison"], ac: 12, hp: 10, hitDice: "d8", minLevel: 1,
    stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, saves: ["con"], skillIds: ["stealth"], abilities: [],
  };
  const sigChecks: [string, any][] = [
    ["add_pokemon", buildAddPokemonParams(FAKE, stub, 5)],
    ["update_move", { _write_key: FAKE, _id: 0, _move_id: "tackle", _pp_cur: 0, _pp_max: 0, _notes: "" }],
    ["add_inventory_item", { _write_key: FAKE, _item_id: "potion", _quantity: 1, _custom_name: null, _description: null }],
    ["update_inventory_item", { _write_key: FAKE, _id: 0, _item_id: "potion", _quantity: 1, _custom_name: null, _description: null }],
    ["add_held_item", { _write_key: FAKE, _pokemon_id: 0, _item_id: "leftovers", _custom_name: null, _description: null, _rank: 0 }],
    ["remove_held_item", { _write_key: FAKE, _id: 0 }],
    ["remove_pokemon", { _write_key: FAKE, _id: 0 }],
    ["delete_trainer", { _write_key: FAKE, _id: "00000000-0000-0000-0000-000000000000" }],
  ];
  if (trainer) sigChecks.unshift(["update_trainer", { ...buildParams(TRAINER_PARAMS, trainer, {}), _write_key: FAKE }]);
  if (pk) sigChecks.unshift(["update_pokemon", { ...buildParams(POKEMON_PARAMS, pk, {}), _write_key: FAKE }]);
  if (!trainer) skip("update_trainer / update_pokemon full-row signatures (need a read key)");
  for (const [fn, b] of sigChecks) {
    const r = await rpc(fn, b);
    isMissingFn(r) ? bad(`${fn}: signature changed (PGRST202) — Conduit's params no longer match`) : ok(`${fn} resolves (HTTP ${r.status})`);
  }

  console.log(`\n${breaks ? `\x1b[31m✗ ${breaks} compatibility problem(s) — Conduit may be broken against poke5e.\x1b[0m` : "\x1b[32m✓ No breaking changes — Conduit is compatible with poke5e.\x1b[0m"}`);
  process.exit(breaks ? 1 : 0);
}
main().catch((e) => { console.error("compat check failed to run:", e); process.exit(2); });
