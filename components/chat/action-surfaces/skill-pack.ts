import type { ActionSurfaceResolverPack } from "@/components/chat/action-surfaces/types";
import type { ActionSurfaceResolver } from "@/components/chat/action-surface-registry";
import { readStringField } from "@/components/chat/action-surfaces/shared";

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

export const skillActionSurfacePack: ActionSurfaceResolverPack = {
  name: "skills-default-pack",
  resolvers: [
    {
      executorName: "save_preference",
      resolver: savePreferenceResolver,
    },
    {
      executorName: "capture_task",
      resolver: captureTaskResolver,
    },
  ],
};
