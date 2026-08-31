// Semver-ish version comparison for the update checker. Kept pure + tiny so it's unit-testable and
// has no Electron/network dependency. Handles a leading "v" and numeric dotted parts; pre-release
// suffixes are ignored (we only ship X.Y.Z tags).

/** "v0.2.10" → [0, 2, 10]. Non-numeric parts are dropped. */
export function parseVersion(v: string): number[] {
  return String(v)
    .trim()
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));
}

/** True when `latest` is a strictly higher version than `current` (component-wise, numeric). */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
