import { env } from "@/lib/env";

export function isCronAuthorized(request: Request): boolean {
  if (!env.CRON_SECRET) {
    return true;
  }

  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");

  return authHeader === `Bearer ${env.CRON_SECRET}` || secretHeader === env.CRON_SECRET;
}
