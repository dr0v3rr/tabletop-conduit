# Conduit

A single-window desktop app that puts your character sheet next to your virtual tabletop and
sends properly-formatted rolls into it — a conduit between your sheets and your table. A spiritual
successor to Beyond20, packaged as a standalone Electron app.

**Character-sheet sources:** D&D Beyond, poke5e (Pokémon 5e), and SRD/Open5e + D&D Beyond monsters.
**Virtual tabletop:** Roll20 (with room for more).

- **Left pane** — a rules engine reading your live D&D Beyond sheet: ability checks, saves,
  skills, attacks, spells, HP, conditions, inventory, spell slots, hit dice.
- **Right pane** — your actual Roll20 game (or the D&D Beyond web page), toggleable.
- Clicking a roll injects a native Roll20 chat command using the D&D 5e sheet templates
  (`simple` / `atkdmg` / `spell`), with advantage/disadvantage, one-off modifiers, whisper,
  crit, and initiative → turn tracker.
- Two-way sync with D&D Beyond: using a potion decrements its quantity, taking damage updates
  your HP, spending a slot marks it used — all written back to your DDB sheet.

> Licensed under **GPL-3.0-or-later**.

**Downloads:** prebuilt installers (macOS / Windows / Linux) are on the
[Releases page](https://github.com/dr0v3rr/tabletop-conduit/releases) — see
[`docs/RELEASES.md`](docs/RELEASES.md) for artifacts, checksums, and install notes.

---

## Screenshots

**D&D Beyond tab** — the rules-engine panel on the left reads your live sheet; the right pane
shows your D&D Beyond character. Top to bottom on the left: the character picker with
`Load`/refresh, the `Table` / `D&D Beyond` pane toggle, a live **`DDB: synced ✓`** status badge and
`← Menu`, the at-a-glance **stat strip** (AC · Speed · Init · Passive Perception/Investigation/
Insight), `+ Condition`, the **roll modes** (`S·Dis` / `Dis` / `Normal` / `Adv` / `S·Adv`), a one-off
**"This roll"** modifier with **Whisper** and **Reroll**, a **search** box, and the **HP tracker** —
bar, damage-type selector, `– Damage` / `+ Heal`, **Undo**, **Bind Token**, and **Temp** HP — with
**resistances** listed beneath.

![Conduit — D&D Beyond tab](docs/images/01-dnd-beyond-tab.png)

**Table (Roll20) tab** — the same panel with your actual Roll20 game on the right. Clicking a roll
injects a formatted chat command (here, Ember's attack + damage cards). Scrolling the panel down
reveals **Abilities** and **Saving Throws**. *(Account handle and other players are redacted.)*

![Conduit — Table (Roll20) tab](docs/images/02-table-roll20-tab.png)

**Panel — spells, items, rests, log** — further down the left panel: **Spells** (attack bonus / save
DC + `Rest`), **Inventory** (rollable and consumable items with quantity controls + `Use`),
**Rests** (Hit-Dice pips, `Short Rest` / `Long Rest`), **Roll Options**, and a **Session Log** with
roll statistics and `Full Sync` / `Sync`.

![Conduit — items, rests, session log](docs/images/03-panel-items-rests-log.png)

---

## Requirements

- **Node.js 20+** (developed on 22.x) and npm — only needed to run from source or build.
- **macOS** (Apple Silicon or Intel) or **Windows 10/11**.
- A **D&D Beyond** account and a **Roll20** account (you sign into both inside the app).
- No database or external services to configure. The app talks directly to dndbeyond.com and
  roll20.net using your own logged-in session.

---

## Quick start (run from source)

```bash
npm install       # once, to fetch dependencies
npm run shell     # build the app bundles and launch it
```

`npm run shell` compiles the TypeScript into `dist-electron/` and opens the app window. Then:

1. In the right pane, use the **D&D Beyond** tab and sign in. (Do the same for **Roll20** — the
   "Table" tab.) Your logins are remembered between launches.
2. The character picker at the top left fills in with your characters a few seconds after you
   sign in. Pick one.
3. Open your Roll20 game in the "Table" tab. Click any roll on the left — it posts to the chat.

---

## npm scripts

| Command | What it does |
|---|---|
| `npm run shell` | Build bundles **and** launch the app (the normal "run it" command). |
| `npm run shell:build` | Just build the Electron bundles into `dist-electron/` (no launch). |
| `npm test` | Run the rules-engine test suite (Vitest). |
| `npm run typecheck` | Type-check the whole project with `tsc --noEmit`. |
| `npm run build` | Type-check/emit via `tsc` (library build of the engine). |
| `npm run pack` | Package an **unpacked** app into `release/` (fast; for local sanity checks). |
| `npm run dist` | Build installers for the **current** OS into `release/`. |
| `npm run dist:mac` | Build a macOS **`.dmg` + `.zip`** into `release/`. |
| `npm run dist:win` | Build a Windows **installer (`.exe`) + portable `.exe`** into `release/`. |

---

## Building a distributable (to give to someone else)

Packaging uses **electron-builder**. Output lands in `release/`.

### macOS

```bash
npm run dist:mac
```

Produces `release/*.dmg` (double-click to install) and a `.zip`. Builds for the architecture of
the Mac you build on — pass `--x64`, `--arm64`, or `--universal` to `electron-builder` for others,
e.g.:

```bash
npm run shell:build && npx electron-builder --mac --universal   # runs on Intel + Apple Silicon
```

### Windows

```bash
npm run dist:win          # builds x64 by default via bundled Wine
```

Produces `release/Conduit Setup <version>.exe` (NSIS installer) and a portable
`.exe`. This **cross-builds from macOS** using a Wine toolchain electron-builder downloads on
first run. It works, but the gold-standard "clean" Windows build is on a real Windows machine or
CI — if you have access to one, run the portable `.exe` once there to confirm it boots.

To force a specific architecture:

```bash
npm run shell:build && npx electron-builder --win nsis portable --x64
```

### Code signing (important caveat)

These builds are **unsigned**, so the first launch shows a warning:

- **macOS:** "unidentified developer" — right-click the app → **Open** → **Open** (once).
- **Windows:** SmartScreen "Windows protected your PC" — **More info** → **Run anyway**.

That's expected and fine for handing to a friend. Proper signing needs a paid Apple Developer ID
(~$99/yr) and/or a Windows code-signing certificate; wire those into the `build` block in
`package.json` if you ever distribute widely.

---

## Using the app

- **Character picker** (top left) — lists your D&D Beyond characters once you're signed into the
  DDB pane. It auto-loads the last one you used. If you're not signed in yet it falls back to a
  raw character-ID box; sign in and click the **⟳** refresh button. **`Load`** (re)loads the
  selected character.
- **Pane toggle & Menu** — `Table` / `D&D Beyond` switches what the right pane shows (your Roll20
  game or the DDB web page); **`← Menu`** returns to the app's top-level menu.
- **Sync status** — the **`DDB: synced ✓`** badge shows whether the panel reflects your live DDB
  sheet; it flips while a write is in flight and settles once DDB confirms.
- **Stat strip** — at-a-glance **AC**, **Speed**, **Initiative**, and passive **Perception /
  Investigation / Insight**. Clicking **Init** rolls initiative into the Roll20 turn tracker.
- **Roll options** — advantage/disadvantage (and super-adv/dis), a one-off **"This roll"** modifier,
  a **Whisper**-to-GM toggle, and **Reroll** (re-send the last roll) apply to what you click next.
- **Search** — filter skills, attacks, and spells by name.
- **Rolls** — abilities, saves, skills, initiative, weapon attacks, and spells. Attack and damage
  spells render as 5e attack/damage cards; utility casts render as a simple card.
- **HP tracker** — apply damage (with a **damage-type** selector) or heal; it writes back to D&D
  Beyond and, if a Roll20 token shares the character's name, updates that token's HP bar. **Undo**
  reverts the last change, **Bind Token** pins the sheet to a specific Roll20 token, and **Temp**
  sets temporary HP (shown on the token's second bar). Any **resistances/immunities** are listed
  beneath.
- **Conditions** — click **`+ Condition`** to apply/clear; posts a note to Roll20 and applies the
  mechanical advantage/disadvantage effects to affected rolls.
- **Abilities & Saving Throws** — full ability-check and saving-throw rows, each click-to-roll.
- **Spells** — shows spell attack bonus / save DC; casting spends a slot (see below).
- **Inventory** — use/consume items (potions, etc.) with quantity write-back to DDB; rollable items
  post their dice.
- **Spell slots, hit dice & rests** — spend/restore slots, roll/spend Hit Dice, and take a
  **Short** or **Long Rest** — all synced with DDB.
- **Session Log** — running roll statistics for the table (roll count, crits ✦, fumbles ✗) with
  **`Sync`** / **`Full Sync`** to reconcile the panel against DDB.
- **Sign out** (top toolbar) — clears the saved D&D Beyond + Roll20 session so the app behaves
  like a fresh install. Useful for testing first-run, or switching accounts.

---

## Project structure

```
electron/          Electron app: main process, preload bridge, and the sheet renderer (UI)
  main.ts            window + 3 web views, all IPC handlers, DDB API + Roll20 injection
  preload.ts         the safe window.api bridge exposed to the renderer
  sheet.html/.css/.ts the left-pane UI
src/               Platform-agnostic rules engine and helpers (unit-tested, no Electron)
  engine/            character-service JSON → roll model (abilities, saves, skills, HP, …)
  rules/             the rule/effect registry (advantage sources, riders, conditions)
  compose/           roll model + request → a Roll20 chat command
  roll20/            chat-injection and templating (simple/atkdmg/default) + log scraping
  ddb/               D&D Beyond page-context injectors (inventory, char list, slots, …)
  spells, spell-slots, weapons, conditions, hp, inventory, stats …
scripts/
  build-electron.mjs esbuild bundler → dist-electron/ (main.js, preload.cjs, sheet.*)
docs/              engine spec + reference implementations
test/              Vitest suites, incl. a golden test vs. D&D Beyond's own computed sheet
dist-electron/     build output that the app actually runs (generated)
release/           packaged installers/apps (generated by electron-builder)
```

### How it fits together

- The **main process** (`electron/main.ts`) owns a `BaseWindow` with three `WebContentsView`s:
  the sheet UI (with a preload + context isolation), the Roll20 game, and the D&D Beyond page.
- **Character data** is fetched from D&D Beyond's character-service API. Writes (HP, conditions,
  slots, item quantities) go through an authenticated request in the main process that mints a
  short-lived token from your D&D Beyond cookies — so it works even for **private** characters
  and never depends on which page the DDB pane is showing.
- **Rolls** are computed by the engine in `src/`, turned into a Roll20 chat command by
  `src/compose`, and injected into the Roll20 chat textarea by `src/roll20`.
- The engine in `src/` is pure and fully unit-tested; the golden test pins it against D&D
  Beyond's own rendered numbers for a real character.

---

## Development

```bash
npm run typecheck    # tsc, no emit
npm test             # Vitest
npm run shell        # rebuild + launch to try changes
```

The engine (`src/`) has no Electron dependency, so you can iterate on rules logic with just the
tests. The UI lives in `electron/sheet.ts` and rebuilds via `npm run shell:build`.

### Secret scanning (defense-in-depth)

A [TruffleHog](https://github.com/trufflesecurity/trufflehog) **pre-commit hook** scans staged
changes and blocks a commit that would introduce a secret. Enable it once per clone:

```bash
brew install trufflehog                       # (or see TruffleHog's install docs)
git config core.hooksPath scripts/git-hooks   # activate the hook in scripts/git-hooks/pre-commit
```

- It materializes and scans exactly the **staged** content (not the working tree).
- `test/fixtures/` is excluded via `.trufflehog-exclude` — those are D&D Beyond API dumps full of
  hash-like IDs that trip false positives; they've been manually verified clean.
- A false positive elsewhere? Add its path/regex to `.trufflehog-exclude`. Need to bypass one
  commit? `git commit --no-verify` (use sparingly, and rotate anything real).

Manual scans (history, not just staged):

```bash
scripts/scan-secrets.sh              # default detectors, fixtures excluded
scripts/scan-secrets.sh --verified   # only VERIFIED live secrets (network-checked, zero noise)
scripts/scan-secrets.sh --full       # everything incl. fixtures (expect known FPs)
```

---

## Troubleshooting

- **Character list is empty / stuck on an ID box.** You're not signed into D&D Beyond in the
  right pane yet. Open the **D&D Beyond** tab, sign in, and the list appears within a few seconds
  (or click the **⟳** button). Private characters need you signed in.
- **Rolls post as a plain black box with a red line.** That's Roll20's universal
  `&{template:default}`, used when your game doesn't have the **D&D 5e by Roll20** character sheet.
  Install that sheet in your Roll20 game and the app auto-detects it and switches to the pretty
  5e cards.
- **A token's HP won't update from the app.** The Roll20 token must share the character's name,
  and you must have permission to edit it (you can't move an uncontrolled monster's bars).
- **"Unidentified developer" / SmartScreen warning.** Expected for unsigned builds — see
  [Code signing](#code-signing-important-caveat).
- **Want to test a fresh install without reinstalling.** Use the **Sign out** button, which wipes
  the saved session.

---

## License

GPL-3.0-or-later.
