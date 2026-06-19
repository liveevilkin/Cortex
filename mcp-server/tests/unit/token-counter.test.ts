import { describe, it, expect } from "vitest";
import { estimateTokens, truncateToTokens, checkTokenBudget } from "../../src/utils/token-counter.js";

describe("estimateTokens", () => {
  it("counts English text", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 3
  });

  it("counts Chinese text", () => {
    expect(estimateTokens("你好世界")).toBe(1); // 4 chars / 4 = 1
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("handles emoji", () => {
    expect(estimateTokens("🧠📊")).toBe(1); // 2 emoji (1 char each) / 4 = 1
  });
});

describe("truncateToTokens", () => {
  it("doesn't truncate short text", () => {
    expect(truncateToTokens("hello", 10)).toBe("hello");
  });

  it("truncates with ellipsis", () => {
    const result = truncateToTokens("a".repeat(200), 10);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("checkTokenBudget", () => {
  it("passes under budget", () => {
    expect(checkTokenBudget("hi", 100).ok).toBe(true);
  });

  it("fails over budget", () => {
    expect(checkTokenBudget("x".repeat(500), 10).ok).toBe(false);
  });
});
