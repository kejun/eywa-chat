import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveJwtIdentityFromHeaders } from "@/lib/auth/jwt";

const TRACE_ID_HEADER = "x-trace-id";
const TENANT_HEADER = "x-tenant-id";
const USER_HEADER = "x-user-id";

function isProtectedApiPath(pathname: string): boolean {
  return (
    pathname === "/api/chat" ||
    pathname.startsWith("/api/chat/") ||
    pathname === "/api/memories" ||
    pathname.startsWith("/api/memories/")
  );
}

function unauthorizedResponse(traceId: string): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: "Unauthorized request. Provide a valid JWT bearer token.",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        [TRACE_ID_HEADER]: traceId,
      },
    },
  );
}

export async function middleware(request: NextRequest) {
  const existingTraceId = request.headers.get(TRACE_ID_HEADER);
  const traceId = existingTraceId ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRACE_ID_HEADER, traceId);
  requestHeaders.delete(TENANT_HEADER);
  requestHeaders.delete(USER_HEADER);

  const pathname = request.nextUrl.pathname;
  if (isProtectedApiPath(pathname)) {
    const jwtIdentity = await resolveJwtIdentityFromHeaders(request.headers);
    if (jwtIdentity) {
      requestHeaders.set(TENANT_HEADER, jwtIdentity.tenantId);
      requestHeaders.set(USER_HEADER, jwtIdentity.userId);
    } else if (process.env.ALLOW_INSECURE_CONTEXT === "1") {
      const unsafeTenantId = request.headers.get(TENANT_HEADER);
      const unsafeUserId = request.headers.get(USER_HEADER);
      if (!unsafeTenantId || !unsafeUserId) {
        return unauthorizedResponse(traceId);
      }
      requestHeaders.set(TENANT_HEADER, unsafeTenantId);
      requestHeaders.set(USER_HEADER, unsafeUserId);
    } else {
      return unauthorizedResponse(traceId);
    }
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set(TRACE_ID_HEADER, traceId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
