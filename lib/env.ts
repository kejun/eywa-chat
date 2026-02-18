import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DASHSCOPE_API_KEY: z.string().min(1, "DASHSCOPE_API_KEY is required"),
  DASHSCOPE_MODEL: z.string().min(1).default("qwen-plus"),
  DASHSCOPE_BASE_URL: z
    .string()
    .url()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  SEEKDB_HOST: z.string().min(1, "SEEKDB_HOST is required"),
  SEEKDB_PORT: z.coerce.number().int().positive(),
  SEEKDB_USER: z.string().min(1, "SEEKDB_USER is required"),
  SEEKDB_PASSWORD: z.string().min(1, "SEEKDB_PASSWORD is required"),
  SEEKDB_DATABASE: z.string().min(1, "SEEKDB_DATABASE is required"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
