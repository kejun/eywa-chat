import { NextResponse } from "next/server";
import { z } from "zod";
import { memoryRepository, MemoryTypeSchema } from "@/lib/memory";
import { recordMetric } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpsertPayloadSchema = z.object({
  memories: z
    .array(
      z.object({
        tenantId: z.string().min(1),
        userId: z.string().min(1),
        threadId: z.string().min(1).optional(),
        memoryType: MemoryTypeSchema,
        key: z.string().min(1),
        content: z.string().min(1),
        importance: z.number().int().min(1).max(5).optional(),
        sourceMessageId: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        expiresAt: z.number().int().positive().nullable().optional(),
        sourceType: z.enum(["chat", "mcp", "skill"]).optional(),
        sourceName: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        actionTraceId: z.string().optional(),
      }),
    )
    .min(1),
});

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const userId = searchParams.get("userId");

  if (!tenantId || !userId) {
    return NextResponse.json(
      { error: "tenantId and userId are required" },
      { status: 400 },
    );
  }

  const memoryType = searchParams.get("memoryType");
  const limit = Number(searchParams.get("limit") ?? 20);
  const offset = Number(searchParams.get("offset") ?? 0);

  let parsedMemoryType: z.infer<typeof MemoryTypeSchema> | undefined;
  if (memoryType) {
    const result = MemoryTypeSchema.safeParse(memoryType);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid memoryType", issues: result.error.issues },
        { status: 400 },
      );
    }
    parsedMemoryType = result.data;
  }

  const memories = await memoryRepository.listMemories({
    tenantId,
    userId,
    memoryType: parsedMemoryType,
    limit: Number.isFinite(limit) ? Math.max(1, limit) : 20,
    offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
  });

  recordMetric({
    name: "memory.list.duration",
    value: Date.now() - startedAt,
    unit: "ms",
  });
  recordMetric({
    name: "memory.list.count",
    value: memories.length,
    unit: "count",
  });

  return NextResponse.json({ memories });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const payload = await request.json();
  const parsed = UpsertPayloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid payload",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const result = await memoryRepository.upsertMemories(parsed.data.memories);
  recordMetric({
    name: "memory.upsert.duration",
    value: Date.now() - startedAt,
    unit: "ms",
  });
  recordMetric({
    name: "memory.upsert.count",
    value: result.length,
    unit: "count",
  });
  return NextResponse.json({ upserted: result.length, result });
}
