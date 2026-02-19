import { z } from "zod";

const EnvSchema = z
  .object({
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
    ALLOW_INSECURE_CONTEXT: z.enum(["0", "1"]).default("0"),
    AUTH_JWT_SECRET: z.string().optional(),
    AUTH_TENANT_CLAIM: z.string().default("tenantId"),
    AUTH_USER_CLAIM: z.string().default("sub"),
    CRON_SECRET: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ALLOW_INSECURE_CONTEXT === "0" && !data.AUTH_JWT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_JWT_SECRET"],
        message:
          "AUTH_JWT_SECRET is required when ALLOW_INSECURE_CONTEXT=0 (secure mode).",
      });
    }
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;
