import { z } from "zod";
import type { SkillContext, SkillDefinition, SkillResult } from "@/lib/skills/types";

type AnySkillDefinition = SkillDefinition<z.ZodTypeAny>;

function buildPreferenceSkill() {
  const inputSchema = z.object({
    preference: z.string().min(1),
  });

  const skill: SkillDefinition<typeof inputSchema> = {
    name: "save_preference",
    description: "抽取并固化用户偏好",
    inputSchema,
    match: (message: string) => {
      const matched = /记住|偏好|喜欢|习惯/.test(message);
      if (!matched) {
        return null;
      }

      const normalized = message.replace(/^.*?(记住|偏好是|喜欢)/, "").trim();
      return {
        score: 0.8,
        args: {
          preference: normalized || message.trim(),
        },
      };
    },
    run: async (context: SkillContext, args: z.infer<typeof inputSchema>): Promise<SkillResult> => {
      return {
        status: "success",
        summary: `已记录你的偏好：${args.preference}`,
        output: {
          preference: args.preference,
        },
        memoryCandidates: [
          {
            tenantId: context.tenantId,
            userId: context.userId,
            threadId: context.threadId,
            memoryType: "preference",
            key: `skill_preference_${args.preference.slice(0, 24)}`,
            content: args.preference,
            importance: 4,
            sourceMessageId: context.traceId,
            tags: ["skill", "preference"],
            sourceType: "skill",
            sourceName: "save_preference",
            confidence: 0.85,
            actionTraceId: context.traceId,
          },
        ],
      };
    },
  };

  return skill;
}

function buildTaskCaptureSkill() {
  const inputSchema = z.object({
    task: z.string().min(1),
  });

  const skill: SkillDefinition<typeof inputSchema> = {
    name: "capture_task",
    description: "识别并记录待办任务",
    inputSchema,
    match: (message: string) => {
      const matched = /待办|任务|提醒我|todo/i.test(message);
      if (!matched) {
        return null;
      }

      return {
        score: 0.7,
        args: {
          task: message.trim(),
        },
      };
    },
    run: async (context: SkillContext, args: z.infer<typeof inputSchema>): Promise<SkillResult> => {
      return {
        status: "success",
        summary: `已记录任务：${args.task}`,
        output: {
          task: args.task,
        },
        memoryCandidates: [
          {
            tenantId: context.tenantId,
            userId: context.userId,
            threadId: context.threadId,
            memoryType: "task",
            key: `skill_task_${args.task.slice(0, 24)}`,
            content: args.task,
            importance: 4,
            sourceMessageId: context.traceId,
            tags: ["skill", "task"],
            sourceType: "skill",
            sourceName: "capture_task",
            confidence: 0.8,
            actionTraceId: context.traceId,
          },
        ],
      };
    },
  };

  return skill;
}

export class SkillRegistry {
  private readonly skills = new Map<string, AnySkillDefinition>();

  register<TSchema extends z.ZodTypeAny>(skill: SkillDefinition<TSchema>) {
    this.skills.set(skill.name, skill as AnySkillDefinition);
  }

  list() {
    return Array.from(this.skills.values());
  }

  get(name: string) {
    return this.skills.get(name);
  }

  match(message: string): { skill: AnySkillDefinition; args: unknown } | null {
    let best: { skill: AnySkillDefinition; score: number; args: unknown } | null = null;

    for (const skill of this.skills.values()) {
      const matched = skill.match(message);
      if (!matched) {
        continue;
      }
      if (!best || matched.score > best.score) {
        best = {
          skill,
          score: matched.score,
          args: matched.args,
        };
      }
    }

    if (!best) {
      return null;
    }

    return {
      skill: best.skill,
      args: best.args,
    };
  }
}

const registry = new SkillRegistry();
registry.register(buildPreferenceSkill());
registry.register(buildTaskCaptureSkill());

export const skillRegistry = registry;
