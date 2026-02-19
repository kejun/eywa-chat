import type { ActionSurfaceResolverPack } from "@/components/chat/action-surfaces/types";
import { skillActionSurfacePack } from "@/components/chat/action-surfaces/skill-pack";
import { mcpActionSurfacePack } from "@/components/chat/action-surfaces/mcp-pack";

export const defaultActionSurfaceResolverPacks: ActionSurfaceResolverPack[] = [
  skillActionSurfacePack,
  mcpActionSurfacePack,
];
