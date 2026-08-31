# Releases

Conduit is distributed as **prebuilt installers attached to GitHub Releases**, not committed
to the repository (the binaries are large and git-ignored via `release/`). Each tagged release
carries one artifact per platform/architecture plus SHA-256 checksums.

- **Releases page:** https://github.com/dr0v3rr/tabletop-conduit/releases
- Builds are **unsigned** — see [First-launch warnings](#first-launch-warnings-unsigned-builds).

---

## v0.2.11 — bag management + trainer list

- **＋ Add item** — add a standard item to a poke5e bag you own (searchable catalogue, creates the
  row via `add_inventory_item`). The Items section now stays visible for an empty bag so a fully-
  removed item can be re-added.
- **± quantities persist** — the inventory steppers write back through `update_inventory_item` when
  you hold the write key (previously the ± buttons were local-only; only the catch card persisted).
- **Remove vs. Delete a trainer** — **✕ Remove** forgets it from your list only (stays in poke5e);
  **🗑 Delete** permanently removes it via `delete_trainer` (owner-only, confirmation dialog). Laid
  out on a row below the trainer name.
- **Update checker** — checks GitHub Releases for a newer version and offers to update / relaunch.
- **Refresh reloads the poke5e pane** so the trainer list reflects out-of-band changes.
- Roster hide/show is a **checkbox**; window title reads **Conduit v<version>**; dev builds show the
  real icon/version.
- **Strict release pipeline** (`scripts/release.mjs` + `verify-release.mjs`) re-hashes every artifact
  against its manifest/`SHA256SUMS` before publishing (fail-closed).

## v0.2.10 — the catch loop

- **Catch card** — a shared flow launchable from the **Pokédex** (species preset) or an **inventory
  Poké Ball throw** (ball preset + target-species search). It's a **roll builder**: shows your Animal
  Handling catch roll with modifiers — ball bonus (Great +5, Ultra +10, Safari +Nature, Master =
  auto), an **Advantage** toggle, and an **Other** bonus. **🎲 Throw** posts the real roll to Roll20
  and consumes a ball; the GM adjudicates (no DC/HP shown — you won't have those at the table).
- **Caught = your poke5e roster** — **✔ Add to poke5e** creates the Pokémon on your trainer via
  `add_pokemon` at the chosen level; it then shows **● Caught · on poke5e**. Read-only trainers get a
  local caught tick. **Seen** stays a manual, persisted flag.
- **Inventory write-back** — poke5e bag quantities now persist (`update_inventory_item`) when you
  hold the write key.
- Enforces the rule that you can't catch a Pokémon above your trainer's level.

No data-format changes. Tests: 256 passing.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.10-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.10-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.10.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.10.exe` | Portable |
| Linux | x64 | `Conduit-0.2.10.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.10-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
65fda8a3332755216ea7e84fabf190f278feb9205723b4e40b918c03d9339068  Conduit-0.2.10-arm64.dmg
c5690f8b24881051ed61371fd894e70e1de5c52b8bebd3c29104a3875f3e77c8  Conduit-0.2.10-arm64-mac.zip
d98f9690c9eef52f3c2e7fbc8b1ac29e5e506c3f1f86f5bfc1ee99c1220057d2  Conduit Setup 0.2.10.exe
35ab5f84ffff8d4f7f6291f64b431cf1b1a0d1eaa5c4755f7ab446fde2ec7873  Conduit 0.2.10.exe
ef15c88cec0786440837a7535fcaf3928a7ef6abe0023190a2817236c51cc884  Conduit-0.2.10.AppImage
6019e45d0ac590ee837a53ee765cd795c8c813840d0e785a7e27ee3ad61a6f12  Conduit-0.2.10-arm64.AppImage
```

---

## v0.2.9 — in-app Pokédex + trainer path/specialisation

- **📕 Pokédex (poke5e-only tab)** — browse all 1,139 official species with sprites/art: filter by
  name, region, SR, type, and collection state (fakémon hidden behind a toggle); detail shows the
  stat block, **abilities with text**, moves, evolution, and a **Catch card** (`DC = 10 + ⌊SR⌋ +
  level` vs Animal Handling). Every ability/move/species has a **📖 Display in VTT** button.
  **Seen** is a manual, persisted encounter flag; **Caught** is derived from your trainer's team.
- **Trainer path & specialisation** — a loaded poke5e trainer now surfaces their Path (Guru, with
  rank features) and Specialisation(s) (e.g. Dragon Tamer, with stacks + effect); skill proficiency
  reads poke5e's rank so **expertise** doubles correctly.
- **Initiative** relocated to a **⚡ Init** quick-roll in the Roll controls (was under Saving Throws)
  — available on every sheet.
- **Window title** is now `Conduit v<version>`.

No data-format changes. Tests: 253 passing.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.9-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.9-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.9.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.9.exe` | Portable |
| Linux | x64 | `Conduit-0.2.9.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.9-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
b293f499c39b09195cc09c2f781b7cfa4e160ccacb3513c615e7cf228efc5a49  Conduit-0.2.9-arm64.dmg
b650a59349954f7ea9c5f75a7058351d480a1389da0108a6eabc799025b1aba0  Conduit-0.2.9-arm64-mac.zip
40b81251d69b961b4ab4e9ad3a2e7e5e0a14d30aeaf5a76e3e07a374df1114a9  Conduit Setup 0.2.9.exe
704804339ac49318314c5c3a0abe28388dab293be4189e1cc71bb2ba0dfd039d  Conduit 0.2.9.exe
cafd6b723695b6cf05ede97429da5369054ec9f13c31db11a12d9770a491cd11  Conduit-0.2.9.AppImage
13942e8354925be00adbed850d408cc51d698846e52934f25ba0d674364334e1  Conduit-0.2.9-arm64.AppImage
```

---

## v0.2.8 — Display in VTT

- **📖 Display in VTT** — a compact button next to every move, spell, weapon, feat/ability, and
  inventory item that has descriptive text. Click it and Conduit posts that thing's full wording to
  the Roll20 chat as a `&{template:default}` info card (name + a details sub-line + the text),
  attributed to your active character and visible to the whole table.
- **Move/spell/weapon wording plumbed through** — poke5e move descriptions (incl. moves whose text
  holds structured tables like Fling/Acupressure, flattened to prose) plus DDB spell/weapon text now
  reach the sheet.
- **Untrusted-text hardening** — the pure, unit-tested card builder strips HTML, decodes entities,
  removes `{`/`}` so scraped/API wording can't break out of or forge the `{{ … }}` template, and
  caps length. Uses the universal `default` template so it renders in every game.

No engine or data-format changes. Tests: 240 passing (adds card-sanitizer + move-wording suites).

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.8-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.8-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.8.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.8.exe` | Portable |
| Linux | x64 | `Conduit-0.2.8.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.8-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
1d62a4632c20851e0ca840da2145e8985829220d78e1db1e6a6ed2415534366c  Conduit-0.2.8-arm64.dmg
d0a709f9ac93bdaaa95e4202d143d1aec51b64d388961dd867995403f97f3b9c  Conduit-0.2.8-arm64-mac.zip
8c05a6f409a1f85af1a3c6f8837cde55bcd7367552301cc467da3d4c5f12a3db  Conduit Setup 0.2.8.exe
0606ee702b20090a607e86ce9db96e6801913d0452a36a6277cc1f63bac404e0  Conduit 0.2.8.exe
a08583b9fd53c7d8f5b65ceb04d92c32d43caf8ba4cd809e6ab87aabe9e69457  Conduit-0.2.8.AppImage
7ae1b9abc584ab7e0fa59189a6d261cea6b2bef9bb37a6d0f7729760062809ba  Conduit-0.2.8-arm64.AppImage
```

---

## v0.2.7 — native-roll capture fix + app icon

- **Session Log now captures native Roll20 rolls.** The scraper only parsed *template* rolls
  (`.inlinerollresult`). Manual/macro dice typed into Roll20 — `/roll`, `/gmroll`, and anything
  rendered as `message rollresult` — use a different DOM (`.formula` / `.rolled` / `.dicegrouping`)
  with no `.inlinerollresult` and were silently skipped. Conduit now parses that format too, so
  saves, damage, GM rolls, and hand-typed `/roll`s all show up in the log and campaign-wide stats.
  Verified live: captured rolls went **6 → 17** on a real campaign (4 previously-invisible GM rolls
  plus several manual `/roll`s).
- **Real app icon.** Replaces the generic default Windows *setup* icon — the app, the macOS `.icns`,
  the Linux `.png`, the Windows `.ico`, and the NSIS Setup/uninstaller icons all now carry Conduit's
  own icon (a conduit linking two nodes).

No engine or data-format changes — existing archives and stats carry over. Tests: 226 passing.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.7-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.7-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.7.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.7.exe` | Portable |
| Linux | x64 | `Conduit-0.2.7.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.7-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
b8db870ae479d41493ea9581f949012cf68c278a9962b0f92b17ba7b3c0fafbe  Conduit-0.2.7-arm64.dmg
6a907a16e72fb8ad130763e94495191aa9496d6f8d607f9e011036d498295559  Conduit-0.2.7-arm64-mac.zip
9000f74b15a31dc2725537ee632e42ada00f9119a8c221204a1a5d5a9c2d6b34  Conduit Setup 0.2.7.exe
1caee4574f1ee2dc907de44e2f5d35a398184132a7c9c5f752f019c05e39a294  Conduit 0.2.7.exe
5a4ea76b5b1a48914aedd8a48e83f3e0cae942b5c506c95635abf0e96bd1a64b  Conduit-0.2.7.AppImage
6c914adb07b36d9b37a283f4d673569adb1a96c452e1647789a8574e38cb9a2f  Conduit-0.2.7-arm64.AppImage
```

---

## v0.2.6 — durable roll history + campaign-wide stats

- **Roll archive** — captures every roll from first interaction into a durable, append-only,
  per-campaign log (`~/.conduit/roll-logs/<campaignId>.jsonl` on macOS/Linux,
  `%APPDATA%\Conduit\roll-logs\` on Windows), independent of the in-app view. **📁 Archive** button opens it.
- **Campaign-wide stats** — the stats table / Stats CSV aggregate over the whole archived history,
  surviving a Clear and Roll20's chat eviction.
- **Adversarial security hardening** — archive filenames derived from the untrusted `campaign_id` are
  whitelisted (no separators/dots, length-capped, Windows-reserved-name-safe) with a path-containment
  guard (unit-tested); content written via `JSON.stringify` can't forge the JSONL structure.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.6-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.6-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.6.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.6.exe` | Portable |
| Linux | x64 | `Conduit-0.2.6.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.6-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
ae95a4873b645da768c1451006389d2ea739d8640bdd1271206f0bdc534dc4e6  Conduit-0.2.6-arm64.dmg
c15942457861a2369a8965e65c0645c031a36891c1aeeb98d49e69feeadc2174  Conduit-0.2.6-arm64-mac.zip
a02a3c3ee7c519058a3031a79c967dc37fc1c8b7b4b23a60d1f9c9bece559734  Conduit Setup 0.2.6.exe
635ba55da14cf4bfd6f56aa2e8ebafbafffd399c3ec478e0d0e988fabf9dec28  Conduit 0.2.6.exe
51ab1a8f407c4876e83507f3bdbf5eafdd5062fec2fdaaa9514469aad05be48d  Conduit-0.2.6.AppImage
f3ec7a674073bbfb2ec295a8acb84bd990c999292c82489b1865a56313b1551d  Conduit-0.2.6-arm64.AppImage
```

---

## v0.2.5 — poke5e ↔ Roll20 name sync

- **Push poke5e names into Roll20.** poke5e is the source of truth for names; when you bind a
  Pokémon to a Roll20 token whose name differs, Conduit offers to rename the token **and** the
  character it represents to match poke5e (the character name is what drives the Roll20 chat
  speaker). Confirms each time; only touches tokens/characters you control.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.5-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.5-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.5.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.5.exe` | Portable |
| Linux | x64 | `Conduit-0.2.5.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.5-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
12b919cee06375bb31988a59b92ec22a2ba80262060460727c25577dcc494f5a  Conduit-0.2.5-arm64.dmg
f13d8416ef2eea29dc3217c68270bcd96de1a4b9a691bdc4117f400c02767638  Conduit-0.2.5-arm64-mac.zip
1f9dffdb67fffcc55f71c21fe50c2d2973cbdb1a04aa1aec2a4a2769c09de91a  Conduit Setup 0.2.5.exe
d821b4f8a9fba829e1ffb4cf46a4b4f7e1a651f4d4d524fb3c123750424e149a  Conduit 0.2.5.exe
35462c42b0cc0fdf54067998c394f763da0ceb631bc99c756da1955aba5a1570  Conduit-0.2.5.AppImage
03dd3f0e9bc19bab5b2544be46702bd1ff556be0ea05484d990cc204d52c32c2  Conduit-0.2.5-arm64.AppImage
```

---

## v0.2.4 — poke5e resilience

- **Auto-detects the poke5e API key + endpoint** from the live site's own traffic, so a rotated
  anon key (or an endpoint move) no longer breaks Pokémon sheets. Detected value is cached and
  re-applied on the next launch; a baked-in default is used only until detection happens.
- **Handles poke5e's move to `api.poke5e.app`** (from the raw Supabase host) — now the default,
  with either endpoint auto-detected.
- Adopts a detected key only if it's an `anon`-role Supabase JWT from a trusted host
  (`*.poke5e.app` / `*.supabase.co`) — never a `service_role`/malformed token or a foreign server.

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.4-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.4-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.4.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.4.exe` | Portable |
| Linux | x64 | `Conduit-0.2.4.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.4-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
6383be3ff2d148b54afc503ea812de26502d434313720577e90975eb85dc2a3b  Conduit-0.2.4-arm64.dmg
81232f2eca2d03d66d99fd0790d082681b10513a1a16998716c9febe499a6565  Conduit-0.2.4-arm64-mac.zip
ab92924aa29a038ce052e91740a6edbcceae341b844a39bac53d8af6af0ba60a  Conduit Setup 0.2.4.exe
33182b7d9cc4d66104ef7a66fb1ad5ac1890ae0fe63614f098ded540ee91c887  Conduit 0.2.4.exe
15f900b1c3d35ccc199502f36602bff586e7d8c5debbb66e79ff1781a0f3f07a  Conduit-0.2.4.AppImage
303c47fb88c700fb0eaca260ff806d0909d8a3ae5e6100cc8c4a07e233370563  Conduit-0.2.4-arm64.AppImage
```

---

## v0.2.3 — security update

Runtime + toolchain maintenance. **Recommended for all users.**

- **Electron 33 → 43.4.1** — updates the embedded Chromium that renders the live DDB/Roll20 panes.
- **Hardened context menu** on our own UI panes; `Inspect Element` is dev-only (no DevTools on
  packaged builds). Roll20/DDB keep their native site menus.
- Build/test toolchain bumped (electron-builder 26, vitest 4, esbuild 0.28) — dev-only, never shipped.
- **`npm audit`: 0 vulnerabilities** (the app has no runtime npm dependencies).

### Downloads

| Platform | Arch | File | Type |
|---|---|---|---|
| macOS | arm64 | `Conduit-0.2.3-arm64.dmg` | Disk image |
| macOS | arm64 | `Conduit-0.2.3-arm64-mac.zip` | Zipped `.app` |
| Windows | x64 | `Conduit Setup 0.2.3.exe` | NSIS installer |
| Windows | x64 | `Conduit 0.2.3.exe` | Portable |
| Linux | x64 | `Conduit-0.2.3.AppImage` | AppImage |
| Linux | arm64 | `Conduit-0.2.3-arm64.AppImage` | AppImage |

### SHA-256 checksums

```
0f1029d3b2a3026397f057c7bf7682ee73cecc239a0d977b8e1bef3667595f38  Conduit-0.2.3-arm64.dmg
cc63c02e57a7720517b5c23502f4f74e7580d7f90a92fcfd1294eff22a9cd13c  Conduit-0.2.3-arm64-mac.zip
8bc2f1eb6bf8434d744f9be4f54928ad1bf0f0dabab22db7a00c67f0dde79efa  Conduit Setup 0.2.3.exe
6b29d3e6550511bee25b860794c7edc945617a707244133761447ddc20083d71  Conduit 0.2.3.exe
6c4a45491a411a90e2d84231ec0ea0683950b46d008844f1393c070aec8c2407  Conduit-0.2.3.AppImage
506032a5d90e4ee969ae73310930313e4d5992f7a1f739fee60853949a303999  Conduit-0.2.3-arm64.AppImage
```

---

## v0.2.2 — first Conduit release

First release under the **Conduit** name (formerly the internal "DDB-Roll20 Companion"). Same
engine and app; rebranded for multi-source / multi-VTT scope.

### Downloads

| Platform | Arch | File | Type | Size |
|---|---|---|---|---|
| macOS | Apple Silicon (arm64) | `Conduit-0.2.2-arm64.dmg` | Disk image (drag-to-install) | ~98 MB |
| macOS | Apple Silicon (arm64) | `Conduit-0.2.2-arm64-mac.zip` | Zipped `.app` | ~95 MB |
| Windows | x64 | `Conduit Setup 0.2.2.exe` | NSIS installer | ~82 MB |
| Windows | x64 | `Conduit 0.2.2.exe` | Portable (no install) | ~82 MB |
| Linux | x64 | `Conduit-0.2.2.AppImage` | AppImage | ~108 MB |
| Linux | arm64 | `Conduit-0.2.2-arm64.AppImage` | AppImage | ~108 MB |

> **macOS is Apple-Silicon only** for this release (built on an arm64 host). Intel Macs can run
> it under Rosetta from the `.zip`, or build a universal binary from source (see below).

### SHA-256 checksums

```
8a3779f43773b82492071c39c1af16efda4fa8282974e5ca8e2ec7c436971617  Conduit-0.2.2-arm64.dmg
556d9ad58da7e21cc1e7d1c2b40e1914e9add222b31059802f2d29d84ca0eb82  Conduit-0.2.2-arm64-mac.zip
99111bd3cc70c2a9074de62c0268a887cd7a0f03bb6b27fc0e3a204a8127932c  Conduit Setup 0.2.2.exe
03c373412e2662ab21f012a9e9865d2d28ef024d9905288174ff83ddffc80fac  Conduit 0.2.2.exe
925d0c1bb35690ce4d6e4eee42b8b669bca3cd67251501d5fc42450d170688a2  Conduit-0.2.2.AppImage
8543da65420e4f836236c0538615fb8c95f40454e9ebbd0dfabeb15b50d10517  Conduit-0.2.2-arm64.AppImage
```

Verify a download:

```bash
shasum -a 256 -c <(grep 'Conduit-0.2.2-arm64.dmg' SHA256SUMS)   # macOS/Linux
# or compare manually:
shasum -a 256 "Conduit-0.2.2-arm64.dmg"
```

### Install

- **macOS (.dmg):** open the image, drag **Conduit** to Applications. First launch: right-click
  the app → **Open** → **Open** (bypasses the unsigned-developer gate once).
- **Windows (Setup .exe):** run it; SmartScreen may warn — **More info** → **Run anyway**. The
  **portable** `.exe` needs no install and leaves no registry entries.
- **Linux (AppImage):** `chmod +x Conduit-0.2.2*.AppImage && ./Conduit-0.2.2*.AppImage`. Pick the
  file matching your CPU (`-arm64` for ARM, otherwise the x64 one).

### First-launch warnings (unsigned builds)

These builds are **not code-signed**, so the OS shows a one-time warning:

- **macOS:** "unidentified developer" → right-click → **Open**.
- **Windows:** SmartScreen "Windows protected your PC" → **More info** → **Run anyway**.

This is expected. Proper signing needs a paid Apple Developer ID and/or a Windows code-signing
certificate; wire those into the `build` block in `package.json` before distributing widely.

---

## Building releases yourself

From a clean checkout (Node 20+, developed on 22.x):

```bash
npm install
npm run typecheck && npm test      # gate the build
npm run shell:build                # bundle main/preload/renderer into dist-electron/

npx electron-builder --mac --arm64            # → release/*.dmg + *-mac.zip
npx electron-builder --win --x64              # → release/Conduit Setup *.exe + portable
npx electron-builder --linux --x64 --arm64    # → release/*.AppImage (both arches)
```

Notes:
- Output lands in `release/` (git-ignored).
- The **Windows** build cross-compiles from macOS/Linux via a Wine toolchain electron-builder
  fetches on first run. For a gold-standard Windows build, run on a real Windows machine or CI.
- An `afterPack` hook flips [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
  (disables `run-as-node`, cookie-encryption off, etc.) to harden the packaged app.
- A **universal macOS** binary (Intel + Apple Silicon): `npx electron-builder --mac --universal`.

## Publishing a release (maintainers)

Releases go through a strict, fail-closed pipeline — it builds every platform, generates
`SHA256SUMS` from the real files, then re-hashes every artifact against its update manifest and the
checksums before anything is uploaded. Nothing publishes if a single hash doesn't match.

```bash
# 1. Bump `version` in package.json and write docs/release-notes/v<version>.md
# 2. Commit + push (the pipeline requires a clean tree and tags the pushed commit)
npm run release              # build → checksum → verify  (dry run, no upload)
npm run release -- --upload  # the above, then create the GitHub release + tag
#   flags: --allow-dirty (skip the clean-tree guard), --force (overwrite an existing release)
```

The release notes are taken from `docs/release-notes/v<version>.md` automatically. Uploading the
`latest*.yml` manifests is what enables the in-app update checker to see the new version.
