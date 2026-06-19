/**
 * Entity extraction — pattern-based + dictionary matching.
 * Extracts typed entities (technologies, concepts, people, companies, etc.)
 * from markdown text without requiring an ML model.
 *
 * Phase 2: Pattern + dictionary extraction.
 * Phase 3+: Optionally enhanced with NER model (Transformers.js).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// ── Types ──────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  mentions: Array<{ context: string; position: number }>;
  confidence: number;
  aliases: string[];
}

export type EntityType =
  | "technology"
  | "concept"
  | "person"
  | "project"
  | "skill"
  | "company"
  | "tool"
  | "process"
  | "domain"
  | "other";

export interface Dictionary {
  technologies: string[];
  concepts: string[];
  companies: string[];
  skills: string[];
  projects: string[];
  people: string[];
  roles: string[];
}

// ── Dictionary loading ────────────────────────────────

let dictionary: Dictionary | null = null;

export function loadDictionary(): Dictionary {
  if (dictionary) return dictionary;

  const paths = [
    join(config.dbDir, "..", "entity-dictionary.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "entity-dictionary.json"),
    join(process.cwd(), "entity-dictionary.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        dictionary = JSON.parse(readFileSync(p, "utf-8")) as Dictionary;
        logger.info(`Loaded entity dictionary from ${p}`);
        return dictionary!;
      } catch (err) {
        logger.warn(`Failed to parse dictionary ${p}: ${err}`);
      }
    }
  }

  // Fallback: empty dictionary
  logger.warn("No entity dictionary found, using empty dictionary");
  dictionary = { technologies: [], concepts: [], companies: [], skills: [], projects: [], people: [], roles: [] };
  return dictionary;
}

// ── Regex patterns ─────────────────────────────────────

const TECH_PATTERNS = [
  // CamelCase / PascalCase identifiers
  /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g,
  // ALLCAPS acronyms (3+ letters)
  /\b[A-Z]{3,}\b/g,
  // Versioned tech: "Name 2.0", "Name v3"
  /\b[A-Z][a-zA-Z]+\s+v?\d+\.\d+(?:\.\d+)?\b/g,
  // Slash-separated: "Node.js", "Transformers.js"
  /\b[A-Z][a-zA-Z]+\.js\b/g,
];

const CHINESE_PATTERNS = [
  // 2-8 CJK characters (potential entity names)
  /[一-鿿]{2,8}/g,
];

const CODE_PATTERNS = [
  // Inline code: `something`
  /`([^`]+)`/g,
  // Bold/italic markers (often used for key terms)
  /\*\*([^*]+)\*\*/g,
];

// ── Extraction ─────────────────────────────────────────

export interface ExtractOptions {
  /** Specific entity types to extract, or "all" */
  entityTypes?: EntityType[] | "all";
  /** Include surrounding context in mentions */
  includeContext?: boolean;
  /** Context window size (characters around match) */
  contextSize?: number;
  /** Minimum confidence to include */
  minConfidence?: number;
  /** Whether to scan inline code / bold markers */
  scanMarkers?: boolean;
}

/**
 * Extract entities from text.
 */
