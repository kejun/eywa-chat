"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  OptionList,
  type OptionListSelection,
} from "@/components/tool-ui/option-list";
import {
  MessageDraft,
  type SerializableEmailDraft,
} from "@/components/tool-ui/message-draft";
import { Plan, type PlanTodo, type PlanTodoStatus } from "@/components/tool-ui/plan";
import { Terminal, type SerializableTerminal } from "@/components/tool-ui/terminal";
import { ensureActionSurfaceResolversBootstrapped } from "@/components/chat/action-surface-bootstrap";
import {
  type ActionDonePayload,
  buildActionCardId,
  buildActionSurface,
  buildActionTodos,
  parseActionDonePayload,
} from "@/components/chat/action-surface-registry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Loader2,
  MailPlus,
  RotateCcw,
  SendHorizontal,
  ShieldAlert,
  Square,
} from "lucide-react";

type StreamPhase = "idle" | "requesting" | "streaming" | "completed" | "failed";

type MessageRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  traceId?: string;
  retrievedCount?: number;
  persistedCount?: number;
  degraded?: boolean;
};

type TerminalSession = SerializableTerminal & {
  traceId?: string;
};

type ActionHistoryEntry = {
  id: string;
  action: ActionDonePayload;
};

const THREAD_STORAGE_KEY = "eywa.chat.threadId";

const STARTER_PROMPTS = [
  {
    id: "memory-preferences",
    label: "记住我的偏好",
    description: "例如语言风格、输出格式与工作习惯。",
    prompt: "请记住：默认用中文回复我，先给结论再给步骤，尽量简洁。",
  },
  {
    id: "task-breakdown",
    label: "帮我拆解任务",
    description: "把一个复杂目标拆成可执行步骤。",
    prompt: "我要在两周内上线一个带持久化记忆的聊天机器人，请按天拆解执行计划。",
  },
  {
    id: "memory-recall",
    label: "回顾已记住内容",
    description: "让机器人总结已沉淀的长期记忆。",
    prompt: "请总结你已经记住了我哪些偏好和长期信息，并标注不确定项。",
  },
  {
    id: "action-workflow",
    label: "触发行动编排",
    description: "测试 MCP/Skills 的任务执行路径。",
    prompt: "我想安排一次上海出差，请先给出执行计划，再列出你会调用的工具。",
  },
] as const;

const STARTER_PROMPT_MAP: ReadonlyMap<string, string> = new Map(
  STARTER_PROMPTS.map((item) => [item.id, item.prompt]),
);

ensureActionSurfaceResolversBootstrapped();

function createShortId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10);
}

function createThreadId() {
  return `thread-${Date.now().toString(36)}-${createShortId()}`;
}

function createMessageId(prefix: MessageRole) {
  return `${prefix}-${Date.now().toString(36)}-${createShortId()}`;
}

function toSingleLine(text: string, maxLength: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildDraftSubject(content: string) {
  const primary = content
    .split(/\n|。|！|!|？|\?/)[0]
    ?.trim();
  if (!primary) {
    return "对话回复草稿";
  }
  return `回复草稿：${toSingleLine(primary, 36)}`;
}

type StreamPayload = Record<string, unknown>;

function parseSsePacket(packet: string): { event: string; payload: StreamPayload } | null {
  const lines = packet
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n");
  try {
    const parsed = JSON.parse(rawData);
    if (parsed && typeof parsed === "object") {
      return { event: eventName, payload: parsed as StreamPayload };
    }
    return { event: eventName, payload: { value: parsed } };
  } catch {
    return { event: eventName, payload: { value: rawData } };
  }
}

async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: string, payload: StreamPayload) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    while (true) {
      const boundaryIndex = buffer.indexOf("\n\n");
      if (boundaryIndex < 0) {
        break;
      }

      const packet = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      const parsed = parseSsePacket(packet);
      if (parsed) {
        onEvent(parsed.event, parsed.payload);
      }
    }
  }

  buffer += decoder.decode().replace(/\r/g, "");
  const tail = parseSsePacket(buffer);
  if (tail) {
    onEvent(tail.event, tail.payload);
  }
}

