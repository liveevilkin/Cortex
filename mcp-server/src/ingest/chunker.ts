/**
 * Markdown chunker — splits content by headings for embedding.
 * Strategies vary by file type (daily, decision, moc, knowledge).
 */
import { config } from "../config.js";
import { estimateTokens } from "../utils/token-counter.js";

export interface Chunk {
  chunk_index: number;
  chunk_text: string;
  heading_path: string;   // e.g., "## 做了什么 > ### 子任务"
  token_count: number;
}

/**
 * Chunk markdown content into sections suitable for embedding.
 */
export function chunkMarkdown(
  content: string,
  fileType: string,
  bodyStart: number = 0
): Chunk[] {
  // Extract body content (after frontmatter)
  const body = content.slice(bodyStart);

  const maxTokens = config.maxChunkTokens;
  const minTokens = config.minChunkTokens;
  const overlap = config.chunkOverlapTokens;

  // Split by ## headings
  const sections = splitByHeadings(body);

  const chunks: Chunk[] = [];
  let chunkIndex = 0;
  let carryover = "";

  for (const section of sections) {
    let sectionText = carryover ? carryover + "\n" + section.text : section.text;
    carryover = "";

    const tokens = estimateTokens(sectionText);

    if (tokens <= maxTokens) {
      // Section fits in one chunk
      if (tokens >= minTokens || chunks.length === 0) {
        chunks.push({
          chunk_index: chunkIndex++,
          chunk_text: sectionText.trim(),
          heading_path: section.headingPath,
          token_count: tokens,
        });
      }
    } else {
      // Section is too large — split at paragraph boundaries
      const subChunks = splitLargeSection(sectionText, section.headingPath, maxTokens, minTokens, overlap);
      for (const sc of subChunks) {
        chunks.push({ ...sc, chunk_index: chunkIndex++ });
      }
      // Carry over last few tokens for overlap with next section
      if (chunks.length > 0 && overlap > 0) {
        const lastChunk = chunks[chunks.length - 1];
        const words = lastChunk.chunk_text.split(/\s+/);
        const overlapWords = Math.min(overlap, words.length);
        carryover = words.slice(-overlapWords).join(" ");
      }
    }
  }

  // Special handling for very short files: keep as single chunk
  if (chunks.length === 0 && body.trim()) {
    chunks.push({
      chunk_index: 0,
      chunk_text: body.trim(),
      heading_path: "",
      token_count: estimateTokens(body),
    });
  }

  return chunks;
}

interface Section {
  text: string;
  headingPath: string;
  level: number;
  heading: string;
}

/**
 * Split markdown body by ## and ### heading markers.
 */
function splitByHeadings(body: string): Section[] {
  const sections: Section[] = [];
  const lines = body.split("\n");
  let currentText = "";
  let currentHeading = "";
  let currentPath = "";
  let currentLevel = 0;
  const headingStack: Array<{ heading: string; level: number }> = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      // Save current section
      if (currentText.trim() || currentHeading) {
        sections.push({
          text: currentText,
          headingPath: currentPath || currentHeading,
          level: currentLevel,
          heading: currentHeading,
        });
      }

      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();

      // Update heading stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ heading, level });

      // Build path
      currentPath = headingStack.map(h => h.heading).join(" > ");
      currentHeading = heading;
      currentLevel = level;
      currentText = line + "\n";
    } else {
      currentText += line + "\n";
    }
  }

  // Don't forget last section
  if (currentText.trim() || currentHeading) {
    sections.push({
      text: currentText,
      headingPath: currentPath || currentHeading,
      level: currentLevel,
      heading: currentHeading,
    });
  }

  // If there were no headings, the whole body is one section
  if (sections.length === 0 && body.trim()) {
    sections.push({
      text: body,
      headingPath: "",
      level: 0,
      heading: "",
    });
  }

  return sections;
}

/**
 * Split a section that's too large into smaller chunks at paragraph boundaries.
 */
function splitLargeSection(
  text: string,
  headingPath: string,
  maxTokens: number,
  minTokens: number,
  overlap: number
): Omit<Chunk, "chunk_index">[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Omit<Chunk, "chunk_index">[] = [];
  let current = "";
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > maxTokens && currentTokens >= minTokens) {
      // Flush current chunk
      chunks.push({
        chunk_text: current.trim(),
        heading_path: headingPath,
        token_count: currentTokens,
      });
      current = para;
      currentTokens = paraTokens;

      // Add overlap from previous chunk
      if (overlap > 0 && chunks.length > 0) {
        const prevWords = chunks[chunks.length - 1].chunk_text.split(/\s+/);
        const overlapWords = prevWords.slice(-overlap);
        current = overlapWords.join(" ") + "\n" + current;
        currentTokens = estimateTokens(current);
      }
    } else {
      current += (current ? "\n\n" : "") + para;
      currentTokens += paraTokens;
    }
  }

  if (current.trim()) {
    chunks.push({
      chunk_text: current.trim(),
      heading_path: headingPath,
      token_count: currentTokens,
    });
  }

  return chunks;
}
