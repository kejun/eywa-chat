#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { SignJWT } from "jose";

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return fallback;
}

function readNumberArg(name, fallback) {
  const value = Number(readArg(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function readAllArgs(name) {
  const flag = `--${name}`;
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && index + 1 < process.argv.length) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function parseClaimValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && raw.trim() !== "") {
    return asNumber;
  }
  return raw;
}

async function run() {
  const secret = readArg("secret", process.env.AUTH_JWT_SECRET ?? "");
  if (!secret) {
    console.error("Missing JWT secret. Use --secret or set AUTH_JWT_SECRET.");
    process.exit(1);
  }

  const tenantId = readArg("tenant-id", "t-dev");
  const userId = readArg("user-id", "u-dev");
  const tenantClaim = readArg("tenant-claim", process.env.AUTH_TENANT_CLAIM ?? "tenantId");
  const userClaim = readArg("user-claim", process.env.AUTH_USER_CLAIM ?? "sub");
  const expiresInSeconds = readNumberArg("expires-in-seconds", 3600);
  const issuer = readArg("issuer", "eywa-chat-dev");
  const audience = readArg("audience", "eywa-chat-api");
  const outputPath = readArg("out", "");

  const customClaims = {};
  for (const claim of readAllArgs("claim")) {
    const separator = claim.indexOf("=");
    if (separator <= 0) {
      console.error(`Invalid --claim format: ${claim}. Expected key=value`);
      process.exit(1);
    }
    const key = claim.slice(0, separator).trim();
    const rawValue = claim.slice(separator + 1).trim();
    if (!key) {
      console.error(`Invalid --claim key in: ${claim}`);
      process.exit(1);
    }
    customClaims[key] = parseClaimValue(rawValue);
  }

  const payload = {
    ...customClaims,
    [tenantClaim]: tenantId,
    ...(userClaim === "sub" ? {} : { [userClaim]: userId }),
  };

  const signer = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(`${expiresInSeconds}s`);

  if (userClaim === "sub") {
    signer.setSubject(userId);
  }

  const token = await signer.sign(new TextEncoder().encode(secret));

  if (outputPath) {
    await writeFile(outputPath, `${token}\n`, "utf8");
    console.log(`JWT token written to: ${outputPath}`);
  } else {
    console.log(token);
  }

  if (readArg("show-payload", "0") === "1") {
    console.error(
      JSON.stringify(
        {
          tenantClaim,
          userClaim,
          tenantId,
          userId,
          issuer,
          audience,
          expiresInSeconds,
          customClaims,
        },
        null,
        2,
      ),
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
