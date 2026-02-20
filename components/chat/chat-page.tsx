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
  Loader2,
  SendHorizontal,
  Settings,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type ActionDonePayload,
  buildActionCardId,
  buildActionSurface,
  parseActionDonePayload,
} from "@/components/chat/action-surface-registry";
import { ensureActionSurfaceResolversBootstrapped } from "@/components/chat/action-surface-bootstrap";
import { ThinkingBlock, type ThinkingData } from "@/components/chat/thinking-block";
import { MarkdownContent } from "@/components/chat/markdown-content";
import {
  SettingsDrawer,
  type SettingsValues,
} from "@/components/chat/settings-drawer";
import type { TerminalSession } from "@/components/chat/types";
import {
  OptionList,
} from "@/components/tool-ui/option-list";
import { Plan } from "@/components/tool-ui/plan";
import { MessageDraft } from "@/components/tool-ui/message-draft";
import { Terminal } from "@/components/tool-ui/terminal";

type MessageRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  traceId?: string;
  thinking?: ThinkingData;
};

const THREAD_STORAGE_KEY = "eywa.chat.threadId";

const SUGGESTIONS = [
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
    description: "让我总结已沉淀的长期记忆。",
    prompt: "请总结你已经记住了我哪些偏好和长期信息，并标注不确定项。",
  },
  {
    id: "action-workflow",
    label: "触发行动编排",
    description: "测试 MCP/Skills 的任务执行路径。",
    prompt: "我想安排一次上海出差，请先给出执行计划，再列出你会调用的工具。",
  },
] as const;

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
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

type StreamPayload = Record<string, unknown>;

