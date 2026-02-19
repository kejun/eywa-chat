import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headerStore = await headers();
  const traceId = headerStore.get("x-trace-id") ?? "missing-trace-id";

  logger.info("health-check", {
    traceId,
    nodeEnv: env.NODE_ENV,
  });

  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      traceId,
    },
    {
      headers: {
        "x-trace-id": traceId,
      },
    },
  );
}
