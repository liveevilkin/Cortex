/**
 * memory_graph_query tool — query the knowledge graph.
 */
import { z } from "zod";
import { queryGraph, getTopEntities } from "../graph/knowledge-graph.js";

export const memoryGraphQuerySchema = {
  name: "memory_graph_query",
  description:
    "Query the memory knowledge graph: find entities, their relationships, connected memory notes, " +
    "and traverse the graph by relation type. Use this to explore how concepts are connected.",
  inputSchema: {
    entity_name: z.string().describe("Entity name to look up (partial match supported)."),
    relation_type: z.enum([
      "relates_to", "contradicts", "supersedes", "depends_on",
      "mentions", "part_of", "co_occurs_with", "all"
    ]).default("all").describe("Filter by relationship type."),
    traverse_depth: z.number().default(1).describe("How many hops to traverse (1-3)."),
    min_edge_weight: z.number().default(0.1).describe("Minimum edge weight (0.0-1.0)."),
    limit: z.number().default(20).describe("Maximum relationships to return."),
  },
};

export async function memoryGraphQueryHandler(args: {
  entity_name: string;
  relation_type?: string;
  traverse_depth?: number;
  min_edge_weight?: number;
  limit?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = queryGraph(
    args.entity_name,
    args.relation_type || "all",
    args.traverse_depth || 1,
    args.min_edge_weight || 0.1,
    args.limit || 20
  );

  if (!result) {
    return {
      content: [{
        type: "text",
        text: `# Knowledge Graph Query: "${args.entity_name}"\n\n` +
          `No entity found matching "${args.entity_name}". ` +
          `Try running \`memory_ingest\` first to index your vault content.`,
      }],
    };
  }

  const { entity, relationships, connectedMemories, graphStats } = result;

  const lines: string[] = [
    `# Knowledge Graph: "${entity.name}"`,
    "",
    `- **Type**: ${entity.type}`,
    `- **Strength**: ${entity.strength.toFixed(2)}`,
    `- **Occurrences**: ${entity.occurrence_count}`,
    `- **First seen**: ${entity.first_seen_date}`,
    `- **Last seen**: ${entity.last_seen_date}`,
    `- **Sources**: ${entity.source_vault_paths || "(none)"}`,
    "",
    `## Relationships (${relationships.length})`,
    "",
  ];

  if (relationships.length > 0) {
    for (const r of relationships) {
      const isSource = r.source_entity_id === entity.id;
      const otherName = isSource ? r.target_name : r.source_name;
      const direction = isSource ? "→" : "←";
      lines.push(
        `- ${direction} **${otherName}** _(${r.relation_type})_ — weight: ${r.weight.toFixed(2)}, co-activations: ${r.co_activation_count}`
      );
    }
  } else {
    lines.push("*No relationships found yet. Index more vault files to build the graph.*");
  }

  lines.push(
    "",
    `## Connected Memories (${connectedMemories.length})`,
    ""
  );

  if (connectedMemories.length > 0) {
    for (const m of connectedMemories) {
      lines.push(`- \`${m.vault_path}\` (${m.file_type}): ${m.title}`);
    }
  } else {
    lines.push("*No memory nodes directly linked.*");
  }

  lines.push(
    "",
    "## Graph Stats",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total entities | ${graphStats.totalEntities} |`,
    `| Total relationships | ${graphStats.totalRelationships} |`,
    `| Total memory nodes | ${graphStats.totalMemoryNodes} |`,
  );

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
