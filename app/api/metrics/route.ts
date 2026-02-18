import { NextResponse } from "next/server";
import { clearMetrics, getMetricsSnapshot } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    points: getMetricsSnapshot(),
  });
}

export async function DELETE() {
  clearMetrics();
  return NextResponse.json({
    ok: true,
  });
}