function buildPlanTodos(params: {
  phase: StreamPhase;
  traceId: string | null;
  retrievedCount: number | null;
  persistedCount: number | null;
  errorText: string | null;
}): PlanTodo[] {
  const { phase, traceId, retrievedCount, persistedCount, errorText } = params;

  const statusSets: Record<StreamPhase, PlanTodoStatus[]> = {
    idle: ["pending", "pending", "pending", "pending"],
    requesting: ["completed", "in_progress", "pending", "pending"],
    streaming: ["completed", "completed", "in_progress", "pending"],
    completed: ["completed", "completed", "completed", "completed"],
    failed: ["completed", "cancelled", "cancelled", "cancelled"],
  };

  const [requestStatus, retrieveStatus, responseStatus, persistStatus] = statusSets[phase];

  return [
    {
      id: "request",
      label: "构造请求上下文",
      status: requestStatus,
      description: "校验身份、生成 traceId，并准备线程输入。",
    },
    {
      id: "retrieve",
      label: "检索长期记忆",
      status: retrieveStatus,
      description:
        typeof retrievedCount === "number"
          ? `已召回 ${retrievedCount} 条记忆（SeekDB 混合检索）。`
          : "执行向量 + 关键词混合召回，注入 LangGraph 状态。",
    },
    {
      id: "respond",
      label: "生成与流式返回",
      status: responseStatus,
      description:
        phase === "failed" && errorText
          ? `生成失败：${errorText}`
          : traceId
            ? `流式 token 输出中（trace: ${traceId}）。`
            : "按 token 流式推送回复，实时更新前端。",
    },
    {
      id: "persist",
      label: "沉淀记忆写回",
      status: persistStatus,
      description:
        typeof persistedCount === "number"
          ? `本轮写回 ${persistedCount} 条可持久化记忆。`
          : "抽取高价值信息并回写长期记忆存储。",
    },
  ];
}

function renderActionSurfaceCard(params: {
  action: ActionDonePayload;
  scope: string;
  userId: string;
}) {
  const surface = buildActionSurface(params.action, params.userId);
  if (!surface) {
    return null;
  }

  if (surface.kind === "preference") {
    return (
      <OptionList
        id={buildActionCardId(params.action, `${params.scope}-preference-option`)}
        options={[
          {
            id: "selected",
            label: surface.optionLabel,
            description: surface.description,
          },
        ]}
        selectionMode="single"
        choice="selected"
      />
    );
  }

  if (surface.kind === "task") {
    return (
      <Plan
        id={buildActionCardId(params.action, `${params.scope}-task-plan`)}
        title="任务捕获结果"
        description={surface.description ?? "已写入任务记忆"}
        todos={[
          {
            id: "task-captured",
            label: surface.taskTitle,
            status: "completed",
          },
        ]}
        maxVisibleTodos={1}
      />
    );
  }

  if (surface.kind === "echo") {
    return <MessageDraft {...surface.draft} />;
  }

  if (surface.kind === "time" || surface.kind === "generic") {
    return <Terminal {...surface.terminal} />;
  }

  return null;
}

