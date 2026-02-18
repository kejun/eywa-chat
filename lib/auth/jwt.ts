import { jwtVerify, type JWTPayload } from "jose";

export type JwtIdentity = {
  tenantId: string;
  userId: string;
  payload: JWTPayload;
};

const encoder = new TextEncoder();

function readStringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) {
    return value[0];
  }
  return null;
}

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token) {
    return null;
  }

  if (!/^Bearer$/i.test(scheme)) {
    return null;
  }

  return token.trim();
}

export async function verifyJwtToken(token: string): Promise<JwtIdentity | null> {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret));
    const tenantClaim = process.env.AUTH_TENANT_CLAIM ?? "tenantId";
    const userClaim = process.env.AUTH_USER_CLAIM ?? "sub";

    const tenantId = readStringClaim(payload, tenantClaim);
    const userId = readStringClaim(payload, userClaim);

    if (!tenantId || !userId) {
      return null;
    }

    return {
      tenantId,
      userId,
      payload,
    };
  } catch {
    return null;
  }
}

export async function resolveJwtIdentityFromHeaders(
  headers: Pick<Headers, "get">,
): Promise<JwtIdentity | null> {
  const token = extractBearerToken(headers.get("authorization"));
  if (!token) {
    return null;
  }
  return verifyJwtToken(token);
}
