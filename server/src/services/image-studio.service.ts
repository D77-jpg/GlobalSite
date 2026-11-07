import { z } from "zod";
import { AgentAiProvider } from "../models";
import { tenantContext } from "../models/tenant-context";
import { encrypt, decrypt } from "./credential-crypto";
import { audit } from "./audit.service";
import { AppError, ensure } from "../errors";
import { reserve, settle } from "./usage.service";
import { detectMime, store } from "./storage.service";

const base = "https://www.codex789.com/v1";
const defaultModel = "gemini-3.1-flash-image";
export const imageModel = z.enum([
  defaultModel,
  "gpt-image-2",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.6-sunburst",
]);
const shots = {
  campaign:
    "Wide landscape editorial campaign photograph. Stage the subject in the right half. Leave quiet negative space on the left for a headline.",
  "still-life":
    "Art-directed product still life. Full silhouette in frame, tactile materials, a deliberate graphic backdrop and directional studio light.",
  detail:
    "Tight editorial detail photograph. Show texture, a point of interaction and a purposeful crop with soft side lighting.",
};
export const imageBrief = z
  .object({
    subject: z.string().trim().min(3).max(600),
    composition: z.enum(["campaign", "still-life", "detail"]),
  })
  .strict();
const purpose = () => "image-provider:" + tenantContext()!.organizationId;
export async function imageStatus() {
  const p = await AgentAiProvider.findOne({ name: "images" })
    .select("enabled modelName")
    .lean();
  return { configured: !!p?.enabled, model: p?.modelName ?? defaultModel };
}
export async function configureImages(
  key: string,
  userId: string,
  model: z.infer<typeof imageModel> = defaultModel,
) {
  if (key)
    await AgentAiProvider.updateOne(
      { name: "images" },
      {
        $set: {
          enabled: true,
          modelName: model,
          baseUrl: base,
          secret: encrypt(key, purpose()),
        },
      },
      { upsert: true },
    );
  else await AgentAiProvider.deleteOne({ name: "images" });
  await audit("ai.images.configured", userId);
  return imageStatus();
}
export async function decodeGeneratedImage(response: Response) {
  const reader = response.body?.getReader();
  ensure(reader, 502, "IMAGE_RESPONSE_INVALID");
  const parts: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      ensure(size <= 15 * 1024 * 1024, 502, "IMAGE_RESPONSE_INVALID");
      parts.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(parts).toString());
  } catch {
    throw new AppError(502, "IMAGE_RESPONSE_INVALID");
  }
  const content = body?.choices?.[0]?.message?.content;
  const inline =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.find((v) => typeof v?.image_url?.url === "string")?.image_url
            .url
        : null;
  const encoded =
    body?.data?.[0]?.b64_json ??
    (typeof inline === "string"
      ? /data:image\/(?:png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)/.exec(
          inline,
        )?.[1]
      : undefined);
  ensure(
    typeof encoded === "string" && encoded.length > 0,
    502,
    "IMAGE_RESPONSE_INVALID",
  );
  const bytes = Buffer.from(encoded, "base64");
  const mime = detectMime(bytes);
  ensure(
    mime?.startsWith("image/") && bytes.length <= 10 * 1024 * 1024,
    502,
    "IMAGE_RESPONSE_INVALID",
  );
  return { bytes, mime: mime! };
}
export async function generateImage(
  input: z.infer<typeof imageBrief>,
  key: string,
) {
  const p = await AgentAiProvider.findOne({ name: "images", enabled: true });
  ensure(p?.secret, 409, "IMAGE_PROVIDER_MISSING");
  const operation = "image:" + key;
  ensure(await reserve("images", 1, operation), 409, "IMAGE_ALREADY_SUBMITTED");
  const prompt = [
    shots[input.composition],
    input.subject,
    "Original illustrative brand imagery. No text, logo, watermark, badges or certification marks.",
  ].join(" ");
  const model = imageModel.parse(p.modelName),
    chat = model === defaultModel;
  const payload = chat
    ? {
        model,
        messages: [{ role: "user", content: "Generate one image. " + prompt }],
      }
    : {
        model,
        prompt,
        n: 1,
        size: input.composition === "campaign" ? "1536x1024" : "1024x1024",
      };
  let response;
  try {
    response = await fetch(
      base + (chat ? "/chat/completions" : "/images/generations"),
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(180000),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + decrypt(p.secret, purpose()),
        },
        body: JSON.stringify(payload),
      },
    );
  } catch {
    throw new AppError(502, "IMAGE_REQUEST_FAILED");
  }
  if (!response.ok) {
    if ([400, 401, 403, 404, 422, 429].includes(response.status))
      await settle("images", operation, 0);
    await response.body?.cancel();
    throw new AppError(502, "IMAGE_REQUEST_FAILED");
  }
  await settle("images", operation, 1);
  const { bytes, mime } = await decodeGeneratedImage(response);
  const a = await store(
    bytes,
    mime,
    "AI-concept-" +
      input.composition +
      "-" +
      key.slice(0, 8) +
      "." +
      mime.split("/")[1],
    "image",
    undefined,
    true,
  );
  return { id: String(a._id) };
}
