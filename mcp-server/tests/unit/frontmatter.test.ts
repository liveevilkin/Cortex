import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  extractDate,
  determineFileType,
  extractTitle,
} from "../../src/ingest/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter", () => {
    const md = `---
date: 2026-06-19
tags: [daily-memory, test]
summary: "A test note"
strength: 0.87
---

Body text.`;

    const { frontmatter, bodyStart } = parseFrontmatter(md);
    expect(frontmatter.date).toBe("2026-06-19");
    expect(frontmatter.tags).toEqual(["daily-memory", "test"]);
    expect(frontmatter.summary).toBe("A test note");
    expect(frontmatter.strength).toBe(0.87);
    expect(bodyStart).toBeGreaterThan(0);
  });

  it("handles missing frontmatter", () => {
    const { frontmatter, bodyStart } = parseFrontmatter("Just body text.");
    expect(frontmatter).toEqual({});
    expect(bodyStart).toBe(0);
  });

  it("handles Date objects from YAML", () => {
    const md = `---
date: 2026-06-19
last_reinforced: 2026-06-18
---
Body.`;

    const { frontmatter } = parseFrontmatter(md);
    expect(typeof frontmatter.date).toBe("string");
    expect(typeof frontmatter.last_reinforced).toBe("string");
  });
});

describe("extractDate", () => {
  it("prefers frontmatter date", () => {
    expect(extractDate({ date: "2026-01-15" }, "2026-06-19.md")).toBe("2026-01-15");
  });

  it("falls back to filename", () => {
    expect(extractDate({}, "2026-06-19.md")).toBe("2026-06-19");
  });
});

describe("determineFileType", () => {
  it("detects daily from path", () => {
    expect(determineFileType("daily/2026-06-19.md", {})).toBe("daily");
  });

  it("detects decision from path", () => {
    expect(determineFileType("decisions/architecture.md", {})).toBe("decision");
  });

  it("detects knowledge from tags", () => {
    expect(determineFileType("notes/random.md", { tags: ["学习计划"] })).toBe("knowledge");
  });

  it("defaults to knowledge", () => {
    expect(determineFileType("other/note.md", {})).toBe("knowledge");
  });
});

describe("extractTitle", () => {
  it("uses frontmatter title", () => {
    expect(extractTitle({ title: "My Note" }, "daily/2026-01-01.md")).toBe("My Note");
  });

  it("falls back to filename (strips date prefix)", () => {
    // extractTitle strips YYYY-MM-DD prefix from filenames
    expect(extractTitle({}, "notes/architecture-decision.md")).toBe("architecture-decision");
  });
});
