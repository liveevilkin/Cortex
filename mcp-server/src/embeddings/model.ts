/**
 * Embedding model management — lazy-load Transformers.js pipeline.
 * In Phase 1, embeddings may be unavailable due to native dependency issues (sharp).
 * The system gracefully degrades to keyword-only search when embeddings are not available.
 */
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

type PipelineType = (texts: string | string[], options?: Record<string, unknown>) => Promise<unknown>;

let pipeline: PipelineType | null = null;
let modelLoaded = false;
let modelLoadFailed = false;
let loadingPromise: Promise<void> | null = null;
let loadErrorMsg = "";
let detectedDimensions = config.embeddingDimensions;

/**
 * Returns true if the embedding model is available for use.
 */
export function isEmbeddingsAvailable(): boolean {
  return modelLoaded && !modelLoadFailed;
}

/**
 * Get the detected embedding dimension (auto-detected from first successful embedding).
 */
export function getDetectedDimensions(): number {
  return detectedDimensions;
}

/**
 * Returns the reason embeddings are unavailable, or empty string if available.
 */
export function getEmbeddingError(): string {
  return loadErrorMsg;
}

export async function ensureModelLoaded(): Promise<void> {
  if (modelLoaded) return;
  if (modelLoadFailed) return; // Don't retry — already failed
  if (loadingPromise) {
    await loadingPromise;
    return;
  }

  loadingPromise = loadModel();
  await loadingPromise;
  loadingPromise = null;
}

async function loadModel(): Promise<void> {
  logger.info(`Loading embedding model: ${config.embeddingModel}...`);
  const startTime = Date.now();

  try {
    // Try @huggingface/transformers v3 first (ONNX backend, no sharp needed)
    let transformersPipeline: (task: string, model?: string, options?: Record<string, unknown>) => Promise<unknown>;
    try {
      const m = await import("@huggingface/transformers");
      // Configure mirror for China (hf-mirror.com is a community-maintained HF mirror)
      if (!m.env.remoteHost.includes("mirror")) {
        m.env.remoteHost = "https://hf-mirror.com";
        logger.info(`Using HF mirror: ${m.env.remoteHost}`);
      }
      transformersPipeline = m.pipeline as typeof transformersPipeline;
    } catch {
      // Fallback to @xenova/transformers v2 (requires sharp)
      const m = await import("@xenova/transformers");
      transformersPipeline = m.pipeline as typeof transformersPipeline;
    }

    const rawPipeline = await transformersPipeline(
      "feature-extraction",
      config.embeddingModel,
      { quantized: true }
    );
    pipeline = rawPipeline as PipelineType;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`Embedding model loaded in ${elapsed}s`);
    modelLoaded = true;
  } catch (err) {
    loadErrorMsg = err instanceof Error ? err.message : String(err);
    modelLoadFailed = true;
    loadingPromise = null;

    // Extract the key issue for a clear warning
    if (loadErrorMsg.includes("sharp")) {
      logger.warn(
        `Embedding model unavailable: sharp native module missing (network/compile issue). ` +
        `Keyword search will be used instead. To enable semantic search, fix sharp installation: ` +
        `https://sharp.pixelplumbing.com/install`
      );
    } else {
      logger.warn(
        `Embedding model unavailable: ${loadErrorMsg}. Falling back to keyword-only search.`
      );
    }
  }
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  await ensureModelLoaded();

  if (!pipeline || modelLoadFailed) {
    // Return zero vectors with auto-detected dimension
    return texts.map(() => new Float32Array(detectedDimensions));
  }

  if (texts.length === 0) return [];

  const results: Float32Array[] = [];

  // Process in small batches with per-item pooling.
  // HF v3 doesn't apply pooling per-item for array input, so we call one-at-a-time
  // but use micro-batches (8) for throughput while keeping dimension consistency.
  const MICRO_BATCH = 8;
  for (let i = 0; i < texts.length; i += MICRO_BATCH) {
    const micro = texts.slice(i, i + MICRO_BATCH);
    const promises = micro.map(async (text) => {
      try {
        const output = await pipeline!(text, { pooling: "mean", normalize: true });
        return new Float32Array((output as { data: Float32Array }).data);
      } catch (err) {
        logger.error(`Embedding failed: ${(text || "").slice(0, 50)}... — ${err}`);
        return new Float32Array(detectedDimensions);
      }
    });
    const batchResults = await Promise.all(promises);
    for (const vec of batchResults) {
      if (detectedDimensions === config.embeddingDimensions && vec.length !== config.embeddingDimensions) {
        detectedDimensions = vec.length;
        logger.info(`Auto-detected embedding dimension: ${detectedDimensions}`);
      }
      results.push(vec);
    }
  }

  return results;
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const results = await embedTexts([text]);
  return results[0] || new Float32Array(detectedDimensions);
}

export function isModelLoaded(): boolean {
  return modelLoaded;
}

export function getModelInfo(): { name: string; loaded: boolean; dimensions: number; error: string } {
  return {
    name: config.embeddingModel,
    loaded: modelLoaded,
    dimensions: detectedDimensions,
    error: modelLoadFailed ? loadErrorMsg : "",
  };
}

export function unloadModel(): void {
  pipeline = null;
  modelLoaded = false;
  modelLoadFailed = false;
  loadErrorMsg = "";
  logger.info("Embedding model unloaded");
}
