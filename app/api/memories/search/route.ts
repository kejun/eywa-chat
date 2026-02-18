import { NextResponse } from "next/server";
import { memoryRepository, MemoryTypeSchema } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");
  const userId = searchParams.get("userId");
  const queryText = searchParams.get("queryText");
  const threadId = searchParams.get("threadId") ?? undefined;
  const nResults = Number(searchParams.get("nResults") ?? 8);
  const rawMemoryTypes = searchParams.getAll("memoryType");

  if (!tenantId || !userId || !queryText) {
    return NextResponse.json(
      {
        error: "tenantId, userId, and queryText are required",
      },
      { status: 400 },
    );
  }

  const memoryTypes = rawMemoryTypes.length
    ? rawMemoryTypes.map((memoryType) => MemoryTypeSchema.safeParse(memoryType))
    : [];

  const invalid = memoryTypes.filter((item) => !item.success);
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        error: "Invalid memoryType",
        issues: invalid.flatMap((item) => (item.success ? [] : item.error.issues)),
      },
      { status: 400 },
    );
  }

  const entries = await memoryRepository.retrieveMemories({
    tenantId,
    userId,
    queryText,
    threadId,
    memoryTypes: memoryTypes
      .filter((item): item is Extract<typeof item, { success: true }> => item.success)
      .map((item) => item.data),
    nResults: Number.isFinite(nResults) ? Math.max(1, nResults) : 8,
  });

  return NextResponse.json({ memories: entries });
}
