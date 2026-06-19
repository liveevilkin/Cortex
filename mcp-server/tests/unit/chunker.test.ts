import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../../src/ingest/chunker.js";

describe("chunkMarkdown", () => {
  it("chunks by headings", () => {
    const md = `## Section A

Content for section A.

## Section B

Content for section B.`;

    const chunks = chunkMarkdown(md, "daily", 0);
    expect(chunks.length).toBe(2);
    expect(chunks[0].chunk_text).toContain("Content for section A");
    expect(chunks[1].heading_path).toContain("Section B");
  });

  it("handles empty content", () => {
    const chunks = chunkMarkdown("", "daily", 0);
    expect(chunks.length).toBe(0);
  });

  it("handles no headings", () => {
    const chunks = chunkMarkdown("Just some text without headings.", "knowledge", 0);
    expect(chunks.length).toBe(1);
    expect(chunks[0].heading_path).toBe("");
  });

  it("preserves heading hierarchy", () => {
    const md = `## Parent

Parent content.

### Child

Child content.`;

    const chunks = chunkMarkdown(md, "daily", 0);
    expect(chunks.length).toBe(2);
    expect(chunks[1].heading_path).toBe("Parent > Child");
  });

  it("handles frontmatter offset", () => {
    const md = `---
title: Test
---
## Real Content
Body text here.`;

    const frontmatterLen = "---\ntitle: Test\n---\n".length;
    const chunks = chunkMarkdown(md, "daily", frontmatterLen);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunk_text).toContain("Body text here");
  });
});
