// electron-builder afterSign hook (macOS): sign the app with a stable code-signing identity.
//
// Why: an ad-hoc signature identifies the app only by its code hash, which changes with every build.
// macOS Keychain grants the key that encrypts the saved D&D Beyond / Roll20 login cookies per app
// identity, so every new ad-hoc build looked like a different app and lost access — logging you out
// after each update. Signed with one stable identity, the app stays the same app across builds.
//
// electron-builder only picks Apple-issued identities itself, so this hook re-signs the packed .app
// with `codesign` before the DMG / zip are made (fuses are flipped earlier, in afterPack).
//
// The identity is local configuration, never committed: set CONDUIT_SIGN_IDENTITY in the environment
// or in a git-ignored `.env.signing` file at the project root (`CONDUIT_SIGN_IDENTITY=<keychain name>`).
//   CONDUIT_REQUIRE_SIGNING=1  fail the build if it can't be signed (release builds) instead of keeping
//                              the ad-hoc signature (dev builds on machines without the identity)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function signingIdentity() {
  if (process.env.CONDUIT_SIGN_IDENTITY) return process.env.CONDUIT_SIGN_IDENTITY;
  const file = join(process.cwd(), ".env.signing");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*CONDUIT_SIGN_IDENTITY\s*=/.test(l));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const identity = signingIdentity();
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    if (!identity) throw new Error("no signing identity configured (CONDUIT_SIGN_IDENTITY / .env.signing)");
    execFileSync("codesign", ["--force", "--deep", "--timestamp=none", "--sign", identity, app], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
    console.log(`[aftersign-mac] signed ${app}`);
  } catch (err) {
    if (process.env.CONDUIT_REQUIRE_SIGNING) throw new Error(`[aftersign-mac] couldn't sign the macOS app: ${err.message}`);
    console.warn(`[aftersign-mac] not signed (${err.message}) — keeping the ad-hoc signature; logins won't survive updates`);
  }
}
