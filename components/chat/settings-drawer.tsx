"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, ShieldCheck, Brain, Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        aria-label="Settings"
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Settings</h2>
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
              Authentication
            </SectionTitle>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {jwtMode
                ? "Using JWT Bearer Token for secure authentication."
                : "Using header-based local mode (requires ALLOW_INSECURE_CONTEXT=1)."}
            </p>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                JWT Bearer Token
              </span>
              <textarea
                className="min-h-20 resize-y rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-muted-foreground/60"
                placeholder="Paste JWT token here..."
                value={settings.jwtToken}
                onChange={(e) => updateField("jwtToken", e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Tenant ID
                </span>
                <input
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={settings.tenantId}
                  onChange={(e) => updateField("tenantId", e.target.value)}
                  disabled={jwtMode}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  User ID
                </span>
                <input
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
              Memory
            </SectionTitle>
            <div className="rounded-lg bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">Always On</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your preferences, facts, and conversation history are
                automatically remembered across sessions. Memory retrieval and
                persistence happen transparently in every conversation.
              </p>
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="space-y-3">
            <SectionTitle icon={<Info className="size-4 text-muted-foreground" />}>
              Thread
            </SectionTitle>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <code className="text-xs text-muted-foreground font-mono truncate max-w-[240px]">
                  {threadId || "Initializing..."}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNewThread}
                  className="h-7 gap-1.5 text-xs"
                >
                  <RotateCcw className="size-3" />
                  New
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Each thread is an independent conversation context. Starting a
                new thread clears the current conversation but retains your
                long-term memories.
              </p>
            </div>
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
