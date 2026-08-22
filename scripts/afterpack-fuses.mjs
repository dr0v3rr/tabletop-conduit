// electron-builder afterPack hook: flip Electron Fuses on the packaged binary to shrink the
// post-compromise attack surface. Closes the "relaunch me as a plain Node process" pivots
// (RunAsNode / --inspect / NODE_OPTIONS), pins the app to load only from its asar, and turns on
// at-rest cookie encryption. Requires the dev dependency: npm i -D @electron/fuses
import { FuseVersion, FuseV1Options, flipFuses } from "@electron/fuses";
import { join } from "node:path";
import { existsSync } from "node:fs";

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const product = packager.appInfo.productFilename;

  // Path to the actual Electron executable produced for this platform. On Linux the binary is named
  // after `executableName` (which sanitises the product name — no spaces), not the product name, so
  // resolve it explicitly and fall back to the product name only if that isn't present.
  let target;
  if (electronPlatformName === "darwin") {
    target = join(appOutDir, `${product}.app`);
  } else if (electronPlatformName === "win32") {
    target = join(appOutDir, `${product}.exe`);
  } else {
    const exeName = packager.executableName || packager.platformSpecificBuildOptions?.executableName || product;
    target = join(appOutDir, exeName);
    if (!existsSync(target)) target = join(appOutDir, product); // last-resort fallback
  }

  await flipFuses(target, {
    version: FuseVersion.V1,
    // Kill the Node-relaunch escape hatches an attacker uses to turn renderer RCE into code exec.
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    // Harden data-at-rest and code-load integrity.
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // macOS: flipping fuses invalidates the ad-hoc signature electron-builder applies, so re-seal it.
    resetAdHocDarwinSignature: electronPlatformName === "darwin",
  });

  console.log(`[afterpack-fuses] fuses flipped on ${target}`);
}