export function ToolUiChatWorkbench() {
  const [threadId, setThreadId] = useState("");
  const [jwtToken, setJwtToken] = useState("");
  const [tenantId, setTenantId] = useState("t1");
  const [userId, setUserId] = useState("u1");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedStarter, setSelectedStarter] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [traceId, setTraceId] = useState<string | null>(null);
  const [retrievedCount, setRetrievedCount] = useState<number | null>(null);
  const [persistedCount, setPersistedCount] = useState<number | null>(null);
  const [actionResult, setActionResult] = useState<ActionDonePayload | null>(null);
  const [actionResultEntryId, setActionResultEntryId] = useState<string | null>(null);
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>([]);
  const [activeTerminal, setActiveTerminal] = useState<TerminalSession | null>(null);
  const [terminalHistory, setTerminalHistory] = useState<TerminalSession[]>([]);
  const [emailDraft, setEmailDraft] = useState<SerializableEmailDraft | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagePanelRef = useRef<HTMLDivElement>(null);

  const starterOptions = useMemo(
    () =>
      STARTER_PROMPTS.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
      })),
    [],
  );

  const runtimeTodos = useMemo(
    () =>
      buildPlanTodos({
        phase,
        traceId,
        retrievedCount,
        persistedCount,
        errorText,
      }),
    [errorText, persistedCount, phase, retrievedCount, traceId],
  );

  const latestAssistantMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.content.trim().length > 0) ??
      null,
    [messages],
  );

  const actionTodos = useMemo(() => buildActionTodos(actionResult), [actionResult]);

  const olderActionHistory = useMemo(
    () =>
      actionHistory
        .filter((entry) => entry.id !== actionResultEntryId)
        .slice(0, 4),
    [actionHistory, actionResultEntryId],
  );

  useEffect(() => {
    const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
    const nextId = existing && existing.trim() ? existing : createThreadId();
    setThreadId(nextId);
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextId);
  }, []);

  useEffect(() => {
    const panel = messagePanelRef.current;
    if (!panel) {
      return;
    }
    panel.scrollTop = panel.scrollHeight;
  }, [isSending, messages]);

  const refreshThread = useCallback(() => {
    const nextId = createThreadId();
    abortRef.current?.abort();
    setThreadId(nextId);
    setMessages([]);
    setPhase("idle");
    setTraceId(null);
    setRetrievedCount(null);
    setPersistedCount(null);
    setActionResult(null);
    setActionResultEntryId(null);
    setActionHistory([]);
    setActiveTerminal(null);
    setTerminalHistory([]);
    setEmailDraft(null);
    setDraftNotice(null);
    setErrorText(null);
    setSelectedStarter(null);
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextId);
  }, []);

  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (message: ChatMessage) => ChatMessage) => {
      setMessages((previous) =>
        previous.map((message) =>
          message.id === assistantId && message.role === "assistant" ? updater(message) : message,
        ),
      );
    },
    [],
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const messageText = rawText.trim();
      if (!messageText || isSending) {
        return;
      }
      if (!threadId) {
        setErrorText("线程尚未初始化，请稍后再试。");
        return;
      }

      const token = jwtToken.trim();
      const resolvedTenantId = tenantId.trim();
      const resolvedUserId = userId.trim();
      if (!token && (!resolvedTenantId || !resolvedUserId)) {
        setErrorText("请提供 JWT，或填写 tenantId/userId（用于本地不安全模式）。");
        return;
      }

      const userMessageId = createMessageId("user");
      const assistantMessageId = createMessageId("assistant");
      const terminalId = `terminal-${Date.now().toString(36)}-${createShortId()}`;
      const requestStartedAt = Date.now();
      let tokenChunkCount = 0;
      let terminalFinalized = false;

      const appendTerminalLine = (line: string) => {
        setActiveTerminal((current) => {
          if (!current || current.id !== terminalId) {
            return current;
          }
          return {
            ...current,
            stdout: current.stdout ? `${current.stdout}\n${line}` : line,
          };
        });
      };

      const finalizeTerminal = (params: {
        exitCode: number;
        stderr?: string;
        traceId?: string;
      }) => {
        if (terminalFinalized) {
          return;
        }
        terminalFinalized = true;

        const durationMs = Date.now() - requestStartedAt;
        setActiveTerminal((current) => {
          if (!current || current.id !== terminalId) {
            return current;
          }

          const completedSession: TerminalSession = {
            ...current,
            exitCode: params.exitCode,
            stderr: params.stderr,
            traceId: params.traceId ?? current.traceId,
            durationMs,
          };
          setTerminalHistory((history) => [completedSession, ...history].slice(0, 6));
          return null;
        });
      };

      setMessages((previous) => [
        ...previous,
        { id: userMessageId, role: "user", content: messageText },
        { id: assistantMessageId, role: "assistant", content: "" },
      ]);

      setInput("");
      setErrorText(null);
      setTraceId(null);
      setRetrievedCount(null);
      setPersistedCount(null);
      setActionResult(null);
      setActionResultEntryId(null);
      setDraftNotice(null);
      setPhase("requesting");
      setIsSending(true);
      setActiveTerminal({
        id: terminalId,
        command: `POST /api/chat --thread ${threadId}`,
        stdout: [
          `[request] ${new Date(requestStartedAt).toISOString()}`,
          `[input] ${toSingleLine(messageText, 120)}`,
        ].join("\n"),
        exitCode: 0,
        cwd: "/api/chat",
        maxCollapsedLines: 10,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers = new Headers({
          "content-type": "application/json",
        });

        if (token) {
          headers.set("authorization", `Bearer ${token}`);
          appendTerminalLine("[auth] bearer token");
        } else {
          headers.set("x-tenant-id", resolvedTenantId);
          headers.set("x-user-id", resolvedUserId);
          appendTerminalLine(
            `[auth] header mode tenant=${resolvedTenantId} user=${resolvedUserId}`,
          );
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({
            threadId,
            message: messageText,
          }),
          signal: controller.signal,
        });
        appendTerminalLine(`[http] status ${response.status}`);

        if (!response.ok) {
          const bodyText = await response.text();
          let message = `请求失败（${response.status}）`;
          try {
            const parsed = JSON.parse(bodyText) as { error?: string };
            if (parsed.error) {
              message = `${parsed.error}（${response.status}）`;
            }
          } catch {
            if (bodyText.trim()) {
              message = `${message}: ${bodyText.trim()}`;
            }
          }
          throw new Error(message);
        }

        if (!response.body) {
          throw new Error("响应流为空，无法建立流式会话。");
        }

        await consumeSseStream(response.body, (event, payload) => {
          if (event === "meta") {
            const nextTraceId =
              typeof payload.traceId === "string" && payload.traceId.trim()
                ? payload.traceId
                : null;
            if (nextTraceId) {
              setTraceId(nextTraceId);
              setActiveTerminal((current) => {
                if (!current || current.id !== terminalId) {
                  return current;
                }
                return { ...current, traceId: nextTraceId };
              });
              appendTerminalLine(`[meta] traceId=${nextTraceId}`);
            }
            return;
          }

          if (event === "token") {
            setPhase("streaming");
            tokenChunkCount += 1;
            const tokenText = typeof payload.text === "string" ? payload.text : "";
            if (tokenText) {
              updateAssistantMessage(assistantMessageId, (message) => ({
                ...message,
                content: message.content + tokenText,
              }));
              if (tokenChunkCount === 1 || tokenChunkCount % 20 === 0) {
                appendTerminalLine(`[token] chunks=${tokenChunkCount}`);
              }
            }
            return;
          }

          if (event === "done") {
            const doneTraceId =
              typeof payload.traceId === "string" && payload.traceId.trim()
                ? payload.traceId
                : undefined;
            const doneRetrievedCount =
              typeof payload.retrievedCount === "number" ? payload.retrievedCount : undefined;
            const donePersistedCount =
              typeof payload.persistedCount === "number" ? payload.persistedCount : undefined;
            const degraded = payload.degraded === true;
            const parsedAction = parseActionDonePayload(payload.action);

            if (doneTraceId) {
              setTraceId(doneTraceId);
            }
            if (typeof doneRetrievedCount === "number") {
              setRetrievedCount(doneRetrievedCount);
            }
            if (typeof donePersistedCount === "number") {
              setPersistedCount(donePersistedCount);
            }
            if (parsedAction) {
              const actionEntryId = `action-${Date.now().toString(36)}-${createShortId()}`;
              setActionResult(parsedAction);
              setActionResultEntryId(actionEntryId);
              setActionHistory((previous) =>
                [{ id: actionEntryId, action: parsedAction }, ...previous].slice(0, 10),
              );
            } else {
              setActionResult(null);
              setActionResultEntryId(null);
            }

            updateAssistantMessage(assistantMessageId, (message) => ({
              ...message,
              traceId: doneTraceId ?? message.traceId ?? traceId ?? undefined,
              retrievedCount: doneRetrievedCount ?? message.retrievedCount,
              persistedCount: donePersistedCount ?? message.persistedCount,
              degraded,
            }));

            if (degraded) {
              setErrorText("模型已降级处理，本轮回复可用但建议稍后重试。");
            }

            appendTerminalLine(
              `[done] retrieved=${doneRetrievedCount ?? 0} persisted=${donePersistedCount ?? 0} degraded=${degraded}`,
            );
            if (parsedAction) {
              appendTerminalLine(
                `[action] ${parsedAction.plannedAction}:${parsedAction.executorName ?? "n/a"} error=${parsedAction.error ? "yes" : "no"}`,
              );
            } else {
              appendTerminalLine("[action] none");
            }
            finalizeTerminal({
              exitCode: 0,
              traceId: doneTraceId,
            });
            setPhase("completed");
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "请求失败，请检查网络或服务配置。";

        if (controller.signal.aborted) {
          setErrorText("本轮生成已停止。");
          appendTerminalLine("[abort] generation cancelled by user");
          updateAssistantMessage(assistantMessageId, (chatMessage) => ({
            ...chatMessage,
            content: chatMessage.content || "（已手动停止本轮生成）",
          }));
          finalizeTerminal({
            exitCode: 130,
            stderr: "aborted by user",
          });
        } else {
          setErrorText(message);
          appendTerminalLine(`[error] ${message}`);
          updateAssistantMessage(assistantMessageId, (chatMessage) => ({
            ...chatMessage,
            content: chatMessage.content || `请求失败：${message}`,
          }));
          finalizeTerminal({
            exitCode: 1,
            stderr: message,
          });
        }

        setPhase("failed");
      } finally {
        abortRef.current = null;
        if (!terminalFinalized) {
          appendTerminalLine("[finalize] stream closed");
          finalizeTerminal({ exitCode: 0 });
        }
        setIsSending(false);
      }
    },
    [isSending, jwtToken, tenantId, threadId, traceId, updateAssistantMessage, userId],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      event.preventDefault();
      void sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleStarterSelectionChange = useCallback((selection: OptionListSelection) => {
    setSelectedStarter(typeof selection === "string" ? selection : null);
  }, []);

  const handleStarterAction = useCallback(
    async (actionId: string, selection: OptionListSelection) => {
      if (actionId !== "confirm" || typeof selection !== "string") {
        if (actionId === "cancel") {
          setSelectedStarter(null);
        }
        return;
      }

      const prompt = STARTER_PROMPT_MAP.get(selection);
      if (!prompt) {
        return;
      }

      setSelectedStarter(null);
      setInput(prompt);
      await sendMessage(prompt);
    },
    [sendMessage],
  );

  const handleStarterBeforeAction = useCallback(
    (actionId: string, selection: OptionListSelection) => {
      if (isSending) {
        return false;
      }
      if (actionId === "confirm") {
        return typeof selection === "string";
      }
      return true;
    },
    [isSending],
  );

  const handleCreateDraftFromLatest = useCallback(() => {
    if (!latestAssistantMessage) {
      return;
    }

    const recipientIdentity = userId.trim() || "user";
    const draft: SerializableEmailDraft = {
      id: `draft-${Date.now().toString(36)}-${createShortId()}`,
      channel: "email",
      subject: buildDraftSubject(latestAssistantMessage.content),
      from: "assistant@eywa.local",
      to: [`${recipientIdentity}@example.com`],
      body: latestAssistantMessage.content,
    };
    setEmailDraft(draft);
    setDraftNotice("已从最近一条 assistant 回复生成邮件草稿。");
  }, [latestAssistantMessage, userId]);

  const handleDraftSend = useCallback(() => {
    setDraftNotice("邮件草稿已发送（模拟）。");
    setMessages((previous) => [
      ...previous,
      {
        id: createMessageId("assistant"),
        role: "assistant",
        content: "我已根据草稿发送邮件（模拟执行）。",
      },
    ]);
  }, []);

  const handleDraftUndo = useCallback(() => {
    setDraftNotice("已撤销发送，草稿恢复为可编辑状态。");
  }, []);

  const handleDraftCancel = useCallback(() => {
    setEmailDraft(null);
    setDraftNotice("已关闭邮件草稿。");
  }, []);

  const handleClearTerminalHistory = useCallback(() => {
    setActiveTerminal(null);
    setTerminalHistory([]);
  }, []);

  const composerDisabled = isSending || input.trim().length === 0;
  const jwtMode = jwtToken.trim().length > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="rounded-xl border bg-card p-4">
        <h1 className="text-xl font-semibold">Eywa Chat · Tool UI 工作台</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          基于 Tool UI（OptionList + Plan + Terminal + MessageDraft）构建，接入 /api/chat 的流式 SSE 响应。
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <Plan
            id="chat-runtime-plan"
            title="对话执行进度"
            description={threadId ? `Thread: ${threadId}` : "Thread 初始化中..."}
            todos={runtimeTodos}
          />

          <div className="space-y-2">
            <Plan
              id="chat-action-plan"
              title="动作执行卡片"
              description={
                actionResult
                  ? `${actionResult.plannedAction.toUpperCase()} · ${actionResult.executorName ?? "未命名动作"}`
                  : "尚未产生 MCP/Skill 动作结果"
              }
              todos={actionTodos}
            />
            {actionResult
              ? renderActionSurfaceCard({
                  action: actionResult,
                  scope: "action-current",
                  userId,
                })
              : null}
            {olderActionHistory.length > 0 ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">最近动作历史</p>
                {olderActionHistory.map((entry) => (
                  <div key={entry.id} className="space-y-2 rounded-lg border border-dashed p-2">
                    <p className="text-muted-foreground text-[11px]">
                      {entry.action.plannedAction.toUpperCase()} ·{" "}
                      {entry.action.executorName ?? "未命名动作"}
                    </p>
                    <Plan
                      id={`${entry.id}-summary-plan`}
                      title="历史动作摘要"
                      description={entry.action.summary ?? "无摘要"}
                      todos={buildActionTodos(entry.action)}
                      maxVisibleTodos={3}
                    />
                    {renderActionSurfaceCard({
                      action: entry.action,
                      scope: entry.id,
                      userId,
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="text-muted-foreground size-4" />
              <h2 className="text-sm font-medium">鉴权配置</h2>
            </div>

            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">JWT Bearer Token（优先）</span>
                <textarea
                  className="border-input bg-background min-h-20 resize-y rounded-md border px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  placeholder="粘贴 JWT；有值时将自动使用 Authorization 头"
                  value={jwtToken}
                  onChange={(event) => setJwtToken(event.target.value)}
                />
              </label>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">tenantId（本地模式）</span>
                  <input
                    className="border-input bg-background rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">userId（本地模式）</span>
                  <input
                    className="border-input bg-background rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <p className="text-muted-foreground mt-3 text-xs">
              当前模式：{jwtMode ? "JWT 安全模式" : "Header 本地模式（需 ALLOW_INSECURE_CONTEXT=1）"}
            </p>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-medium">快捷提问（Tool UI OptionList）</h2>
            <OptionList
              id="starter-prompts"
              options={starterOptions}
              selectionMode="single"
              value={selectedStarter}
              onChange={handleStarterSelectionChange}
              onAction={handleStarterAction}
              onBeforeAction={handleStarterBeforeAction}
              actions={[
                { id: "cancel", label: "清空" },
                { id: "confirm", label: "直接发送" },
              ]}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">请求诊断（Tool UI Terminal）</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearTerminalHistory}
                disabled={!activeTerminal && terminalHistory.length === 0}
              >
                清空
              </Button>
            </div>

            {activeTerminal ? (
              <Terminal {...activeTerminal} expanded />
            ) : terminalHistory.length > 0 ? (
              <div className="space-y-2">
                {terminalHistory.map((session) => (
                  <Terminal key={session.id} {...session} />
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
                发送消息后，这里会显示 /api/chat 的请求与流式回包日志。
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-[72vh] flex-col rounded-xl border bg-card p-4">
          <div ref={messagePanelRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                还没有对话。你可以使用左侧快捷提问，或在下方输入框直接发送消息。
              </div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                const showAssistantMeta =
                  !isUser &&
                  (message.traceId ||
                    typeof message.retrievedCount === "number" ||
                    typeof message.persistedCount === "number" ||
                    message.degraded);

                return (
                  <div
                    key={message.id}
                    className={cn("flex", isUser ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-background border shadow-xs",
                      )}
                    >
                      <p className="whitespace-pre-wrap">
                        {message.content ||
                          (isSending ? (
                            <span className="text-muted-foreground inline-flex items-center gap-2">
                              <Loader2 className="size-3.5 animate-spin" />
                              正在生成...
                            </span>
                          ) : (
                            " "
                          ))}
                      </p>

                      {showAssistantMeta && (
                        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {message.traceId && <span>trace: {message.traceId}</span>}
                          {typeof message.retrievedCount === "number" && (
                            <span>retrieved: {message.retrievedCount}</span>
                          )}
                          {typeof message.persistedCount === "number" && (
                            <span>persisted: {message.persistedCount}</span>
                          )}
                          {message.degraded && <span>degraded</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {errorText && (
            <div className="text-destructive mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              {errorText}
            </div>
          )}

          <div className="mt-4 space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-muted-foreground text-xs">
                {latestAssistantMessage
                  ? "可将最近一条 assistant 回复转成邮件草稿。"
                  : "先让 assistant 生成一条回复，再创建草稿。"}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCreateDraftFromLatest}
                disabled={!latestAssistantMessage}
              >
                <MailPlus className="size-4" />
                生成邮件草稿
              </Button>
            </div>

            {draftNotice && (
              <div className="text-muted-foreground rounded-md border bg-muted/40 px-3 py-2 text-xs">
                {draftNotice}
              </div>
            )}

            {emailDraft ? (
              <MessageDraft
                {...emailDraft}
                onSend={handleDraftSend}
                onUndo={handleDraftUndo}
                onCancel={handleDraftCancel}
              />
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t pt-4">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
              className="border-input bg-background min-h-28 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-muted-foreground text-xs">
                {threadId ? (
                  <span>Thread: {threadId}</span>
                ) : (
                  <span>正在初始化 Thread...</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={refreshThread}>
                  <RotateCcw className="size-4" />
                  新线程
                </Button>

                {isSending ? (
                  <Button type="button" variant="destructive" onClick={handleAbort}>
                    <Square className="size-4" />
                    停止
                  </Button>
                ) : (
                  <Button type="submit" disabled={composerDisabled}>
                    <SendHorizontal className="size-4" />
                    发送
                  </Button>
                )}
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}
