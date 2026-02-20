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
  Fingerprint,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionDonePayload } from "@/components/chat/action-surface-registry";

export type ThinkingData = {
  retrievedCount?: number;
  persistedCount?: number;
  action?: ActionDonePayload | null;
  degraded?: boolean;
  traceId?: string;
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
          ? `已召回 ${data.retrievedCount} 条记忆`
          : "未找到相关记忆",
      status: data.retrievedCount > 0 ? "success" : "info",
    });
  }

  if (data.action && data.action.plannedAction !== "chat") {
    const actionType = data.action.plannedAction === "skill" ? "技能" : "MCP 工具";
    const name = data.action.executorName ?? "未知";

    if (data.action.error) {
      steps.push({
        icon: <Wrench className="size-3.5" />,
        label: `${actionType}：${name}`,
        detail: data.action.error,
        status: "warning",
      });
    } else {
      steps.push({
        icon: <Wrench className="size-3.5" />,
        label: `${actionType}：${name}`,
        detail: data.action.summary,
        status: "success",
      });
    }

    if (data.action.output && Object.keys(data.action.output).length > 0) {
      steps.push({
        icon: <CheckCircle2 className="size-3.5" />,
        label: "动作执行完成",
        detail: JSON.stringify(data.action.output, null, 2).slice(0, 300),
        status: data.action.error ? "warning" : "success",
      });
    }

    if (typeof data.action.memoryCandidateCount === "number" && data.action.memoryCandidateCount > 0) {
      steps.push({
        icon: <Database className="size-3.5" />,
        label: `动作产生 ${data.action.memoryCandidateCount} 条候选记忆`,
        status: "info",
      });
    }
  }

  if (typeof data.persistedCount === "number" && data.persistedCount > 0) {
    steps.push({
      icon: <Database className="size-3.5" />,
      label: `已保存 ${data.persistedCount} 条新记忆`,
      status: "success",
    });
  }

  if (data.degraded) {
    steps.push({
      icon: <AlertTriangle className="size-3.5" />,
      label: "回复已降级",
      detail: "模型遇到异常，本轮回复可能不完整。",
      status: "warning",
    });
  }

  if (data.traceId) {
    steps.push({
      icon: <Fingerprint className="size-3.5" />,
      label: `trace: ${data.traceId}`,
      status: "info",
    });
  }

  return steps;
}

function buildSummaryText(data: ThinkingData): string {
  const parts: string[] = [];

  if (typeof data.retrievedCount === "number" && data.retrievedCount > 0) {
    parts.push(`${data.retrievedCount} 条记忆`);
  }

  if (data.action && data.action.plannedAction !== "chat") {
    const actionType = data.action.plannedAction === "skill" ? "技能" : "MCP";
    const name = data.action.executorName ?? data.action.plannedAction;
    if (data.action.error) {
      parts.push(`${actionType}：${name}（失败）`);
    } else {
      parts.push(`${actionType}：${name}`);
    }
  }

  if (typeof data.persistedCount === "number" && data.persistedCount > 0) {
    parts.push(`保存 ${data.persistedCount} 条`);
  }

  if (data.degraded) {
    parts.push("降级");
  }

  if (parts.length === 0) {
    return "已处理";
  }

  return parts.join(" · ");
}

function StepStatusIcon({ status }: { status: ThinkingStep["status"] }) {
  if (status === "success") return <CheckCircle2 className="size-3 text-emerald-600" />;
  if (status === "warning") return <XCircle className="size-3 text-amber-600" />;
  return null;
}

export function ThinkingBlock({ isActive, data }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (isActive) {
    return (
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>思考中...</span>
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
        <div className="mt-1.5 ml-2 space-y-1.5 border-l-2 border-muted pl-3">
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      step.status === "warning"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-foreground/80",
                    )}
                  >
                    {step.label}
                  </span>
                  <StepStatusIcon status={step.status} />
                </div>
                {step.detail && (
                  <p className="mt-0.5 text-muted-foreground leading-relaxed whitespace-pre-wrap break-all">
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
