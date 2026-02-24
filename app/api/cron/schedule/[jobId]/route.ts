import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runScheduledJob } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const result = await runScheduledJob(jobId);
  let status = 500;
  if (result.ok === true) {
    status = 200;
  } else if (typeof result.error === "string" && result.error.startsWith("Unknown scheduled job")) {
    status = 404;
  }
  return NextResponse.json(result, { status });
}
