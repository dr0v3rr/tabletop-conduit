# Plan: Read-only capability + Monster/NPC source

Goal: make the app able to load **sheets you don't own** — public D&D Beyond characters,
poke5e shared trainers, and monster/NPC stat blocks — and play with them safely, without
writing anything back to a source you don't control. Rolling is unaffected; only *write-backs*
are gated.

---

## 1. Core concept — capabilities per loaded sheet

Every loaded character gains a **capabilities** descriptor. Rolling only ever *reads*, so it's
always allowed. Everything that mutates a source (HP, spell slots, hit dice, inventory qty,
DDB conditions) is gated on capability.

```ts
interface Capabilities {
  writeHp: boolean;        // sync HP back to the source
  writeSlots: boolean;     // spend/restore spell slots on the source
  writeInventory: boolean; // change item quantities on the source
  // (posting rolls/conditions to Roll20 is a VTT action — NOT gated here)
}
type LoadMode = "read-write" | "read-only";
```

For our sources it's effectively all-or-nothing per sheet, so in practice this collapses to a
single `writable: boolean` on the load payload, with the option to split later.

### What "read-only" means in practice
- **Rolls** → unchanged (checks, saves, skills, attacks, spells all post to Roll20).
- **HP / conditions / slots / hit dice / inventory** → tracked **locally in the app only**.
  The controls stay usable so you can actually play (track a borrowed PC's or a monster's HP
  through a fight); nothing is written to DDB/poke5e.
- **Roll20 token HP sync stays ON** — that's a VTT write, and for a monster you *want* its
  token bar to track. (Only source write-back is disabled.)
- A **"Read-only" badge** by the character name; DDB "sync ✓" chip hidden.

### How `writable` is decided per source
| Source | writable? | How determined |
|---|---|---|
| **D&D Beyond — your character** | ✅ | character's owner id == signed-in user id (from the cobalt→JWT), or it's in your character list |
| **D&D Beyond — public/other's** | ❌ | loaded by id but not owned / not signed in |
| **poke5e — share link (read key)** | ❌ | read key only (write key = later phase) |
| **poke5e — your trainer (write key)** | ✅ (phase 4) | user supplies the write key |
| **Monster / NPC** | ❌ | never writes back; HP is a local session value |

Ownership check for DDB: the character-service JSON carries the owner's user id; compare it to
the signed-in user id we already decode for the character-list call. If absent, fall back to
"in your character list → writable, else read-only." A failed write also downgrades to
read-only (belt & suspenders).

---

## 2. Source registry (makes adding sources clean)

Centralize per-source behavior so the splash, loader UI, and capabilities come from one place.

```ts
interface SourceDef {
  id: "ddb" | "poke5e" | "monster";
  name: string;
  loaderUi: "picker" | "paste-key" | "search";  // how you choose a character
  usesRightPane: boolean;                         // embed the source's website?
  paneUrl?: string;                               // dndbeyond.com / poke5e.app / (none)
  defaultWritable: boolean;
}
```

The splash already lists sources; this just formalizes what each one *does* after launch.

---

## 3. Monster / NPC source

### Data provider: **Open5e API** (`https://api.open5e.com/`)
Free, public, no auth, CORS-open, well-documented, SRD + community monsters. Endpoints:
- Search: `GET /monsters/?search=goblin&limit=10` → list of `{slug, name, ...}`.
- Fetch: `GET /monsters/<slug>/` → full stat block.

Chosen over the DDB monster API (auth/undocumented) and free-text stat-block parsing (brittle).
A "paste homebrew JSON" path can come later behind the same interface.

### Monster JSON → RollModel (+ actions)
Open5e gives: `armor_class, hit_points, hit_dice, strength..charisma,
strength_save.. (proficient save mods), perception, skills{}, speed,
actions[{name, desc, attack_bonus, damage_dice, damage_bonus}], special_abilities[]`.

Normalize:
- **Abilities/saves/skills/passives/initiative** → same shape as poke5e normalizer (reuse the
  helpers). Saves: use the explicit `*_save` mods where present, else ability mod.
- **Actions → the "Attacks" section.** Each action with `attack_bonus`+`damage_dice` becomes a
  rollable attack (to-hit + damage) that posts to Roll20 exactly like a weapon. Non-attack
  actions (recharge abilities, etc.) listed as reference/flavor.
- **HP** → local session value (editable, not synced).
- Spellcasting monsters: their spells live in `special_abilities` — **phase 2** for monster
  spellcasting; v1 covers actions/attacks + saves.

### Monster loader UX
Monster mode's loader is a **search box** ("Search a monster… e.g. Goblin") → dropdown of
matches → pick → load into the sheet (read-only, local HP). Load another by searching again.
This reuses the entire existing sheet/roll pipeline. (A multi-monster GM tracker — several
creatures at once — is a richer future phase; v1 is one-at-a-time, same as a character.)

Splash gets a third source card: **Monster / NPC** (with a suitable icon).

---

## 4. Implementation phases

**Phase 1 — Capability foundation (read-only mode).**
- Add `writable` to every load payload; thread it into the sheet.
- Gate source write-backs on `writable`: `applyHp`/`commitHp` (DDB HP write), `spendSlot`,
  `useItem`/`adjustItemQty`, hit-dice/rests, DDB condition write-back → local-only when
  read-only. Keep Roll20 token HP sync on.
- "Read-only" badge in the header; hide the DDB sync chip in read-only.
- DDB: compute `writable` from ownership (owner id vs signed-in id / character list).

**Phase 2 — Public / unowned DDB characters.**
- Allow loading any character id as read-only even when signed in (a "load by id / paste link"
  affordance beside the picker), so you can pull up a public build or pre-gen.

**Phase 3 — Monster/NPC source (Open5e).**
- Source registry + splash card + monster-search loader.
- `search-monsters` / `load-monster` IPC; Open5e fetch + normalize (actions → attacks).
- Read-only + local HP + Roll20 token sync.

**Phase 4 — Later.**
- poke5e write-back via write key; monster spellcasting; multi-monster GM tracker;
  homebrew stat-block paste; per-field capabilities if a source ever needs them.

### Testing
- Unit: ownership→writable logic; monster normalizer (Open5e sample → RollModel + actions);
  reuse the poke5e normalizer tests.
- Integration (CDP, as used throughout): load a public DDB char → read-only badge, HP edits
  local, no write attempt; monster search → load → roll an action into Roll20.

### Risks / notes
- **Ownership detection** is the fiddliest bit; the failed-write→downgrade fallback covers gaps.
- **Open5e** is third-party; cache nothing sensitive, handle offline/error gracefully.
- Read-only must be **obvious** (badge) so users never think their edits are saving.
