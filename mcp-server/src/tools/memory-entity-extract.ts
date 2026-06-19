/**
 * memory_entity_extract tool — extract named entities from text.
 */
import { z } from "zod";
import { extractEntities, type ExtractedEntity, type EntityType } from "../ingest/entity-extractor.js";

export const memoryEntityExtractSchema = {
  name: "memory_entity_extract",
  description:
    "Extract named entities (technologies, people, concepts, projects, skills, companies) from text. " +
    "Returns structured entity list with types and confidence scores.",
  inputSchema: {
    text: z.string().describe("Text to extract entities from."),
    entity_types: z.array(
      z.enum(["technology", "concept", "person", "project", "skill", "company", "all"])
    ).default(["all"]).describe("Entity types to extract."),
    include_context: z.boolean().default(true).describe(
      "Include surrounding context snippet for each entity mention."
    ),
  },
};

export async function memoryEntityExtractHandler(args: {
  text: string;
  entity_types?: string[];
  include_context?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Resolve entity types: ["all"] or undefined → pass "all"; otherwise pass the array
  const entityTypes: "all" | EntityType[] = (!args.entity_types || args.entity_types.length === 0 || args.entity_types.includes("all"))
    ? "all"
    : args.entity_types as EntityType[];

  const entities = extractEntities(args.text, {
    entityTypes,
    includeContext: args.include_context,
    minConfidence: 0.35,
  });

  if (entities.length === 0) {
    return {
      content: [{ type: "text", text: "# Entity Extraction\n\nNo entities found in the provided text." }],
    };
  }

  const lines: string[] = [
    `# Entity Extraction`,
    "",
    `Found **${entities.length}** entities:`,
    "",
    "| Name | Type | Confidence | Mentions |",
    "|------|------|------------|----------|",
  ];

  for (const e of entities.slice(0, 30)) {
    lines.push(`| **${e.name}** | ${e.type} | ${e.confidence.toFixed(2)} | ${e.mentions.length} |`);
  }

  if (entities.length > 30) {
    lines.push(`| ... | ... | ... | ... |`);
    lines.push(`| *${entities.length - 30} more entities not shown* ||||`);
  }

  // Show context for top 5
  lines.push("", "## Top Entities (with context)", "");
  for (const e of entities.slice(0, 5)) {
    lines.push(`### ${e.name} (${e.type}, ${(e.confidence * 100).toFixed(0)}%)`);
    if (e.mentions.length > 0 && e.mentions[0].context) {
      lines.push(`> ${e.mentions[0].context}`);
    }
    lines.push("");
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
