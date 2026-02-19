import type { ActionSurfaceResolverPack } from "@/components/chat/action-surfaces/types";
import {
  buildActionCardId,
  type ActionSurfaceResolver,
} from "@/components/chat/action-surface-registry";
import { readStringField, toSingleLine } from "@/components/chat/action-surfaces/shared";

const echoToolResolver: ActionSurfaceResolver = (action, context) => {
  const echoedText =
    readStringField(action.output, "echoedText") ??
    readStringField(action.args, "text") ??
    action.summary;

  if (!echoedText) {
    return null;
  }

  const recipientIdentity = context.userId.trim() || "user";
  return {
    kind: "echo",
    draft: {
      id: buildActionCardId(action, "action-echo-draft"),
      channel: "email",
      subject: `Echo 输出：${toSingleLine(echoedText, 32)}`,
      from: "assistant@eywa.local",
      to: [`${recipientIdentity}@example.com`],
      body: echoedText,
      outcome: "sent",
    },
  };
};

const currentTimeResolver: ActionSurfaceResolver = (action) => {
  const timezone = readStringField(action.output, "timezone") ?? readStringField(action.args, "timezone");
  const isoTime = readStringField(action.output, "isoTime");
  const lines = [
    "当前时间工具返回",
    `timezone: ${timezone ?? "n/a"}`,
    `isoTime: ${isoTime ?? "n/a"}`,
    `summary: ${action.summary ?? "n/a"}`,
  ];

  return {
    kind: "time",
    terminal: {
      id: buildActionCardId(action, "action-time-terminal"),
      command: "current_time",
      cwd: "/mcp/current_time",
      stdout: lines.join("\n"),
      exitCode: 0,
      maxCollapsedLines: 8,
    },
  };
};

export const mcpActionSurfacePack: ActionSurfaceResolverPack = {
  name: "mcp-default-pack",
  resolvers: [
    {
      executorName: "echo_tool",
      resolver: echoToolResolver,
    },
    {
      executorName: "current_time",
      resolver: currentTimeResolver,
    },
  ],
};
