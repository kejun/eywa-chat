import type { ActionSurfaceResolver } from "@/components/chat/action-surface-registry";

export type ActionSurfaceResolverRegistration = {
  executorName: string;
  resolver: ActionSurfaceResolver;
};

export type ActionSurfaceResolverPack = {
  name: string;
  resolvers: ActionSurfaceResolverRegistration[];
};
