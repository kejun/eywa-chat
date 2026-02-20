"use client";

import { useState } from "react";
import {
  Brain,
  ChevronRight,
  Database,
  Loader2,
  Search,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionDonePayload } from "@/components/chat/action-surface-registry";

export type ThinkingData = {
  retrievedCount?: number;
  persistedCount?: number;
  action?: ActionDonePayload | null;
  degraded?: boolean;
};

type ThinkingBlockProps = {
  isActive: boolean;
  data?: ThinkingData;
};

type ThinkingStep = {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  status: "success" | "warning" | "info";
};

function buildSteps(data: ThinkingData): ThinkingStep[] {
  const steps: ThinkingStep[] = [];

  if (typeof data.retrievedCount === "number") {
    steps.push({
      icon: <Search className="size-3.5" />,
      label:
        data.retrievedCount > 0
          ? `Recalled ${data.retrievedCount} memories`
          : "No relevant memories found",
      status: data.retrievedCount > 0 ? "success" : "info",
    });
  }

  if (data.action && data.action.plannedAction !== "chat") {
    const actionType = data.action.plannedAction === "skill" ? "Skill" : "MCP Tool";
    const name = data.action.executorName ?? "unknown";

    if (data.action.error) {
      steps.push({
        icon: <Wrench className="size-3.5" />,
        label: `${actionType}: ${name}`,
        detail: data.action.error,
        status: "warning",
      });
    } else {
      steps.push({
        icon: <Wrench className="size-3.5" />,
        label: `${actionType}: ${name}`,
        detail: data.action.summary,
        status: "success",
      });
    }
  }

  if (typeof data.persistedCount === "number" && data.persistedCount > 0) {
    steps.push({
      icon: <Database className="size-3.5" />,
      label: `Saved ${data.persistedCount} new memories`,
      status: "success",
    });
  }

  if (data.degraded) {
    steps.push({
      icon: <AlertTriangle className="size-3.5" />,
      label: "Response degraded",
      detail: "The model encountered issues; this response may be incomplete.",
      status: "warning",
    });
  }

  return steps;
}

function buildSummaryText(data: ThinkingData): string {
  const parts: string[] = [];

  if (typeof data.retrievedCount === "number" && data.retrievedCount > 0) {
    parts.push(`${data.retrievedCount} memories`);
  }

  if (data.action && data.action.plannedAction !== "chat") {
    const name = data.action.executorName ?? data.action.plannedAction;
    parts.push(name);
  }

  if (typeof data.persistedCount === "number" && data.persistedCount > 0) {
    parts.push(`saved ${data.persistedCount}`);
  }

  if (parts.length === 0) {
    return "Processed";
  }

  return parts.join(" · ");
}

export function ThinkingBlock({ isActive, data }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (isActive) {
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>Thinking...</span>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const steps = buildSteps(data);
  if (steps.length === 0) {
    return null;
  }

  const summaryText = buildSummaryText(data);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <Brain className="size-3.5 shrink-0" />
        <span>{summaryText}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-1.5 ml-2 space-y-1 border-l-2 border-muted pl-3">
          {steps.map((step, index) => (
            <div key={index} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-0.5 shrink-0",
                  step.status === "success" && "text-emerald-600",
                  step.status === "warning" && "text-amber-600",
                  step.status === "info" && "text-muted-foreground",
                )}
              >
                {step.icon}
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    step.status === "warning"
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-foreground/80",
                  )}
                >
                  {step.label}
                </span>
                {step.detail && (
                  <p className="mt-0.5 text-muted-foreground leading-relaxed">
                    {step.detail}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
