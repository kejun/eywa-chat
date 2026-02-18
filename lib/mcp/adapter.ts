import { z } from "zod";
import { logger } from "@/lib/logger";
import type { McpExecutionContext, McpToolDefinition, McpToolResult } from "@/lib/mcp/types";

type AnyMcpTool = McpToolDefinition<z.ZodTypeAny>;

function timeoutPromise<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`MCP tool execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildEchoTool(): AnyMcpTool {
  const inputSchema = z.object({
    text: z.string().min(1),
  });

  const tool: McpToolDefinition<typeof inputSchema> = {
    name: "echo_tool",
    description: "回显文本（用于 MCP 链路验证）",
    inputSchema,
    timeoutMs: 8_000,
    retryable: false,
    execute: async (context, args) => {
      const summary = `工具已回显：${args.text}`;
      return {
        status: "success",
        summary,
        output: {
          echoedText: args.text,
        },
        memoryCandidates: [
          {
            tenantId: context.tenantId,
            userId: context.userId,
            threadId: context.threadId,
            memoryType: "fact",
            key: `mcp_echo_${args.text.slice(0, 24)}`,
            content: args.text,
            importance: 2,
            sourceMessageId: context.traceId,
            tags: ["mcp", "echo"],
            sourceType: "mcp",
            sourceName: "echo_tool",
            confidence: 0.95,
            actionTraceId: context.traceId,
          },
        ],
      };
    },
  };

  return tool;
}

function buildCurrentTimeTool(): AnyMcpTool {
  const inputSchema = z.object({
    timezone: z.string().default("Asia/Shanghai"),
  });

  const tool: McpToolDefinition<typeof inputSchema> = {
    name: "current_time",
    description: "获取当前时间（用于工具链路验证）",
    inputSchema,
    timeoutMs: 8_000,
    retryable: true,
    execute: async (_context, args) => {
      const now = new Date();
      return {
        status: "success",
        summary: `当前时间（${args.timezone}）: ${now.toISOString()}`,
        output: {
          isoTime: now.toISOString(),
          timezone: args.timezone,
        },
      };
    },
  };

  return tool;
}

export class McpAdapter {
  private readonly tools = new Map<string, AnyMcpTool>();

  register(tool: AnyMcpTool) {
    this.tools.set(tool.name, tool);
  }

  listTools() {
    return Array.from(this.tools.values());
  }

  getTool(name: string) {
    return this.tools.get(name);
  }

  async execute(params: {
    toolName: string;
    input: unknown;
    context: McpExecutionContext;
  }): Promise<McpToolResult> {
    const tool = this.getTool(params.toolName);
    if (!tool) {
      throw new Error(`MCP tool not found: ${params.toolName}`);
    }

    if (
      params.context.allowedTools &&
      params.context.allowedTools.length > 0 &&
      !params.context.allowedTools.includes(tool.name)
    ) {
      throw new Error(`MCP tool is not allowed: ${tool.name}`);
    }

    const parsedInput = tool.inputSchema.safeParse(params.input);
    if (!parsedInput.success) {
      throw new Error(
        `Invalid MCP input for ${tool.name}: ${JSON.stringify(parsedInput.error.issues)}`,
      );
    }

    const timeoutMs = tool.timeoutMs ?? 10_000;
    const maxAttempts = tool.retryable ? 2 : 1;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await timeoutPromise(tool.execute(params.context, parsedInput.data), timeoutMs);
        logger.info("mcp-tool-executed", {
          traceId: params.context.traceId,
          toolName: tool.name,
          attempt,
          status: result.status,
          summary: result.summary,
        });
        return result;
      } catch (error) {
        lastError = error;
        logger.warn("mcp-tool-attempt-failed", {
          traceId: params.context.traceId,
          toolName: tool.name,
          attempt,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw new Error(
      `MCP tool failed after ${maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}

const adapter = new McpAdapter();
adapter.register(buildEchoTool());
adapter.register(buildCurrentTimeTool());

export const mcpAdapter = adapter;
