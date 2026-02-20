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
  Sparkles,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type ActionDonePayload,
  parseActionDonePayload,
} from "@/components/chat/action-surface-registry";
import { ensureActionSurfaceResolversBootstrapped } from "@/components/chat/action-surface-bootstrap";
import { ThinkingBlock, type ThinkingData } from "@/components/chat/thinking-block";
import {
  SettingsDrawer,
  type SettingsValues,
} from "@/components/chat/settings-drawer";

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
    id: "remember-prefs",
    label: "Remember my preferences",
    prompt: "Please remember: reply in Chinese by default, give conclusions first then steps, keep it concise.",
  },
  {
    id: "task-breakdown",
    label: "Break down a task",
    prompt: "I want to launch a chatbot with persistent memory in two weeks. Please create a day-by-day execution plan.",
  },
  {
    id: "recall-memory",
    label: "What do you remember about me?",
    prompt: "Please summarize what you already remember about my preferences and long-term information, and mark any uncertain items.",
  },
  {
    id: "trigger-action",
    label: "Plan a trip to Shanghai",
    prompt: "I want to arrange a business trip to Shanghai. Please give me an execution plan first, then list the tools you would use.",
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
    window.localStorage.setItem(THREAD_STORAGE_KEY, nextId);
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
        setErrorText("Thread not initialized yet.");
        return;
      }

      const token = settings.jwtToken.trim();
      const resolvedTenantId = settings.tenantId.trim();
      const resolvedUserId = settings.userId.trim();
      if (!token && (!resolvedTenantId || !resolvedUserId)) {
        setErrorText("Please configure authentication in Settings.");
        setSettingsOpen(true);
        return;
      }

      const userMessageId = createMessageId("user");
      const assistantMessageId = createMessageId("assistant");

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: messageText },
        { id: assistantMessageId, role: "assistant", content: "" },
      ]);

      setInput("");
      setErrorText(null);
      setIsSending(true);
      setCurrentStreamingId(assistantMessageId);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers = new Headers({ "content-type": "application/json" });

        if (token) {
          headers.set("authorization", `Bearer ${token}`);
        } else {
          headers.set("x-tenant-id", resolvedTenantId);
          headers.set("x-user-id", resolvedUserId);
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({ threadId, message: messageText }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const bodyText = await response.text();
          let message = `Request failed (${response.status})`;
          try {
            const parsed = JSON.parse(bodyText) as { error?: string };
            if (parsed.error) {
              message = `${parsed.error} (${response.status})`;
            }
          } catch {
            if (bodyText.trim()) {
              message = `${message}: ${bodyText.trim()}`;
            }
          }
          throw new Error(message);
        }

        if (!response.body) {
          throw new Error("Empty response stream.");
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
              updateAssistantMessage(assistantMessageId, (msg) => ({
                ...msg,
                traceId: nextTraceId,
              }));
            }
            return;
          }

          if (event === "token") {
            const tokenText = typeof payload.text === "string" ? payload.text : "";
            if (tokenText) {
              updateAssistantMessage(assistantMessageId, (msg) => ({
                ...msg,
                content: msg.content + tokenText,
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
            const parsedAction: ActionDonePayload | null = parseActionDonePayload(payload.action);

            const thinking: ThinkingData = {
              retrievedCount: doneRetrievedCount,
              persistedCount: donePersistedCount,
              action: parsedAction,
              degraded,
            };

            updateAssistantMessage(assistantMessageId, (msg) => ({
              ...msg,
              traceId: doneTraceId ?? streamTraceId ?? msg.traceId,
              thinking,
            }));

            if (degraded) {
              setErrorText("Model degraded. The response may be incomplete.");
            }
          }
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Request failed. Please check your settings.";

        if (controller.signal.aborted) {
          setErrorText("Generation stopped.");
          updateAssistantMessage(assistantMessageId, (msg) => ({
            ...msg,
            content: msg.content || "(Generation stopped by user)",
          }));
        } else {
          setErrorText(message);
          updateAssistantMessage(assistantMessageId, (msg) => ({
            ...msg,
            content: msg.content || `Error: ${message}`,
          }));
        }

      } finally {
        abortRef.current = null;
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

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      autoResizeTextarea();
    },
    [autoResizeTextarea],
  );

  const memoryStats = useMemo(() => {
    let totalRetrieved = 0;
    let totalPersisted = 0;
    for (const msg of messages) {
      if (msg.thinking) {
        if (typeof msg.thinking.retrievedCount === "number") {
          totalRetrieved += msg.thinking.retrievedCount;
        }
        if (typeof msg.thinking.persistedCount === "number") {
          totalPersisted += msg.thinking.persistedCount;
        }
      }
    }
    return { totalRetrieved, totalPersisted };
  }, [messages]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <Sparkles className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Eywa</h1>
            {memoryStats.totalPersisted > 0 && (
              <p className="text-[11px] text-muted-foreground leading-tight">
                {memoryStats.totalPersisted} memories saved
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
              <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="size-7 text-primary" />
              </div>
              <h2 className="mb-1 text-xl font-semibold">Hi, I&apos;m Eywa</h2>
              <p className="mb-8 text-center text-sm text-muted-foreground max-w-sm">
                I remember your preferences and can help with tasks.
                What would you like to talk about?
              </p>

              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSuggestionClick(s.prompt)}
                    disabled={isSending}
                    className="rounded-xl border bg-card px-4 py-3 text-left text-sm transition-colors hover:bg-accent hover:border-accent-foreground/20 disabled:opacity-50"
                  >
                    {s.label}
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

                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="max-w-[85%] min-w-0">
                      <ThinkingBlock
                        isActive={isCurrentlyStreaming && !hasContent}
                        data={msg.thinking}
                      />

                      {hasContent ? (
                        <div className="text-sm leading-relaxed text-foreground">
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      ) : isCurrentlyStreaming ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          <span>Generating...</span>
                        </div>
                      ) : null}
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
                placeholder="Send a message..."
                rows={1}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 pr-12 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground/60"
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
            Memory is always on. Your conversations help Eywa understand you better.
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
      />
    </div>
  );
}
