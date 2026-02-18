import { ChatOpenAI } from "@langchain/openai";
import { env } from "@/lib/env";

type GlobalChatModelCache = typeof globalThis & {
  __chatModel?: ChatOpenAI;
};

export function getChatModel(): ChatOpenAI {
  const globalCache = globalThis as GlobalChatModelCache;

  if (!globalCache.__chatModel) {
    globalCache.__chatModel = new ChatOpenAI({
      model: env.DASHSCOPE_MODEL,
      apiKey: env.DASHSCOPE_API_KEY,
      temperature: 0.3,
      maxRetries: 2,
      timeout: 20_000,
      configuration: {
        baseURL: env.DASHSCOPE_BASE_URL,
      },
    });
  }

  return globalCache.__chatModel;
}
