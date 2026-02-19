import { env } from "@/lib/env";
import { resolveJwtIdentityFromHeaders } from "@/lib/auth/jwt";

export type RequestIdentity = {
  tenantId: string;
  userId: string;
  traceId: string;
  source: "jwt" | "headers";
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

function readTraceId(request: Request): string {
  return request.headers.get("x-trace-id") ?? crypto.randomUUID();
}

export async function resolveRequestIdentity(request: Request): Promise<RequestIdentityResult> {
  const traceId = readTraceId(request);
  const jwtIdentity = await resolveJwtIdentityFromHeaders(request.headers);

  if (jwtIdentity) {
    return {
      ok: true,
      identity: {
        tenantId: jwtIdentity.tenantId,
        userId: jwtIdentity.userId,
        traceId,
        source: "jwt",
      },
    };
  }

  // Local-only escape hatch; never enable in production.
  if (env.ALLOW_INSECURE_CONTEXT === "1") {
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
  }

  return {
    ok: false,
    traceId,
    status: 401,
    error: "Unauthorized request. Provide a valid JWT bearer token.",
  };
}

export function resolveTraceId(request: Request): string {
  return readTraceId(request);
}
