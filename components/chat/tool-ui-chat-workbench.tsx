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
import { Plan, type PlanTodo, type PlanTodoStatus } from "@/components/tool-ui/plan";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Loader2,
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
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const activeAssistantIdRef = useRef<string | null>(null);
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
    setThreadId(nextId);
    setMessages([]);
    setPhase("idle");
    setTraceId(null);
    setRetrievedCount(null);
    setPersistedCount(null);
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
      activeAssistantIdRef.current = assistantMessageId;

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
      setPhase("requesting");
      setIsSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers = new Headers({
          "content-type": "application/json",
        });

        if (token) {
          headers.set("authorization", `Bearer ${token}`);
        } else {
          headers.set("x-tenant-id", resolvedTenantId);
          headers.set("x-user-id", resolvedUserId);
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
            }
            return;
          }

          if (event === "token") {
            setPhase("streaming");
            const tokenText = typeof payload.text === "string" ? payload.text : "";
            if (tokenText) {
              updateAssistantMessage(assistantMessageId, (message) => ({
                ...message,
                content: message.content + tokenText,
              }));
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

            if (doneTraceId) {
              setTraceId(doneTraceId);
            }
            if (typeof doneRetrievedCount === "number") {
              setRetrievedCount(doneRetrievedCount);
            }
            if (typeof donePersistedCount === "number") {
              setPersistedCount(donePersistedCount);
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

            setPhase("completed");
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "请求失败，请检查网络或服务配置。";

        if (controller.signal.aborted) {
          setErrorText("本轮生成已停止。");
          updateAssistantMessage(assistantMessageId, (chatMessage) => ({
            ...chatMessage,
            content: chatMessage.content || "（已手动停止本轮生成）",
          }));
        } else {
          setErrorText(message);
          updateAssistantMessage(assistantMessageId, (chatMessage) => ({
            ...chatMessage,
            content: chatMessage.content || `请求失败：${message}`,
          }));
        }

        setPhase("failed");
      } finally {
        abortRef.current = null;
        activeAssistantIdRef.current = null;
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

  const composerDisabled = isSending || input.trim().length === 0;
  const jwtMode = jwtToken.trim().length > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-6 md:px-6">
      <header className="rounded-xl border bg-card p-4">
        <h1 className="text-xl font-semibold">Eywa Chat · Tool UI 工作台</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          基于 Tool UI（OptionList + Plan）构建，接入 /api/chat 的流式 SSE 响应。
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
