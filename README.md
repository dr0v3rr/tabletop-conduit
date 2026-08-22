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
  raw character-ID box; sign in and click the **⟳** refresh button.
- **Roll options** — advantage/disadvantage (and super-adv/dis), a one-off "this roll" modifier,
  and a whisper-to-GM toggle apply to whatever you click next.
- **Rolls** — abilities, saves, skills, initiative, weapon attacks, and spells. Attack and damage
  spells render as 5e attack/damage cards; utility casts render as a simple card.
- **HP tracker** — apply damage/heal; it writes back to D&D Beyond and (if a Roll20 token shares
  the character's name) updates that token's HP bar.
- **Conditions** — click to apply/clear; posts a note to Roll20 and applies the mechanical
  advantage/disadvantage effects to affected rolls.
- **Inventory** — use/consume items (potions, etc.) with quantity write-back to DDB.
- **Spell slots & hit dice** — spend/restore, synced with DDB.
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
