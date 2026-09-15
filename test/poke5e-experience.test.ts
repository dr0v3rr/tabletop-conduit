import { describe, it, expect } from "vitest";
import { expNeededAtLevel, expUntilLevelUp, expProgress, formatExp, MAX_LEVEL, EXP_PER_LEVEL } from "../src/poke5e/experience";

describe("poke5e experience", () => {
  it("uses poke5e's cumulative thresholds", () => {
    expect(MAX_LEVEL).toBe(20);
    expect(expNeededAtLevel(1)).toBe(0);
    expect(expNeededAtLevel(2)).toBe(200);
    expect(expNeededAtLevel(6)).toBe(12000);
    expect(expNeededAtLevel(20)).toBe(450000);
    expect(EXP_PER_LEVEL).toHaveLength(20);
  });

  it("computes EXP until the next level (0 at max)", () => {
    expect(expUntilLevelUp(0, 1)).toBe(200);       // L1 → 200 for L2
    expect(expUntilLevelUp(12340, 6)).toBe(20000 - 12340); // L6 → L7 needs 20000
    expect(expUntilLevelUp(20000, 6)).toBe(0);     // already at/over next threshold
    expect(expUntilLevelUp(999999, 20)).toBe(0);   // max level
  });

  it("reports progress and readiness within the current band", () => {
    // L6 band is 12000..20000 (size 8000); 16000 EXP is halfway
    const p = expProgress(16000, 6);
    expect(p.curBase).toBe(12000);
    expect(p.nextAt).toBe(20000);
    expect(p.pct).toBeCloseTo(0.5, 5);
    expect(p.readyToLevel).toBe(false);
    // enough EXP for the next level → ready
    expect(expProgress(20000, 6).readyToLevel).toBe(true);
    // max level → full bar, never "ready"
    const max = expProgress(999999, 20);
    expect(max.pct).toBe(1);
    expect(max.readyToLevel).toBe(false);
  });

  it("formats EXP with thousands separators", () => {
    expect(formatExp(12340)).toBe("12,340");
    expect(formatExp(0)).toBe("0");
  });
});
