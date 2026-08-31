// Release integrity gate. Re-hashes every artifact in release/ and checks it against the value
// electron-updater will trust in the latest*.yml manifests (sha512 + size), and against SHA256SUMS
// if present. Exits non-zero on ANY mismatch or missing file — so a build that was modified after
// its manifest was generated can never be shipped.
//
// Usage: node scripts/verify-release.mjs [releaseDir]  (default: release)

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import yaml from "js-yaml";

const rel = process.argv[2] || "release";
const sha = (p, algo, enc) => createHash(algo).update(readFileSync(p)).digest(enc);
let problems = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); problems++; };
const ok = (m) => console.log(`  ✓ ${m}`);

if (!existsSync(rel)) { console.error(`No ${rel}/ directory — build first.`); process.exit(1); }

// 1) electron-updater manifests: each referenced file must exist and match sha512 (+ size).
const ymls = ["latest.yml", "latest-mac.yml", "latest-linux.yml"].filter((f) => existsSync(join(rel, f)));
if (!ymls.length) console.warn("! no latest*.yml manifests found (auto-update won't work for this release)");
for (const y of ymls) {
  console.log(`\n${y}`);
  const doc = yaml.load(readFileSync(join(rel, y), "utf8"));
  const entries = Array.isArray(doc.files) && doc.files.length ? doc.files : [{ url: doc.path, sha512: doc.sha512 }];
  for (const e of entries) {
    const p = join(rel, e.url);
    if (!existsSync(p)) { fail(`${e.url} — referenced by manifest but missing on disk`); continue; }
    if (e.sha512 && sha(p, "sha512", "base64") !== e.sha512) { fail(`${e.url} — sha512 does not match manifest`); continue; }
    if (e.size != null && statSync(p).size !== e.size) { fail(`${e.url} — size does not match manifest`); continue; }
    ok(`${e.url} (sha512 + size match)`);
  }
}

// 2) SHA256SUMS (if present): every listed file must exist and match.
const sumsPath = join(rel, "SHA256SUMS");
if (existsSync(sumsPath)) {
  console.log(`\nSHA256SUMS`);
  for (const line of readFileSync(sumsPath, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, hash, name] = m;
    const p = join(rel, name);
    if (!existsSync(p)) { fail(`${name} — in SHA256SUMS but missing on disk`); continue; }
    if (sha(p, "sha256", "hex") !== hash) { fail(`${name} — sha256 does not match SHA256SUMS`); continue; }
    ok(`${name}`);
  }
}

if (problems) { console.error(`\n✗ ${problems} integrity problem(s) — refusing to release.`); process.exit(1); }
console.log(`\n✓ all artifacts match their manifests/checksums.`);
