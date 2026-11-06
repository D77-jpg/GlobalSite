import dotenv from "dotenv";
import path from "node:path";
const root = path.resolve(__dirname, "../..");
dotenv.config({
  path: path.join(root, ".env"),
  quiet: true,
} as dotenv.DotenvConfigOptions);
export const config = {
  crmAllowedOrigins: process.env.CRM_ALLOWED_ORIGINS ?? "",
  crmAllowLocal: process.env.CRM_ALLOW_LOCAL === "true",
  inquiryTrustedProxy: process.env.INQUIRY_TRUSTED_PROXY ?? "",
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5001),
  mongo:
    process.env.MONGODB_URI ??
    "mongodb://127.0.0.1:27017/globalsite?directConnection=true",
  origin: process.env.PUBLIC_URL ?? "http://localhost:5173",
  storage: path.resolve(root, process.env.STORAGE_ROOT ?? "storage"),
  encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASSWORD ?? "",
  mailFrom: process.env.SMTP_FROM ?? "GlobalSite <noreply@example.invalid>",
};
