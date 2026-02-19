import { NextResponse } from "next/server";
import { mcpAdapter } from "@/lib/mcp";
import { skillRegistry } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    mcpTools: mcpAdapter.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      timeoutMs: tool.timeoutMs ?? 10_000,
      retryable: tool.retryable ?? false,
    })),
    skills: skillRegistry.list().map((skill) => ({
      name: skill.name,
      description: skill.description,
    })),
  });
}
