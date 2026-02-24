import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { listScheduledJobs } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    jobs: listScheduledJobs(),
  });
}
