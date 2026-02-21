import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local from project root
const envPath = path.resolve(__dirname, "..", ".env.local");
dotenv.config({ path: envPath });

const requiredKeys = [
  "DASHSCOPE_API_KEY",
  "SEEKDB_HOST",
  "SEEKDB_PORT",
  "SEEKDB_USER",
  "SEEKDB_PASSWORD",
  "SEEKDB_DATABASE",
];

if (process.env.SKIP_ENV_VALIDATION === "1") {
  process.exit(0);
}

// SEEKDB_PASSWORD can be empty for local/dev setups without authentication
const missingKeys = requiredKeys.filter((key) => {
  if (key === "SEEKDB_PASSWORD") {
    return process.env.SEEKDB_PASSWORD === undefined;
  }
  return !process.env[key];
});

const allowInsecureContext = process.env.ALLOW_INSECURE_CONTEXT === "1";
if (!allowInsecureContext && !process.env.AUTH_JWT_SECRET) {
  missingKeys.push("AUTH_JWT_SECRET");
}

if (missingKeys.length > 0) {
  console.error("Missing required environment variables:");
  for (const key of missingKeys) {
    console.error(`- ${key}`);
  }
  console.error("Set SKIP_ENV_VALIDATION=1 only for local bootstrap if needed.");
  process.exit(1);
}
