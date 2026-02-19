#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { SignJWT } from "jose";

function readArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function removeArg(args, name) {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx >= 0) {
    const next = idx + 1;
    if (next < args.length) {
      args.splice(idx, 2);
    } else {
      args.splice(idx, 1);
    }
  }
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

async function generateJwtToken() {
  const secret = readArg("secret", process.env.AUTH_JWT_SECRET ?? "");
  if (!secret) {
    throw new Error("Missing JWT secret. Use --secret or set AUTH_JWT_SECRET.");
  }

  const tenantId = readArg("tenant-id", "t-loadtest");
  const userId = readArg("user-id", "u-loadtest");
  const tenantClaim = readArg("tenant-claim", process.env.AUTH_TENANT_CLAIM ?? "tenantId");
  const userClaim = readArg("user-claim", process.env.AUTH_USER_CLAIM ?? "sub");
  const expiresInSeconds = Number(readArg("expires-in-seconds", "3600"));
  const issuer = readArg("issuer", "eywa-chat-loadtest");
  const audience = readArg("audience", "eywa-chat-api");

  const payload = {
    [tenantClaim]: tenantId,
    ...(userClaim === "sub" ? {} : { [userClaim]: userId }),
  };

  const signer = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(`${Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600}s`);

  if (userClaim === "sub") {
    signer.setSubject(userId);
  }

  const token = await signer.sign(new TextEncoder().encode(secret));
  return {
    token,
    tenantId,
    userId,
  };
}

async function run() {
  const { token, tenantId, userId } = await generateJwtToken();
  const passthroughArgs = process.argv.slice(2);

  // Prevent accidental secret/token leakage into downstream scripts.
  removeArg(passthroughArgs, "secret");
  removeArg(passthroughArgs, "tenant-claim");
  removeArg(passthroughArgs, "user-claim");
  removeArg(passthroughArgs, "issuer");
  removeArg(passthroughArgs, "audience");
  removeArg(passthroughArgs, "expires-in-seconds");

  await runNodeScript("./scripts/loadtest-chat-and-report.mjs", [
    ...passthroughArgs,
    "--tenant-id",
    tenantId,
    "--user-id",
    userId,
    "--jwt-token",
    token,
  ]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