function parseSsePacket(packet: string): { event: string; payload: StreamPayload } | null {
  const lines = packet
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (lines.length === 0) return null;

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

  if (dataLines.length === 0) return null;

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
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    while (true) {
      const boundaryIndex = buffer.indexOf("\n\n");
      if (boundaryIndex < 0) break;

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

export function ChatPage() {
  const [threadId, setThreadId] = useState("");
  const [settings, setSettings] = useState<SettingsValues>({
    jwtToken: "",
    tenantId: "t1",
    userId: "u1",
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentStreamingId, setCurrentStreamingId] = useState<string | null>(null);
  const [activeTerminal, setActiveTerminal] = useState<TerminalSession | null>(null);
  const [terminalHistory, setTerminalHistory] = useState<TerminalSession[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const messagePanelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
    const nextId = existing && existing.trim() ? existing : createThreadId();
    setThreadId(nextId);
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextId);
  }, []);

  useEffect(() => {
    const panel = messagePanelRef.current;
    if (!panel) return;
    panel.scrollTop = panel.scrollHeight;
  }, [isSending, messages]);

  const refreshThread = useCallback(() => {
    const nextId = createThreadId();
    abortRef.current?.abort();
    setThreadId(nextId);
    setMessages([]);
    setErrorText(null);
    setCurrentStreamingId(null);
    setActiveTerminal(null);
    setTerminalHistory([]);
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextId);
  }, []);

  const handleClearTerminalHistory = useCallback(() => {
    setActiveTerminal(null);
    setTerminalHistory([]);
  }, []);

  const updateAssistantMessage = useCallback(
    (assistantId: string, updater: (msg: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId && msg.role === "assistant" ? updater(msg) : msg,
        ),
      );
    },
    [],
  );

  const sendMessage = useCallback(
    async (rawText: string) => {
      const messageText = rawText.trim();
      if (!messageText || isSending) return;
      if (!threadId) {
        setErrorText("线程尚未初始化，请稍后再试。");
        return;
      }

      const token = settings.jwtToken.trim();
      const resolvedTenantId = settings.tenantId.trim();
      const resolvedUserId = settings.userId.trim();
      if (!token && (!resolvedTenantId || !resolvedUserId)) {
        setErrorText("请在设置中配置身份认证。");
        setSettingsOpen(true);
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
          if (!current || current.id !== terminalId) return current;
          return { ...current, stdout: current.stdout ? `${current.stdout}\n${line}` : line };
        });
      };

      const finalizeTerminal = (params: { exitCode: number; stderr?: string; traceId?: string }) => {
        if (terminalFinalized) return;
        terminalFinalized = true;
        const durationMs = Date.now() - requestStartedAt;
        setActiveTerminal((current) => {
          if (!current || current.id !== terminalId) return current;
          const completedSession: TerminalSession = {
            ...current,
            exitCode: params.exitCode,
            stderr: params.stderr,
            traceId: params.traceId ?? current.traceId,
            durationMs,
          };
          setTerminalHistory((history) => {
            const filtered = history.filter((s) => s.id !== completedSession.id);
            return [completedSession, ...filtered].slice(0, 6);
          });
          return null;
        });
      };

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: messageText },
        { id: assistantMessageId, role: "assistant", content: "" },
      ]);

      setInput("");
      setErrorText(null);
      setIsSending(true);
      setCurrentStreamingId(assistantMessageId);
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
        const headers = new Headers({ "content-type": "application/json" });

        if (token) {
          headers.set("authorization", `Bearer ${token}`);
          appendTerminalLine("[auth] bearer token");
        } else {
          headers.set("x-tenant-id", resolvedTenantId);
          headers.set("x-user-id", resolvedUserId);
          appendTerminalLine(`[auth] header mode tenant=${resolvedTenantId} user=${resolvedUserId}`);
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ threadId, message: messageText }),
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

        let streamTraceId: string | undefined;

        await consumeSseStream(response.body, (event, payload) => {
          if (event === "meta") {
            const nextTraceId =
              typeof payload.traceId === "string" && payload.traceId.trim()
                ? payload.traceId
                : undefined;
            if (nextTraceId) {
              streamTraceId = nextTraceId;
              setActiveTerminal((current) => {
                if (!current || current.id !== terminalId) return current;
                return { ...current, traceId: nextTraceId };
              });
              appendTerminalLine(`[meta] traceId=${nextTraceId}`);
              updateAssistantMessage(assistantMessageId, (msg) => ({
                ...msg,
                traceId: nextTraceId,
              }));
            }
            return;
          }

          if (event === "token") {
            tokenChunkCount += 1;
            const tokenText = typeof payload.text === "string" ? payload.text : "";
            if (tokenText) {
              updateAssistantMessage(assistantMessageId, (msg) => ({
                ...msg,
                content: msg.content + tokenText,
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
            const parsedAction: ActionDonePayload | null = parseActionDonePayload(payload.action);

            const thinking: ThinkingData = {
              retrievedCount: doneRetrievedCount,
              persistedCount: donePersistedCount,
              action: parsedAction,
              degraded,
              traceId: doneTraceId ?? streamTraceId,
            };

            updateAssistantMessage(assistantMessageId, (msg) => ({
              ...msg,
              traceId: doneTraceId ?? streamTraceId ?? msg.traceId,
              thinking,
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
            }
            finalizeTerminal({ exitCode: 0, traceId: doneTraceId });
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "请求失败，请检查网络或服务配置。";

        if (controller.signal.aborted) {
          setErrorText("本轮生成已停止。");
          appendTerminalLine("[abort] generation cancelled by user");
          updateAssistantMessage(assistantMessageId, (msg) => ({
            ...msg,
            content: msg.content || "（已手动停止本轮生成）",
          }));
          finalizeTerminal({ exitCode: 130, stderr: "aborted by user" });
        } else {
          setErrorText(message);
          appendTerminalLine(`[error] ${message}`);
          updateAssistantMessage(assistantMessageId, (msg) => ({
            ...msg,
            content: msg.content || `请求失败：${message}`,
          }));
          finalizeTerminal({ exitCode: 1, stderr: message });
        }

      } finally {
        abortRef.current = null;
        if (!terminalFinalized) {
          appendTerminalLine("[finalize] stream closed");
          finalizeTerminal({ exitCode: 0 });
        }
        setIsSending(false);
        setCurrentStreamingId(null);
      }
    },
    [isSending, settings, threadId, updateAssistantMessage],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void sendMessage(input);
    },
    [input, sendMessage],
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSuggestionClick = useCallback(
    (prompt: string) => {
      if (isSending) return;
      setInput(prompt);
      void sendMessage(prompt);
    },
    [isSending, sendMessage],
  );

  const composerDisabled = isSending || input.trim().length === 0;
  const showWelcome = messages.length === 0;

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [input, syncTextareaHeight]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    [],
  );

  const totalPersistedCount = useMemo(() => {
    let count = 0;
    for (const msg of messages) {
      if (typeof msg.thinking?.persistedCount === "number") {
        count += msg.thinking.persistedCount;
      }
    }
    return count;
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg overflow-hidden">
            <img src="/logo.jpg" alt="Eywa Logo" className="size-full object-cover" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Eywa</h1>
            {totalPersistedCount > 0 && (
              <p className="text-[11px] text-muted-foreground leading-tight">
                已保存 {totalPersistedCount} 条记忆
              </p>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="size-9 p-0"
        >
          <Settings className="size-4" />
        </Button>
      </header>

      <div ref={messagePanelRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
          {showWelcome ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
              <div className="mb-2 flex size-14 items-center justify-center rounded-2xl overflow-hidden bg-muted">
                <img src="/logo.jpg" alt="Eywa Logo" className="size-full object-cover" />
              </div>
              <h2 className="mb-1 text-xl font-semibold">你好，我是 Eywa</h2>
              <p className="mb-8 text-center text-sm text-muted-foreground max-w-sm">
                我能记住你的偏好，帮你拆解任务、调用工具。
                试试下面的快捷提问，或直接输入你的问题。
              </p>

              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSuggestionClick(s.prompt)}
                    disabled={isSending}
                    className="rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20 disabled:opacity-50"
                  >
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block mt-0.5 text-xs text-muted-foreground">{s.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const isCurrentlyStreaming = msg.id === currentStreamingId;
                const hasContent = msg.content.trim().length > 0;

                if (isUser) {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                }

                const actionCard =
                  msg.thinking?.action && msg.thinking.action.plannedAction !== "chat"
                    ? renderActionSurfaceCard({
                        action: msg.thinking.action,
                        scope: `msg-${msg.id}`,
                        userId: settings.userId,
                      })
                    : null;

                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="max-w-[85%] min-w-0 rounded-2xl bg-muted px-4 py-3 text-foreground">
                      <ThinkingBlock
                        isActive={isCurrentlyStreaming && !hasContent}
                        data={msg.thinking}
                      />

                      {hasContent ? (
                        <MarkdownContent content={msg.content} />
                      ) : isCurrentlyStreaming ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>正在生成...</span>
                        </div>
                      ) : null}

                      {actionCard && (
                        <div className="mt-2">
                          {actionCard}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {errorText && (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorText}
          </div>
        </div>
      )}

      <div className="border-t bg-background">
        <div className="mx-auto max-w-2xl px-4 py-3 sm:px-6">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
                rows={1}
                className="w-full resize-none rounded-xl border border-input bg-background text-foreground px-4 py-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground/60"
                style={{ maxHeight: "200px" }}
              />
            </div>

            {isSending ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={handleAbort}
                className="size-11 shrink-0 rounded-xl"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={composerDisabled}
                className="size-11 shrink-0 rounded-xl"
              >
                <SendHorizontal className="size-4" />
              </Button>
            )}
          </form>

          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            记忆功能始终开启，对话内容将自动沉淀为长期记忆。
          </p>
        </div>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={setSettings}
        threadId={threadId}
        onNewThread={refreshThread}
        activeTerminal={activeTerminal}
        terminalHistory={terminalHistory}
        onClearTerminalHistory={handleClearTerminalHistory}
      />
    </div>
  );
}
