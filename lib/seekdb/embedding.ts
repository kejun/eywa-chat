/**
 * SeekDB 嵌入函数注册
 * 
 * 使用阿里云百炼的 text-embedding-v4 模型
 */

import { registerEmbeddingFunction, type EmbeddingFunction } from "seekdb";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

class BailianEmbeddingFunction implements EmbeddingFunction {
  public readonly name = "default-embed";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = env.DASHSCOPE_API_KEY || "";
    this.baseUrl = env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    this.model = "text-embedding-v4";
  }

  static buildFromConfig(config: Record<string, unknown>): BailianEmbeddingFunction {
    const instance = new BailianEmbeddingFunction();
    if (config.model) {
      instance.model = String(config.model);
    }
    if (config.baseUrl) {
      instance.baseUrl = String(config.baseUrl);
    }
    return instance;
  }

  getConfig(): Record<string, unknown> {
    return {
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      // 返回零向量作为 fallback
      return texts.map(() => new Array(1536).fill(0));
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((item: any) => item.embedding);
    } catch (error) {
      logger.warn("embedding-generation-failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      // Fallback to zero vectors
      return texts.map(() => new Array(1536).fill(0));
    }
  }
}

// 自动注册默认嵌入函数
export function registerDefaultEmbedding(): void {
  try {
    registerEmbeddingFunction("default-embed", BailianEmbeddingFunction);
    logger.info("seekdb-embedding-function-registered", {
      model: "text-embedding-v4",
      provider: "aliyun-bailian",
    });
  } catch (error) {
    logger.warn("seekdb-embedding-registration-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

// 模块加载时自动注册
if (typeof globalThis !== "undefined") {
  registerDefaultEmbedding();
}
