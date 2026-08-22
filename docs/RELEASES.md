# Releases

Conduit is distributed as **prebuilt installers attached to GitHub Releases**, not committed
to the repository (the binaries are large and git-ignored via `release/`). Each tagged release
carries one artifact per platform/architecture plus SHA-256 checksums.

- **Releases page:** https://github.com/dr0v3rr/tabletop-conduit/releases
- Builds are **unsigned** — see [First-launch warnings](#first-launch-warnings-unsigned-builds).

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

```bash
VERSION=0.2.2
cd release
shasum -a 256 Conduit-* > SHA256SUMS
gh release create "v$VERSION" \
  "Conduit-$VERSION-arm64.dmg" "Conduit-$VERSION-arm64-mac.zip" \
  "Conduit Setup $VERSION.exe" "Conduit $VERSION.exe" \
  "Conduit-$VERSION.AppImage" "Conduit-$VERSION-arm64.AppImage" \
  SHA256SUMS \
  --title "Conduit v$VERSION" --notes-file ../docs/release-notes/v$VERSION.md
```

Bump `version` in `package.json` before building so artifact names and the tag line up.
