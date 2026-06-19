import { describe, it, expect } from "vitest";
import { parseWikilinks, resolveWikilinkPath, buildPathSet } from "../../src/ingest/wikilink-parser.js";

describe("parseWikilinks", () => {
  it("parses simple wikilinks", () => {
    const links = parseWikilinks("See [[daily/2026-06-19]] for details.");
    expect(links.length).toBe(1);
    expect(links[0].targetPath).toBe("daily/2026-06-19");
    expect(links[0].displayText).toBe("daily/2026-06-19");
  });

  it("parses aliased wikilinks", () => {
    const links = parseWikilinks("See [[daily/2026-06-19|yesterday]] for details.");
    expect(links.length).toBe(1);
    expect(links[0].targetPath).toBe("daily/2026-06-19");
    expect(links[0].displayText).toBe("yesterday");
  });

  it("parses heading anchors", () => {
    const links = parseWikilinks("See [[note#section]] for details.");
    expect(links.length).toBe(1);
    expect(links[0].targetPath).toBe("note");
    expect(links[0].sectionAnchor).toBe("section");
  });

  it("handles no wikilinks", () => {
    const links = parseWikilinks("Just plain text.");
    expect(links.length).toBe(0);
  });

  it("parses multiple wikilinks", () => {
    const links = parseWikilinks("[[A]] and [[B]] and [[C]]");
    expect(links.length).toBe(3);
  });
});

describe("resolveWikilinkPath", () => {
  const paths = new Set([
    "daily/2026-06-19.md",
    "decisions/architecture.md",
    "学习计划/Docker学习路线.md",
  ]);

  it("resolves exact match", () => {
    expect(resolveWikilinkPath("daily/2026-06-19", paths)).toBe("daily/2026-06-19.md");
  });

  it("resolves with .md already present", () => {
    expect(resolveWikilinkPath("daily/2026-06-19.md", paths)).toBe("daily/2026-06-19.md");
  });

  it("returns null for unknown", () => {
    expect(resolveWikilinkPath("nonexistent/file", paths)).toBeNull();
  });
});
