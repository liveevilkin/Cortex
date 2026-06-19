/**
 * High-level embedding operations.
 * Re-exports from model.ts with convenience wrappers.
 */
export {
  ensureModelLoaded,
  embedTexts,
  embedQuery,
  isModelLoaded,
  getModelInfo,
  unloadModel,
} from "./model.js";