export function extractEntities(text: string, options: ExtractOptions = {}): ExtractedEntity[] {
  const dict = loadDictionary();
  const entityTypes = options.entityTypes || "all";
  const contextSize = options.contextSize || 30;
  const minConfidence = options.minConfidence || 0.4;
  const scanMarkers = options.scanMarkers !== false;

  const entities = new Map<string, ExtractedEntity>();

  // Helper: add or merge a mention
  function addMention(name: string, type: EntityType, confidence: number, position: number, context: string): void {
    // Skip if type is filtered out
    if (entityTypes !== "all" && !entityTypes.includes(type)) return;
    if (confidence < minConfidence) return;

    const key = `${name}::${type}`;
    const existing = entities.get(key);
    if (existing) {
      existing.mentions.push({ context, position });
      existing.confidence = Math.max(existing.confidence, confidence);
    } else {
      entities.set(key, {
        name,
        type,
        mentions: [{ context, position }],
        confidence,
        aliases: [],
      });
    }
  }

  function getContext(pos: number, length: number): string {
    const start = Math.max(0, pos - contextSize);
    const end = Math.min(text.length, pos + length + contextSize);
    return text.slice(start, end).replace(/\n/g, " ");
  }

  // ── Layer 1: Dictionary match (highest confidence) ──
  const dictMap: Array<{ type: EntityType; words: string[] }> = [
    { type: "technology", words: dict.technologies },
    { type: "concept", words: dict.concepts },
    { type: "company", words: dict.companies },
    { type: "skill", words: dict.skills },
    { type: "project", words: dict.projects },
    { type: "person", words: dict.people },
  ];

  for (const { type, words } of dictMap) {
    for (const word of words) {
      // Case-insensitive, word-boundary match
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped.replace(/ /g, "\\s+"), "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        addMention(word, type, 0.95, match.index, getContext(match.index, match[0].length));
      }
    }
  }

  // ── Layer 2: Regex patterns (medium confidence) ──
  const MAX_MENTIONS = 500;

  // Common Chinese stopwords — filter these from CJK entity extraction
  const CJK_STOPWORDS = new Set([
    "我们", "他们", "你们", "这个", "那个", "可以", "没有", "什么", "自己",
    "因为", "所以", "但是", "如果", "虽然", "而且", "然后", "之后", "之前",
    "一个", "一种", "一些", "所有", "每个", "任何", "其他", "这些", "那些",
    "不是", "不会", "不能", "可能", "应该", "需要", "已经", "还是", "或者",
    "时候", "问题", "方法", "方式", "情况", "过程", "结果", "方面", "部分",
    "目前", "现在", "以后", "以前", "以后", "这里", "那里", "关于", "对于",
    "使用", "进行", "通过", "根据", "按照", "经过", "利用", "采用",
    "不同", "主要", "基本", "重要", "相关", "具体", "一般", "一定",
    "用于", "作为", "称为", "包括", "具有", "存在", "表示", "说明",
    "上述", "如下", "以下", "以上", "其中", "其次", "首先", "最后",
    "之间", "之内", "之外", "之中", "之一", "二是", "三是",
  ]);

  for (const pattern of TECH_PATTERNS) {
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = pattern.exec(text)) !== null && count < 100) {
      const name = match[0];
      const alreadyKnown = [...entities.keys()].some(k => k.startsWith(`${name}::`));
      if (alreadyKnown) continue;
      addMention(name, "technology", 0.6, match.index, getContext(match.index, name.length));
      count++;
    }
  }

  // CJK extraction: only capture repeated terms (appear ≥2 times)
  // This prevents thousands of spurious 2-4 char matches
  const cjkCandidates = new Map<string, number>();
  for (const pattern of CHINESE_PATTERNS) {
    let match: RegExpExecArray | null;
    let cjkCount = 0;
    while ((match = pattern.exec(text)) !== null && cjkCount < 1000) {
      const name = match[0];
      cjkCandidates.set(name, (cjkCandidates.get(name) || 0) + 1);
      cjkCount++;
    }
  }
  // Only add CJK terms that appear 2+ times and aren't common stopwords
  for (const [name, freq] of cjkCandidates) {
    if (freq >= 2 && entities.size < MAX_MENTIONS && !CJK_STOPWORDS.has(name)) {
      const alreadyKnown = [...entities.keys()].some(k => k.startsWith(`${name}::`));
      if (!alreadyKnown) {
        // Find first occurrence for context
        const pos = text.indexOf(name);
        addMention(name, "concept", 0.45 + Math.min(0.1, freq * 0.02), pos, getContext(Math.max(0, pos), name.length));
      }
    }
  }

  // ── Layer 3: Inline code / bold markers ──
  if (scanMarkers) {
    for (const pattern of CODE_PATTERNS) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        if (name.length < 2 || name.length > 40) continue;
        const alreadyKnown = [...entities.keys()].some(k => k.startsWith(`${name}::`));
        if (alreadyKnown) continue;
        // Inline code = likely a technology/tool name
        if (pattern.source.startsWith("`")) {
          addMention(name, "technology", 0.55, match.index, getContext(match.index, match[0].length));
        }
      }
    }
  }

  // ── Merge duplicate names across types ──
  const merged = new Map<string, ExtractedEntity>();
  for (const [, entity] of entities) {
    const existing = merged.get(entity.name);
    if (existing) {
      existing.mentions.push(...entity.mentions);
      existing.confidence = Math.max(existing.confidence, entity.confidence);
      if (!existing.aliases.includes(entity.type)) {
        existing.aliases.push(entity.type);
      }
    } else {
      merged.set(entity.name, { ...entity });
    }
  }

  // Sort by confidence descending
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract entities from frontmatter tags and wikilinks.
 */
export function extractEntitiesFromFrontmatter(
  tags: string[],
  links: string[],
  title: string
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  // Tags become concept entities
  for (const tag of tags) {
    if (tag && tag.length > 1 && tag !== "daily-memory") {
      entities.push({
        name: tag,
        type: "concept",
        mentions: [],
        confidence: 0.9,
        aliases: [],
      });
    }
  }

  // Wikilink targets become entities
  for (const link of links) {
    const clean = link.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].trim();
    if (clean && !clean.match(/^\d{4}-\d{2}-\d{2}/)) {
      // Determine type from path
      let type: EntityType = "concept";
      if (clean.includes("decisions/")) type = "concept";
      else if (clean.includes("daily/")) type = "domain";
      else if (clean.includes("moc/")) type = "domain";
      else if (clean.includes("学习计划/")) type = "domain";

      entities.push({
        name: clean.split("/").pop() || clean,
        type,
        mentions: [],
        confidence: 0.7,
        aliases: [clean],
      });
    }
  }

  return entities;
}
