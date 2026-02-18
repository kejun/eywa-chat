import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { extractMemoryCandidates } from "@/lib/chat/memory-extractor";
import { getChatModel } from "@/lib/chat/model";
import { buildSystemPrompt } from "@/lib/chat/prompt";
import { ChatStateAnnotation, type ChatGraphInput, type ChatState } from "@/lib/chat/state";
import { memoryRepository } from "@/lib/memory";
import { logger } from "@/lib/logger";
import { mcpAdapter } from "@/lib/mcp";
import { skillRegistry } from "@/lib/skills";

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

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseToolDirective(message: string): {
  toolName: string;
  args: Record<string, unknown>;
} | null {
  const matched = message.trim().match(/^\/tool\s+([a-zA-Z0-9_-]+)(?:\s+(.+))?$/);
  if (!matched) {
    return null;
  }

  const [, toolName, rawInput] = matched;
  if (!rawInput) {
    return { toolName, args: {} };
  }

  try {
    const parsed = JSON.parse(rawInput) as unknown;
    return {
      toolName,
      args: asObject(parsed),
    };
  } catch {
    return {
      toolName,
      args: { text: rawInput },
    };
  }
}

const classifyIntentNode = async (state: ChatState) => {
  return {
    shouldRetrieve: !isLowSignalMessage(state.userMessage),
  };
};

const planActionsNode = async (state: ChatState) => {
  const toolDirective = parseToolDirective(state.userMessage);
  if (toolDirective) {
    return {
      plannedAction: "mcp" as const,
      selectedTool: toolDirective.toolName,
      toolArgs: toolDirective.args,
    };
  }

  if (skillRegistry.match(state.userMessage)) {
    return {
      plannedAction: "skill" as const,
    };
  }

  return {
    plannedAction: "chat" as const,
  };
};

const routeSkillNode = async (state: ChatState) => {
  if (state.plannedAction !== "skill") {
    return {};
  }

  const matched = skillRegistry.match(state.userMessage);
  if (!matched) {
    return {
      plannedAction: "chat" as const,
      actionValidationError: "未找到可匹配的技能，已回退到普通对话。",
    };
  }

  return {
    selectedSkill: matched.skill.name,
    skillArgs: asObject(matched.args),
  };
};

const executeSkillNode = async (state: ChatState) => {
  if (state.plannedAction !== "skill" || !state.selectedSkill) {
    return {};
  }

  const skill = skillRegistry.get(state.selectedSkill);
  if (!skill) {
    return {
      actionValidationError: `技能不存在: ${state.selectedSkill}`,
    };
  }

  const parsedArgs = skill.inputSchema.safeParse(state.skillArgs);
  if (!parsedArgs.success) {
    return {
      actionValidationError: `技能参数不合法: ${JSON.stringify(parsedArgs.error.issues)}`,
    };
  }

  try {
    const result = await skill.run(
      {
        tenantId: state.tenantId,
        userId: state.userId,
        threadId: state.threadId,
        traceId: state.traceId,
        userMessage: state.userMessage,
      },
      parsedArgs.data,
    );

    return {
      actionSummary: result.summary,
      actionMemoryCandidates: result.memoryCandidates ?? [],
      actionValidationError: result.status === "failed" ? result.summary : "",
    };
  } catch (error) {
    return {
      actionValidationError:
        error instanceof Error ? error.message : "技能执行失败，请稍后重试。",
    };
  }
};

const routeMcpToolNode = async (state: ChatState) => {
  if (state.plannedAction !== "mcp") {
    return {};
  }

  const directive = parseToolDirective(state.userMessage);
  if (!directive) {
    return {
      actionValidationError: "未识别到 MCP 工具名，已跳过工具调用。",
    };
  }

  return {
    selectedTool: directive.toolName,
    toolArgs: directive.args,
  };
};

const executeMcpToolNode = async (state: ChatState) => {
  if (state.plannedAction !== "mcp" || !state.selectedTool) {
    return {};
  }

  try {
    const result = await mcpAdapter.execute({
      toolName: state.selectedTool,
      input: state.toolArgs,
      context: {
        tenantId: state.tenantId,
        userId: state.userId,
        threadId: state.threadId,
        traceId: state.traceId,
        allowedTools: mcpAdapter.listTools().map((tool) => tool.name),
      },
    });

    return {
      actionSummary: result.summary,
      actionMemoryCandidates: result.memoryCandidates ?? [],
      actionValidationError: result.status === "failed" ? result.summary : "",
    };
  } catch (error) {
    return {
      actionValidationError:
        error instanceof Error ? error.message : "MCP 工具执行失败，请稍后重试。",
    };
  }
};

const validateToolResultNode = async (state: ChatState) => {
  if (state.plannedAction !== "mcp" && state.plannedAction !== "skill") {
    return {};
  }

  if (state.actionValidationError) {
    logger.warn("chat-action-validated-with-error", {
      traceId: state.traceId,
      plannedAction: state.plannedAction,
      actionValidationError: state.actionValidationError,
    });
    return {};
  }

  if (!state.actionSummary) {
    return {
      actionValidationError: "动作执行未返回可用结果，已回退到普通对话。",
    };
  }

  return {};
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
  const userPromptParts = [state.userMessage];

  if (state.actionSummary) {
    userPromptParts.push(`动作执行结果：${state.actionSummary}`);
  }
  if (state.actionValidationError) {
    userPromptParts.push(`动作执行异常：${state.actionValidationError}`);
  }

  try {
    const responseMessage = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPromptParts.join("\n\n")),
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

const persistActionMemoryNode = async (state: ChatState) => {
  if (state.actionMemoryCandidates.length === 0) {
    return {
      persistedCount: state.persistedCount,
    };
  }

  try {
    const upserted = await memoryRepository.upsertMemories(state.actionMemoryCandidates);
    return {
      persistedCount: state.persistedCount + upserted.length,
    };
  } catch (error) {
    logger.warn("chat-persist-action-memory-failed", {
      traceId: state.traceId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      persistedCount: state.persistedCount,
    };
  }
};

const compiledChatGraph = new StateGraph(ChatStateAnnotation)
  .addNode("classifyIntent", classifyIntentNode)
  .addNode("planActions", planActionsNode)
  .addNode("routeSkill", routeSkillNode)
  .addNode("executeSkill", executeSkillNode)
  .addNode("routeMcpTool", routeMcpToolNode)
  .addNode("executeMcpTool", executeMcpToolNode)
  .addNode("validateToolResult", validateToolResultNode)
  .addNode("retrieveMemories", retrieveMemoriesNode)
  .addNode("generateResponse", generateResponseNode)
  .addNode("extractMemoryCandidates", extractMemoryCandidatesNode)
  .addNode("persistMemories", persistMemoriesNode)
  .addNode("persistActionMemory", persistActionMemoryNode)
  .addEdge(START, "classifyIntent")
  .addEdge("classifyIntent", "planActions")
  .addEdge("planActions", "routeSkill")
  .addEdge("routeSkill", "executeSkill")
  .addEdge("executeSkill", "routeMcpTool")
  .addEdge("routeMcpTool", "executeMcpTool")
  .addEdge("executeMcpTool", "validateToolResult")
  .addEdge("validateToolResult", "retrieveMemories")
  .addEdge("retrieveMemories", "generateResponse")
  .addEdge("generateResponse", "extractMemoryCandidates")
  .addEdge("extractMemoryCandidates", "persistMemories")
  .addEdge("persistMemories", "persistActionMemory")
  .addEdge("persistActionMemory", END)
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
