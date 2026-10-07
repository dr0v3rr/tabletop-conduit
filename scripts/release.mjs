// Strict, fail-closed release pipeline. Any failing step aborts before anything is published, so a
// release can never ship artifacts that don't match their update manifests / checksums.
//
//   node scripts/release.mjs              # build → checksum → VERIFY  (no upload; safe dry run)
//   node scripts/release.mjs --upload     # the above, then create the GitHub release (verify must pass)
//   node scripts/release.mjs --upload-only# skip the build; re-verify + re-upload the existing release/
//                                         # artifacts to the (existing) release — resume a partial/failed upload
//   flags: --allow-dirty (skip the clean-tree guard), --force (overwrite an existing release)
//
// Uploads are retried with backoff and are idempotent (--clobber), so a transient TLS/5xx blip no
// longer aborts the whole run; any asset still failing after retries is reported at the end.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const REPO = "dr0v3rr/tabletop-conduit";
const REL = "release";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const run = (cmd) => { console.log(`\n$ ${cmd}`); execSync(cmd, { stdio: "inherit" }); };
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };
// Synchronous sleep (no deps) for backoff between retries.
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ } };
// Run an IDEMPOTENT command (e.g. an --clobber upload) with linear backoff. Build/verify use `run`
// (fail-fast) — only network steps that are safe to repeat should retry.
const runRetry = (cmd, tries = 4) => {
  for (let i = 1; i <= tries; i++) {
    try { run(cmd); return; }
    catch (e) {
      if (i === tries) throw e;
      const wait = 2000 * i; // 2s, 4s, 6s
      console.log(`  ↻ attempt ${i}/${tries} failed (${String(e.message || e).split("\n")[0]}); retrying in ${wait / 1000}s…`);
      sleep(wait);
    }
  }
};

const uploadOnly = has("--upload-only"); // resume: re-upload existing release/ artifacts, no rebuild
const upload = has("--upload") || uploadOnly;
const reuseRelease = has("--force") || uploadOnly; // reuse an existing GitHub release rather than creating

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
console.log(`Releasing Conduit ${tag}`);

// --- Guards -------------------------------------------------------------------------------------
if (!has("--allow-dirty") && !uploadOnly) { // upload-only re-uploads a prior build — no source rebuild to gate
  const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (dirty) die("working tree is not clean — commit first (or pass --allow-dirty).");
}
if (upload && !reuseRelease) { // --force / --upload-only intentionally reuse an existing release
  try { execSync(`gh release view ${tag} --repo ${REPO}`, { stdio: "ignore" }); die(`release ${tag} already exists (use --force to overwrite, or --upload-only to resume its upload).`); }
  catch (e) { if (String(e.message || "").includes("already exists")) throw e; /* not found = good */ }
}

if (uploadOnly) {
  // Resume mode: reuse the artifacts a prior run already built + checksummed. No rebuild (that would
  // wipe release/ and change hashes); we only re-verify and re-upload below.
  if (!existsSync(REL) || !existsSync(join(REL, "SHA256SUMS"))) {
    die("--upload-only needs an existing build in release/ (with SHA256SUMS). Run a full `--upload` first.");
  }
  console.log("\n(--upload-only) skipping build — re-verifying + re-uploading the existing release/ artifacts.");
} else {
  // --- Build (fresh; one consistent source state) -----------------------------------------------
  rmSync(REL, { recursive: true, force: true }); // no stale artifacts from a previous version can leak in
  run("npm run shell:build");
  run("npx electron-builder --mac --publish never");            // macOS arm64 dmg + zip
  run("npx electron-builder --win --x64 --publish never");      // Windows x64 nsis + portable
  run("npx electron-builder --linux --x64 --arm64 --publish never"); // Linux x64 + arm64 AppImage (one pass → one consistent latest-linux.yml)

  // --- Checksums generated from the actual built files (never hand-maintained) ------------------
  const installers = readdirSync(REL).filter((f) => /\.(dmg|zip|exe|AppImage)$/.test(f)).sort();
  if (!installers.length) die("no installers were produced.");
  const sums = installers.map((f) => `${createHash("sha256").update(readFileSync(join(REL, f))).digest("hex")}  ${f}`).join("\n") + "\n";
  writeFileSync(join(REL, "SHA256SUMS"), sums);
  console.log(`\nSHA256SUMS written for ${installers.length} artifacts.`);
}

// --- Integrity gate: re-hash everything vs the manifests/checksums. Aborts on any mismatch. -----
run("node scripts/verify-release.mjs");

if (!upload) { console.log(`\n✓ built + verified ${tag}. Re-run with --upload to publish.`); process.exit(0); }

// --- Publish (installers + manifests + blockmaps + checksums) -----------------------------------
// Create the release metadata FIRST, then upload each asset one at a time with `release upload
// --clobber`. gh's multi-asset upload on `release create` runs concurrently and intermittently 422s
// on large files ("ReleaseAsset.name already exists"); sequential per-asset uploads are reliable and
// idempotent, so a retry (with --force) safely re-uploads without duplicating. NOTE: --clobber is a
// `gh release upload` flag only — `gh release create` rejects it.
const assets = readdirSync(REL).filter((f) => /\.(dmg|zip|exe|AppImage|blockmap)$/.test(f) || /^latest.*\.yml$/.test(f) || f === "SHA256SUMS");
if (!assets.length) die("no assets to upload.");
const notes = `docs/release-notes/${tag}.md`;
const notesArg = existsSync(notes) ? `--notes-file "${notes}"` : `--generate-notes`;
try {
  run(`gh release create ${tag} --repo ${REPO} --title "Conduit ${tag}" ${notesArg} --latest`);
} catch (e) {
  if (!reuseRelease) throw e; // a fresh release must create cleanly; --force / --upload-only reuse an existing one
  console.log(`(release ${tag} already exists — reusing it to (re)upload assets)`);
}
// Upload each asset with retry; collect any that still fail so one bad asset can't abort the rest.
// A transient TLS/5xx blip retries; a persistent failure is reported and resumable via --upload-only.
const failed = [];
for (const f of assets) {
  try { runRetry(`gh release upload ${tag} "${join(REL, f)}" --repo ${REPO} --clobber`); }
  catch (e) { console.error(`  ✗ ${f}: ${String(e.message || e).split("\n")[0]}`); failed.push(f); }
}
if (failed.length) die(`${failed.length}/${assets.length} asset(s) still failing after retries: ${failed.join(", ")}.\n  Resume with:  node scripts/release.mjs --upload-only`);
console.log(`\n✓ published ${tag}: ${assets.length} assets (verified).`);
