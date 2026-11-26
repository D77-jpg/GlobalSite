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

// S36: platform-provided AI. Read at call time (like ai-target) so a restart
// with new environment values, or a test, takes effect without code changes.
// Keys only come from the environment / secret manager: never stored in the
// database, logged, or included in an error.
export type PlatformOutputMode = "json_object" | "json_schema";
export type PlatformImageMode = "auto" | "images" | "chat";
export type PlatformTextConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  outputMode: PlatformOutputMode;
};
export type PlatformImageConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  mode: PlatformImageMode;
};
export type PlatformAiConfig = {
  /** Complete PLATFORM_AI_BASE_URL + PLATFORM_AI_API_KEY + PLATFORM_AI_MODEL. */
  text: PlatformTextConfig | null;
  /** Complete PLATFORM_IMAGE_BASE_URL + PLATFORM_IMAGE_API_KEY + PLATFORM_IMAGE_MODEL. */
  image: PlatformImageConfig | null;
  /** ALLOW_ORG_AI_KEYS=true keeps organization keys usable in production. */
  allowOrgKeys: boolean;
  production: boolean;
  /** Optional https:/mailto: upgrade link; blank shows "contact us" copy. */
  upgradeUrl: string;
  /** Names of misconfigured variables only, never their values. */
  issues: string[];
};
export function platformAiConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformAiConfig {
  const issues: string[] = [];
  const read = (name: string, max: number) => {
    const value = (env[name] ?? "").trim();
    if (value.length <= max) return value;
    issues.push(name);
    return "";
  };
  const isHttpUrl = (value: string, name: string) => {
    try {
      if (["https:", "http:"].includes(new URL(value).protocol)) return true;
    } catch {
      /* reported below */
    }
    issues.push(name);
    return false;
  };
  const textBase = read("PLATFORM_AI_BASE_URL", 500),
    textKey = read("PLATFORM_AI_API_KEY", 4096),
    textModel = read("PLATFORM_AI_MODEL", 120),
    visionModel = read("PLATFORM_AI_VISION_MODEL", 120),
    outputMode = read("PLATFORM_AI_OUTPUT_MODE", 40);
  if (outputMode && !["json_object", "json_schema"].includes(outputMode))
    issues.push("PLATFORM_AI_OUTPUT_MODE");
  const imageBase = read("PLATFORM_IMAGE_BASE_URL", 500),
    imageKey = read("PLATFORM_IMAGE_API_KEY", 4096),
    imageModel = read("PLATFORM_IMAGE_MODEL", 120),
    imageMode = read("PLATFORM_IMAGE_MODE", 20);
  if (imageMode && !["auto", "images", "chat"].includes(imageMode))
    issues.push("PLATFORM_IMAGE_MODE");
  const textParts = [textBase, textKey, textModel].filter(Boolean).length;
  if (textParts > 0 && textParts < 3) issues.push("PLATFORM_AI_INCOMPLETE");
  const imageParts = [imageBase, imageKey, imageModel].filter(Boolean).length;
  if (imageParts > 0 && imageParts < 3)
    issues.push("PLATFORM_IMAGE_INCOMPLETE");
  const text: PlatformTextConfig | null =
    textParts === 3 && isHttpUrl(textBase, "PLATFORM_AI_BASE_URL")
      ? {
          baseUrl: textBase.replace(/\/+$/, ""),
          apiKey: textKey,
          model: textModel,
          visionModel,
          outputMode: outputMode === "json_schema" ? "json_schema" : "json_object",
        }
      : null;
  const image: PlatformImageConfig | null =
    imageParts === 3 && isHttpUrl(imageBase, "PLATFORM_IMAGE_BASE_URL")
      ? {
          baseUrl: imageBase.replace(/\/+$/, ""),
          apiKey: imageKey,
          model: imageModel,
          mode:
            imageMode === "images" || imageMode === "chat" ? imageMode : "auto",
        }
      : null;
  let upgradeUrl = read("PLATFORM_UPGRADE_URL", 500);
  if (upgradeUrl) {
    let valid = false;
    try {
      valid = ["https:", "mailto:"].includes(new URL(upgradeUrl).protocol);
    } catch {
      valid = false;
    }
    if (!valid) {
      issues.push("PLATFORM_UPGRADE_URL");
      upgradeUrl = "";
    }
  }
  return {
    text,
    image,
    allowOrgKeys: (env.ALLOW_ORG_AI_KEYS ?? "").trim() === "true",
    production: (env.NODE_ENV ?? "development") === "production",
    upgradeUrl,
    issues,
  };
}
const platformIssues = platformAiConfig().issues;
if (platformIssues.length)
  // Variable names only; values (including keys) are never logged.
  console.warn(
    JSON.stringify({
      event: "platform_ai_config_invalid",
      variables: platformIssues,
    }),
  );
