import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import picomatch from "picomatch";
import { log } from "./logger.js";

export interface SverkloConfig {
  weights?: Array<{ glob: string; weight: number }>;
  ignore?: string[];
  search?: {
    defaultTokenBudget?: number;
    maxResults?: number;
    budgets?: Record<string, number>;
  };
  indexing?: { extensions?: Record<string, string> };
  embeddings?: {
    /** Embedding provider: 'onnx' (default) or 'ollama'. */
    provider?: 'onnx' | 'ollama';
    /** Model name — provider-specific. Default depends on provider. */
    model?: string;
    /** Vector dimensions. Auto-detected from provider if omitted. */
    dimensions?: number;
    ollama?: {
      /** Ollama API base URL. Default: 'http://localhost:11434' */
      baseUrl?: string;
      /** Ollama embedding model. Default: 'nomic-embed-text' */
      model?: string;
    };
    onnx?: {
      /** Path to a custom ONNX model file. */
      modelPath?: string;
    };
  };
}

const CONFIG_FILENAMES = [".sverklo.yaml", ".sverklo.yml"];

/**
 * Load a .sverklo.yaml / .sverklo.yml config from the project root.
 * Returns null if no config file exists or if parsing fails.
 * Never throws — logs a warning on bad input and returns null.
 */
export function loadSverkloConfig(rootPath: string): SverkloConfig | null {
  for (const name of CONFIG_FILENAMES) {
    const filePath = join(rootPath, name);
    if (!existsSync(filePath)) continue;

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(raw);

      if (parsed == null || typeof parsed !== "object") {
        log(`[config] ${name}: empty or non-object YAML, ignoring`);
        return null;
      }

      const config = parsed as SverkloConfig;

      // Validate and clamp weights
      if (config.weights && Array.isArray(config.weights)) {
        config.weights = config.weights.filter((entry) => {
          if (
            typeof entry !== "object" ||
            entry === null ||
            typeof entry.glob !== "string" ||
            typeof entry.weight !== "number"
          ) {
            log(
              `[config] ${name}: invalid weight entry ${JSON.stringify(entry)}, skipping`
            );
            return false;
          }
          if (!isFinite(entry.weight)) {
            log(
              `[config] ${name}: weight for "${entry.glob}" is not finite (${entry.weight}), skipping`
            );
            return false;
          }
          // Clamp to [0.0, 10.0]
          if (entry.weight < 0.0) {
            log(
              `[config] ${name}: weight for "${entry.glob}" clamped from ${entry.weight} to 0.0`
            );
            entry.weight = 0.0;
          } else if (entry.weight > 10.0) {
            log(
              `[config] ${name}: weight for "${entry.glob}" clamped from ${entry.weight} to 10.0`
            );
            entry.weight = 10.0;
          }
          return true;
        });
      }

      // Validate ignore is an array of strings
      if (config.ignore !== undefined) {
        if (!Array.isArray(config.ignore)) {
          log(`[config] ${name}: 'ignore' is not an array, discarding`);
          config.ignore = undefined;
        } else {
          config.ignore = config.ignore.filter((item) => {
            if (typeof item !== "string") {
              log(
                `[config] ${name}: non-string ignore entry ${JSON.stringify(item)}, skipping`
              );
              return false;
            }
            return true;
          });
        }
      }

      log(`[config] Loaded ${name}`);
      return config;
    } catch (err) {
      log(
        `[config] Failed to parse ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  return null;
}

/**
 * Get the weight multiplier for a file path from the config.
 * Paths should be relative to rootPath.
 * Returns 1.0 if no config or no matching glob.
 * Last matching glob wins.
 */
export function getWeight(
  config: SverkloConfig | null,
  relativePath: string
): number {
  if (!config?.weights || config.weights.length === 0) return 1.0;

  let weight = 1.0;

  for (const entry of config.weights) {
    if (picomatch.isMatch(relativePath, entry.glob)) {
      weight = entry.weight;
    }
  }

  return weight;
}
