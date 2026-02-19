import type { SerializableEmailDraft } from "@/components/tool-ui/message-draft";
import type { PlanTodo } from "@/components/tool-ui/plan";
import type { SerializableTerminal } from "@/components/tool-ui/terminal";

export type ActionDonePayload = {
  plannedAction: "chat" | "skill" | "mcp";
  executorName?: string;
  summary?: string;
  error?: string;
  sourceMessage?: string;
  args?: Record<string, unknown>;
  output?: Record<string, unknown>;
  memoryCandidateCount?: number;
};

export type ActionSurface =
  | {
      kind: "preference";
      optionLabel: string;
      description?: string;
    }
  | {
      kind: "task";
      taskTitle: string;
      description?: string;
    }
  | {
      kind: "echo";
      draft: SerializableEmailDraft;
    }
  | {
      kind: "time";
      terminal: SerializableTerminal;
    }
  | {
      kind: "generic";
      terminal: SerializableTerminal;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildActionCardId(action: ActionDonePayload, suffix: string) {
  const raw = [action.plannedAction, action.executorName ?? "", action.summary ?? "", suffix].join(
    "-",
  );
  const compact = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64);
  return `${suffix}-${compact || "action"}`;
}

function buildActionTerminal(action: ActionDonePayload): SerializableTerminal {
  const argsBlock =
    action.args && Object.keys(action.args).length > 0
      ? JSON.stringify(action.args, null, 2)
      : "{}";
  const outputBlock =
    action.output && Object.keys(action.output).length > 0
      ? JSON.stringify(action.output, null, 2)
      : "{}";

  const stdoutLines = [
    `plannedAction: ${action.plannedAction}`,
    `executor: ${action.executorName ?? "n/a"}`,
    `sourceMessage: ${action.sourceMessage ?? "n/a"}`,
    `summary: ${action.summary ?? "n/a"}`,
    `memoryCandidateCount: ${action.memoryCandidateCount ?? 0}`,
    "",
    "args:",
    argsBlock,
    "",
    "output:",
    outputBlock,
  ];

  return {
    id: buildActionCardId(action, "action-terminal"),
    command: `${action.plannedAction} ${action.executorName ?? "n/a"}`,
    cwd: "/action",
    stdout: stdoutLines.join("\n"),
    stderr: action.error,
    exitCode: action.error ? 1 : 0,
    maxCollapsedLines: 12,
  };
}

export function parseActionDonePayload(value: unknown): ActionDonePayload | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const plannedAction = value.plannedAction;
  if (plannedAction !== "chat" && plannedAction !== "skill" && plannedAction !== "mcp") {
    return null;
  }

  const executorName =
    typeof value.executorName === "string" && value.executorName.trim()
      ? value.executorName.trim()
      : undefined;
  const summary =
    typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : undefined;
  const error =
    typeof value.error === "string" && value.error.trim() ? value.error.trim() : undefined;
  const sourceMessage =
    typeof value.sourceMessage === "string" && value.sourceMessage.trim()
      ? value.sourceMessage.trim()
      : undefined;
  const args = isPlainObject(value.args) ? value.args : undefined;
  const output = isPlainObject(value.output) ? value.output : undefined;
  const memoryCandidateCount =
    typeof value.memoryCandidateCount === "number" ? value.memoryCandidateCount : undefined;

  return {
    plannedAction,
    executorName,
    summary,
    error,
    sourceMessage,
    args,
    output,
    memoryCandidateCount,
  };
}

export function buildActionTodos(action: ActionDonePayload | null): PlanTodo[] {
  if (!action) {
    return [
      {
        id: "action-route",
        label: "动作路由",
        status: "pending",
        description: "本轮对话未触发外部动作执行。",
      },
      {
        id: "action-execute",
        label: "动作执行",
        status: "pending",
        description: "等待 MCP/Skill 被触发。",
      },
      {
        id: "action-validate",
        label: "结果校验",
        status: "pending",
        description: "等待动作执行结果。",
      },
    ];
  }

  if (action.plannedAction === "chat") {
    return [
      {
        id: "action-route",
        label: "动作路由",
        status: "completed",
        description: "本轮判定为普通对话路径（未调用 MCP/Skill）。",
      },
      {
        id: "action-execute",
        label: "动作执行",
        status: "cancelled",
        description: "跳过外部动作，直接进入回复生成。",
      },
      {
        id: "action-validate",
        label: "结果校验",
        status: "completed",
        description: "普通对话路径无需动作结果校验。",
      },
    ];
  }

  const routeDescription = `${action.plannedAction === "skill" ? "Skill" : "MCP"}：${
    action.executorName ?? "未命名动作"
  }`;

  const executeDescription = action.summary
    ? action.summary
    : action.error ?? "动作已执行，但未返回摘要。";

  const validateDescription = action.error
    ? `校验失败：${action.error}`
    : typeof action.memoryCandidateCount === "number"
      ? `校验通过，候选记忆 ${action.memoryCandidateCount} 条。`
      : "校验通过。";

  return [
    {
      id: "action-route",
      label: "动作路由",
      status: "completed",
      description: routeDescription,
    },
    {
      id: "action-execute",
      label: "动作执行",
      status: action.error ? "cancelled" : "completed",
      description: executeDescription,
    },
    {
      id: "action-validate",
      label: "结果校验",
      status: action.error ? "cancelled" : "completed",
      description: validateDescription,
    },
  ];
}

export type ActionSurfaceResolverContext = {
  userId: string;
};

export type ActionSurfaceResolver = (
  action: ActionDonePayload,
  context: ActionSurfaceResolverContext,
) => ActionSurface | null;

const actionSurfaceRegistry = new Map<string, ActionSurfaceResolver>();

export function registerActionSurfaceResolver(executorName: string, resolver: ActionSurfaceResolver) {
  actionSurfaceRegistry.set(executorName, resolver);
}

export function getActionSurfaceResolver(executorName: string) {
  return actionSurfaceRegistry.get(executorName);
}

export function buildActionSurface(action: ActionDonePayload | null, userId: string): ActionSurface | null {
  if (!action) {
    return null;
  }

  if (action.error) {
    return {
      kind: "generic",
      terminal: buildActionTerminal(action),
    };
  }

  const resolver = action.executorName ? getActionSurfaceResolver(action.executorName) : undefined;
  const resolved = resolver?.(action, { userId });
  if (resolved) {
    return resolved;
  }

  return {
    kind: "generic",
    terminal: buildActionTerminal(action),
  };
}

export function buildActionReplayMessage(action: ActionDonePayload): string | null {
  if (action.sourceMessage) {
    return action.sourceMessage;
  }

  if (action.plannedAction === "mcp" && action.executorName) {
    if (action.args && Object.keys(action.args).length > 0) {
      return `/tool ${action.executorName} ${JSON.stringify(action.args)}`;
    }
    return `/tool ${action.executorName}`;
  }

  if (action.plannedAction === "skill") {
    if (typeof action.args?.preference === "string" && action.args.preference.trim()) {
      return `请记住：${action.args.preference.trim()}`;
    }
    if (typeof action.args?.task === "string" && action.args.task.trim()) {
      return `请帮我记录任务：${action.args.task.trim()}`;
    }
  }

  if (action.summary) {
    return action.summary;
  }

  return null;
}
