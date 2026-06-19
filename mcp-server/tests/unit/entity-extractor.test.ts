import { describe, it, expect } from "vitest";
import { extractEntities } from "../../src/ingest/entity-extractor.js";

describe("extractEntities", () => {
  it("extracts dictionary-matched technologies", () => {
    const entities = extractEntities("Docker and PostgreSQL are used with FastAPI.");
    const names = entities.map(e => e.name);
    expect(names).toContain("Docker");
    expect(names).toContain("FastAPI");
    expect(names).toContain("PostgreSQL");
  });

  it("extracts Chinese company names", () => {
    const entities = extractEntities("开目公司是一家PLM软件公司，位于武汉。");
    const names = entities.map(e => e.name);
    expect(names).toContain("开目公司");
  });

  it("extracts skills", () => {
    const entities = extractEntities("需要掌握SQL和Docker技能。");
    const names = entities.map(e => e.name);
    expect(names).toContain("SQL");
    expect(names).toContain("Docker");
  });

  it("filters CJK stopwords", () => {
    const entities = extractEntities("我们可以使用这个方法来进行测试，这个方案很重要。");
    const names = entities.map(e => e.name);
    // "我们", "可以", "这个", "方法" should be filtered
    expect(names).not.toContain("我们");
    expect(names).not.toContain("可以");
  });

  it("handles empty input", () => {
    const entities = extractEntities("");
    expect(entities.length).toBe(0);
  });

  it("respects entityTypes filter", () => {
    const entities = extractEntities("Docker and SQL", {
      entityTypes: ["technology"],
      minConfidence: 0.5,
    });
    for (const e of entities) {
      expect(e.type).toBe("technology");
    }
  });

  it("respects minConfidence threshold", () => {
    const lenient = extractEntities("test text", { minConfidence: 0.1 });
    const strict = extractEntities("test text", { minConfidence: 0.99 });
    expect(lenient.length).toBeGreaterThanOrEqual(strict.length);
  });
});
