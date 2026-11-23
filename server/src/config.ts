import dotenv from "dotenv";
import path from "node:path";
const root = path.resolve(__dirname, "../..");
dotenv.config({
  path: path.join(root, ".env"),
  quiet: true,
} as dotenv.DotenvConfigOptions);
const clampInt = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const config = {
  crmAllowedOrigins: process.env.CRM_ALLOWED_ORIGINS ?? "",
  crmAllowLocal: process.env.CRM_ALLOW_LOCAL === "true",
  inquiryTrustedProxy: process.env.INQUIRY_TRUSTED_PROXY ?? "",
  aiAllowedHosts: process.env.AI_ALLOWED_HOSTS ?? "",
  workerFastConcurrency: clampInt(process.env.WORKER_FAST_CONCURRENCY, 2, 1, 8),
  workerHeavyConcurrency: clampInt(process.env.WORKER_HEAVY_CONCURRENCY, 2, 1, 8),
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5001),
  mongo:
    process.env.MONGODB_URI ??
    "mongodb://127.0.0.1:27017/globalsite?directConnection=true",
  origin: process.env.PUBLIC_URL ?? "http://localhost:5173",
  storage: path.resolve(root, process.env.STORAGE_ROOT ?? "storage"),
  storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "auto",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  s3Prefix: (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
  encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  mailFrom: process.env.SMTP_FROM ?? "GlobalSite <noreply@example.invalid>",
};
