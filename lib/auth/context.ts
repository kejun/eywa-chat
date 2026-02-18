import { env } from "@/lib/env";

export type RequestIdentity = {
  tenantId: string;
  userId: string;
  traceId: string;
  source: "headers" | "query";
};

export type RequestIdentityResult =
  | {
      ok: true;
      identity: RequestIdentity;
    }
  | {
      ok: false;
      traceId: string;
      status: number;
      error: string;
    };

type ResolveIdentityOptions = {
  allowQueryFallback?: boolean;
};

function readTraceId(request: Request): string {
  return request.headers.get("x-trace-id") ?? crypto.randomUUID();
}

export function resolveRequestIdentity(
  request: Request,
  options: ResolveIdentityOptions = {},
): RequestIdentityResult {
  const traceId = readTraceId(request);
  const tenantId = request.headers.get("x-tenant-id");
  const userId = request.headers.get("x-user-id");

  if (tenantId && userId) {
    return {
      ok: true,
      identity: {
        tenantId,
        userId,
        traceId,
        source: "headers",
      },
    };
  }

  const allowQueryFallback =
    options.allowQueryFallback === true && env.ALLOW_INSECURE_CONTEXT === "1";

  if (allowQueryFallback) {
    const { searchParams } = new URL(request.url);
    const fallbackTenantId = searchParams.get("tenantId");
    const fallbackUserId = searchParams.get("userId");
    if (fallbackTenantId && fallbackUserId) {
      return {
        ok: true,
        identity: {
          tenantId: fallbackTenantId,
          userId: fallbackUserId,
          traceId,
          source: "query",
        },
      };
    }
  }

  return {
    ok: false,
    traceId,
    status: 401,
    error:
      "Missing identity context. Require x-tenant-id and x-user-id headers (or query fallback only when ALLOW_INSECURE_CONTEXT=1).",
  };
}

export function resolveTraceId(request: Request): string {
  return readTraceId(request);
}
