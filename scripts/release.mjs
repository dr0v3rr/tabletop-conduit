// Strict, fail-closed release pipeline. Any failing step aborts before anything is published, so a
// release can never ship artifacts that don't match their update manifests / checksums.
//
//   node scripts/release.mjs            # build → checksum → VERIFY  (no upload; safe dry run)
//   node scripts/release.mjs --upload   # the above, then create the GitHub release (verify must pass)
//   flags: --allow-dirty (skip the clean-tree guard), --force (overwrite an existing release)

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

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
console.log(`Releasing Conduit ${tag}`);

// --- Guards -------------------------------------------------------------------------------------
if (!has("--allow-dirty")) {
  const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
  if (dirty) die("working tree is not clean — commit first (or pass --allow-dirty).");
}
if (has("--upload") && !has("--force")) {
  try { execSync(`gh release view ${tag} --repo ${REPO}`, { stdio: "ignore" }); die(`release ${tag} already exists (use --force to overwrite).`); }
  catch (e) { if (String(e.message || "").includes("already exists")) throw e; /* not found = good */ }
}

// --- Build (fresh; one consistent source state) -------------------------------------------------
rmSync(REL, { recursive: true, force: true }); // no stale artifacts from a previous version can leak in
run("npm run shell:build");
run("npx electron-builder --mac --publish never");            // macOS arm64 dmg + zip
run("npx electron-builder --win --x64 --publish never");      // Windows x64 nsis + portable
run("npx electron-builder --linux --x64 --arm64 --publish never"); // Linux x64 + arm64 AppImage (one pass → one consistent latest-linux.yml)

// --- Checksums generated from the actual built files (never hand-maintained) --------------------
const installers = readdirSync(REL).filter((f) => /\.(dmg|zip|exe|AppImage)$/.test(f)).sort();
if (!installers.length) die("no installers were produced.");
const sums = installers.map((f) => `${createHash("sha256").update(readFileSync(join(REL, f))).digest("hex")}  ${f}`).join("\n") + "\n";
writeFileSync(join(REL, "SHA256SUMS"), sums);
console.log(`\nSHA256SUMS written for ${installers.length} artifacts.`);

// --- Integrity gate: re-hash everything vs the manifests/checksums. Aborts on any mismatch. -----
run("node scripts/verify-release.mjs");

if (!has("--upload")) { console.log(`\n✓ built + verified ${tag}. Re-run with --upload to publish.`); process.exit(0); }

// --- Publish the exact verified set (installers + manifests + blockmaps + checksums) ------------
const assets = readdirSync(REL).filter((f) => /\.(dmg|zip|exe|AppImage|blockmap)$/.test(f) || /^latest.*\.yml$/.test(f) || f === "SHA256SUMS");
const notes = `docs/release-notes/${tag}.md`;
const notesArg = existsSync(notes) ? `--notes-file "${notes}"` : `--generate-notes`;
const quoted = assets.map((f) => `"${join(REL, f)}"`).join(" ");
run(`gh release create ${tag} --repo ${REPO} --title "Conduit ${tag}" ${notesArg} --latest ${has("--force") ? "--clobber " : ""}${quoted}`);
console.log(`\n✓ published ${tag}: ${assets.length} assets (verified).`);
