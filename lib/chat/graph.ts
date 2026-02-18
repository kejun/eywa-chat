import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { extractMemoryCandidates } from "@/lib/chat/memory-extractor";
import { getChatModel } from "@/lib/chat/model";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { ChatStateAnnotation, type ChatGraphInput, type ChatState } from "@/lib/chat/state";
import { memoryRepository } from "@/lib/memory";
import { logger } from "@/lib/logger";

function isLowSignalMessage(message: string): boolean {
  const normalized = message.trim();
  return /^(嗯|好的|收到|ok|okay|谢谢|thx|thanks)[!！。. ]*$/.test(normalized);
}

function readMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item) {
          const textValue = item.text;
          return typeof textValue === "string" ? textValue : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

const classifyIntentNode = async (state: ChatState) => {
  return {
    shouldRetrieve: !isLowSignalMessage(state.userMessage),
  };
};

const retrieveMemoriesNode = async (state: ChatState) => {
  if (!state.shouldRetrieve) {
    return {
      retrievedMemories: [],
    };
  }

  try {
    const retrievedMemories = await memoryRepository.retrieveMemories({
      tenantId: state.tenantId,
      userId: state.userId,
      threadId: state.threadId,
      queryText: state.userMessage,
      nResults: 8,
    });
    return { retrievedMemories };
  } catch (error) {
    logger.warn("chat-retrieve-memories-failed", {
      traceId: state.traceId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      retrievedMemories: [],
    };
  }
};

const generateResponseNode = async (state: ChatState) => {
  const model = getChatModel();
  const systemPrompt = buildSystemPrompt(state.retrievedMemories);

  try {
    const responseMessage = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(state.userMessage),
    ]);

    return {
      response:
        readMessageContent(responseMessage.content) ||
        "我已经收到你的消息，但暂时无法生成完整回复。",
    };
  } catch (error) {
    logger.error("chat-generate-response-failed", {
      traceId: state.traceId,
      reason: error instanceof Error ? error.message : String(error),
    });

    return {
      response:
        "当前模型服务暂时不可用。我已记录你的请求，请稍后重试，或告诉我你希望我先执行的下一步。",
    };
  }
};

const extractMemoryCandidatesNode = async (state: ChatState) => {
  const memoryWriteCandidates = extractMemoryCandidates({
    tenantId: state.tenantId,
    userId: state.userId,
    threadId: state.threadId,
    userMessage: state.userMessage,
    traceId: state.traceId,
  });

  return {
    memoryWriteCandidates,
  };
};

const persistMemoriesNode = async (state: ChatState) => {
  if (state.memoryWriteCandidates.length === 0) {
    return {
      persistedCount: 0,
    };
  }

  try {
    const upserted = await memoryRepository.upsertMemories(state.memoryWriteCandidates);
    return {
      persistedCount: upserted.length,
    };
  } catch (error) {
    logger.warn("chat-persist-memories-failed", {
      traceId: state.traceId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      persistedCount: 0,
    };
  }
};

const compiledChatGraph = new StateGraph(ChatStateAnnotation)
  .addNode("classifyIntent", classifyIntentNode)
  .addNode("retrieveMemories", retrieveMemoriesNode)
  .addNode("generateResponse", generateResponseNode)
  .addNode("extractMemoryCandidates", extractMemoryCandidatesNode)
  .addNode("persistMemories", persistMemoriesNode)
  .addEdge(START, "classifyIntent")
  .addEdge("classifyIntent", "retrieveMemories")
  .addEdge("retrieveMemories", "generateResponse")
  .addEdge("generateResponse", "extractMemoryCandidates")
  .addEdge("extractMemoryCandidates", "persistMemories")
  .addEdge("persistMemories", END)
  .compile();

export async function runChatGraph(input: ChatGraphInput): Promise<ChatState> {
  const finalState = await compiledChatGraph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    threadId: input.threadId,
    userMessage: input.userMessage,
    traceId: input.traceId,
  });

  return finalState as ChatState;
}
