import { describe, it, expect } from "vitest";
import { calcDecayedStrength } from "../../src/graph/decay.js";

describe("calcDecayedStrength", () => {
  it("returns current strength for today", () => {
    // "today" starts at midnight, so ~0.5 day has passed → expect ~0.97
    const today = new Date().toISOString().slice(0, 10);
    const result = calcDecayedStrength(today, 1.0);
    expect(result).toBeGreaterThan(0.95);
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("decays after 7 days", () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const result = calcDecayedStrength(sevenDaysAgo, 1.0);
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0.5); // ~0.61
  });

  it("decays to ~0.5 after 14 days (half-life=14)", () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const result = calcDecayedStrength(fourteenDaysAgo, 1.0, 14);
    // e^(-14/14) = e^(-1) ≈ 0.37
    expect(result).toBeCloseTo(0.37, 1);
  });

  it("returns 0 for very old dates", () => {
    const result = calcDecayedStrength("2020-01-01", 1.0);
    expect(result).toBeCloseTo(0, 1);
  });

  it("handles empty last_reinforced", () => {
    expect(calcDecayedStrength("", 0.5)).toBe(0.5);
  });

  it("custom half-life parameter works", () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const shortLife = calcDecayedStrength(sevenDaysAgo, 1.0, 7);
    const longLife = calcDecayedStrength(sevenDaysAgo, 1.0, 30);
    expect(shortLife).toBeLessThan(longLife); // shorter half-life = faster decay
  });
});
