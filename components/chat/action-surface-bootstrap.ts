import {
  buildActionCardId,
  registerActionSurfaceResolver,
  type ActionSurfaceResolver,
} from "@/components/chat/action-surface-registry";

function readStringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toSingleLine(text: string, maxLength: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const savePreferenceResolver: ActionSurfaceResolver = (action) => {
  const preference =
    readStringField(action.output, "preference") ??
    readStringField(action.args, "preference") ??
    action.summary;

  if (!preference) {
    return null;
  }

  return {
    kind: "preference",
    optionLabel: preference,
    description: action.summary,
  };
};

const captureTaskResolver: ActionSurfaceResolver = (action) => {
  const taskTitle =
    readStringField(action.output, "task") ?? readStringField(action.args, "task") ?? action.summary;

  if (!taskTitle) {
    return null;
  }

  return {
    kind: "task",
    taskTitle,
    description: action.summary,
  };
};

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

let isBootstrapped = false;

export function ensureActionSurfaceResolversBootstrapped() {
  if (isBootstrapped) {
    return;
  }

  registerActionSurfaceResolver("save_preference", savePreferenceResolver);
  registerActionSurfaceResolver("capture_task", captureTaskResolver);
  registerActionSurfaceResolver("echo_tool", echoToolResolver);
  registerActionSurfaceResolver("current_time", currentTimeResolver);
  isBootstrapped = true;
}
