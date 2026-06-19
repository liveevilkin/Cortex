/**
 * Auto-loading module registry — scans tools/, resources/, prompts/ directories
 * and automatically discovers + registers modules without manual imports.
 *
 * Pattern inspired by alexanderop/mcp-server-starter-ts and ljagged/mcp-semantic-search.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..");

export interface ToolModule {
  name: string;
  schema: {
    name: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
  };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

export interface ResourceModule {
  register: (server: McpServer) => void;
}

/**
 * Auto-discover and register all tools from the tools/ directory.
 * Each .ts file should export { name } as a named export OR default export a ToolModule.
 */
export async function autoLoadTools(server: McpServer): Promise<number> {
  const toolsDir = join(SRC_DIR, "tools");
  if (!existsSync(toolsDir)) {
    logger.warn("Tools directory not found: " + toolsDir);
    return 0;
  }

  let count = 0;
  const files = readdirSync(toolsDir).filter(f => f.endsWith(".js") && f.startsWith("memory-"));

  for (const file of files) {
    try {
      const modulePath = join(toolsDir, file);
      const mod = await import(modulePath);

      // Look for the exported schema + handler pair
      // Convention: export const memoryXxxSchema + export async function memoryXxxHandler
      const toolName = file.replace(/^memory-/, "").replace(/\.js$/, "");
      const schemaName = `memory${toPascalCase(toolName)}Schema`;
      const handlerName = `memory${toPascalCase(toolName)}Handler`;

      const schema = mod[schemaName];
      const handler = mod[handlerName];

      if (!schema || !handler) {
        logger.warn(`Skipping ${file}: missing ${schemaName} or ${handlerName}`);
        continue;
      }

      server.tool(schema.name, schema.description, schema.inputSchema, handler);
      count++;
      logger.debug(`Auto-loaded tool: ${schema.name} (${file})`);
    } catch (err) {
      logger.warn(`Failed to load tool ${file}: ${err}`);
    }
  }

  logger.info(`Auto-loaded ${count} tools from ${toolsDir}`);
  return count;
}

/**
 * Auto-discover and register all resources from the resources/ directory.
 */
export async function autoLoadResources(server: McpServer): Promise<number> {
  const resourcesDir = join(SRC_DIR, "resources");
  if (!existsSync(resourcesDir)) return 0;

  let count = 0;
  const files = readdirSync(resourcesDir).filter(f => f.endsWith(".js") && !f.endsWith(".d.ts"));

  for (const file of files) {
    try {
      const mod = await import(join(resourcesDir, file));
      if (typeof mod.register === "function") {
        mod.register(server);
        count++;
        logger.debug(`Auto-loaded resource: ${file}`);
      }
    } catch (err) {
      logger.warn(`Failed to load resource ${file}: ${err}`);
    }
  }

  if (count > 0) logger.info(`Auto-loaded ${count} resources`);
  return count;
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}
