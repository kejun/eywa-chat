import { registerActionSurfaceResolver } from "@/components/chat/action-surface-registry";
import { defaultActionSurfaceResolverPacks } from "@/components/chat/action-surfaces";
import type { ActionSurfaceResolverPack } from "@/components/chat/action-surfaces/types";

function registerResolverPack(pack: ActionSurfaceResolverPack) {
  for (const entry of pack.resolvers) {
    registerActionSurfaceResolver(entry.executorName, entry.resolver);
  }
}

let isBootstrapped = false;
const customResolverPacks: ActionSurfaceResolverPack[] = [];

export function registerActionSurfaceResolverPack(pack: ActionSurfaceResolverPack) {
  customResolverPacks.push(pack);
  if (isBootstrapped) {
    registerResolverPack(pack);
  }
}

export function ensureActionSurfaceResolversBootstrapped() {
  if (isBootstrapped) {
    return;
  }

  for (const pack of defaultActionSurfaceResolverPacks) {
    registerResolverPack(pack);
  }
  for (const pack of customResolverPacks) {
    registerResolverPack(pack);
  }
  isBootstrapped = true;
}
