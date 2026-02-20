"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, ShieldCheck, Brain, Info, RotateCcw, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Terminal } from "@/components/tool-ui/terminal";
import { cn } from "@/lib/utils";
import type { TerminalSession } from "@/components/chat/types";

export type SettingsValues = {
  jwtToken: string;
  tenantId: string;
  userId: string;
};

type SettingsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsValues;
  onSettingsChange: (settings: SettingsValues) => void;
  threadId: string;
  onNewThread: () => void;
  activeTerminal: TerminalSession | null;
  terminalHistory: TerminalSession[];
  onClearTerminalHistory: () => void;
};

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {icon}
      {children}
    </h3>
  );
}

export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  threadId,
  onNewThread,
  activeTerminal,
  terminalHistory,
  onClearTerminalHistory,
}: SettingsDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose]);

  const updateField = useCallback(
    (field: keyof SettingsValues, value: string) => {
      onSettingsChange({ ...settings, [field]: value });
    },
    [settings, onSettingsChange],
  );

  const jwtMode = settings.jwtToken.trim().length > 0;
  const hasTerminalData = activeTerminal !== null || terminalHistory.length > 0;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] transition-opacity"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      <div
        ref={drawerRef}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-background border-l shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">设置</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="size-8 p-0"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          <section className="space-y-3">
            <SectionTitle icon={<ShieldCheck className="size-4 text-muted-foreground" />}>
              鉴权配置
            </SectionTitle>
            <p className="text-xs text-muted-foreground leading-relaxed">
              当前模式：{jwtMode
                ? "JWT 安全模式"
                : "Header 本地模式（需 ALLOW_INSECURE_CONTEXT=1）"}
            </p>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                JWT Bearer Token（优先）
              </span>
              <textarea
                className="min-h-20 resize-y rounded-lg border border-input bg-background text-foreground px-3 py-2 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground/60"
                placeholder="粘贴 JWT；有值时将自动使用 Authorization 头"
                value={settings.jwtToken}
                onChange={(e) => updateField("jwtToken", e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  tenantId（本地模式）
                </span>
                <input
                  className="rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={settings.tenantId}
                  onChange={(e) => updateField("tenantId", e.target.value)}
                  disabled={jwtMode}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  userId（本地模式）
                </span>
                <input
                  className="rounded-lg border border-input bg-background text-foreground px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={settings.userId}
                  onChange={(e) => updateField("userId", e.target.value)}
                  disabled={jwtMode}
                />
              </label>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <SectionTitle icon={<Brain className="size-4 text-muted-foreground" />}>
              记忆
            </SectionTitle>
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">始终开启</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                你的偏好、事实与对话历史会自动跨会话记住。
                每次对话都会透明地进行记忆检索与沉淀。
              </p>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <SectionTitle icon={<Info className="size-4 text-muted-foreground" />}>
              会话线程
            </SectionTitle>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <code className="text-xs text-muted-foreground font-mono truncate max-w-[240px]">
                  {threadId || "初始化中..."}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNewThread}
                  className="h-7 gap-1.5 text-xs"
                >
                  <RotateCcw className="size-3" />
                  新线程
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                每个线程是一个独立的对话上下文。开始新线程会清空当前对话，
                但你的长期记忆会保留。
              </p>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionTitle icon={<TerminalSquare className="size-4 text-muted-foreground" />}>
                请求诊断
              </SectionTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearTerminalHistory}
                disabled={!hasTerminalData}
                className="h-7 text-xs"
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
          </section>
        </div>

        <div className="border-t px-6 py-3">
          <p className="text-[11px] text-muted-foreground text-center">
            Eywa Chat v1.0
          </p>
        </div>
      </div>
    </>
  );
}
