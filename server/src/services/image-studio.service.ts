import { z } from "zod";
import { AgentAiProvider } from "../models";
import { tenantContext } from "../models/tenant-context";
import { encrypt, decrypt } from "./credential-crypto";
import { audit } from "./audit.service";
import { AppError, ensure } from "../errors";
import { reserve, settle } from "./usage.service";
import { detectMime, store } from "./storage.service";
import { aiBase, aiFetch, localAiBase } from "./ai-target";

const defaultBase = () => localAiBase() ?? "https://api.openai.com/v1";
const defaultModel = "gpt-image-1";

export const imageMode = z.enum(["auto", "images", "chat"]);
export const imageModel = z.string().trim().min(1).max(120);
export const imageProviderInput = z
  .object({
    apiKey: z.string().trim().max(512).optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    model: imageModel.optional(),
    mode: imageMode.optional(),
  })
  .strict();

const shots = {
  campaign:
    "Wide landscape editorial campaign photograph. Stage the subject in the right half. Leave quiet negative space on the left for a headline.",
  "still-life":
    "Art-directed product still life. Full silhouette in frame, tactile materials, a deliberate graphic backdrop and directional studio light.",
  detail:
    "Tight editorial detail photograph. Show texture, a point of interaction and a purposeful crop with soft side lighting.",
};
const paletteAtmosphere: Record<string, string> = {
  obsidian:
    "Moody dark architectural chiaroscuro lighting, dark walnut, honed black stone or brushed dark steel environment, warm bronze specular highlights, zero pure-white studio background.",
  ivory:
    "Warm gallery daylight, honed travertine limestone or alabaster surfaces, soft architectural shadows, refined editorial warmth.",
  clay: "Warm Mediterranean sunlight, terracotta and textured plaster backdrop, natural tactile warmth.",
  graphite:
    "Crisp German precision engineering studio lighting, cool brushed anodized aluminum and matte slate surfaces, high-clarity technical contrast.",
  cobalt:
    "Clean industrial automation studio lighting, cool steel and subtle deep cobalt architectural accents.",
  forest:
    "Natural diffused daylight with botanical organic textures, raw timber and matte sage stone surfaces.",
  ocean:
    "Bright clean-tech studio light, frosted glass, matte white and subtle deep teal architectural highlights.",
  violet:
    "Modern avant-garde studio lighting, sculptural matte neutral surfaces with subtle cool rim light.",
};

export const imageBrief = z
  .object({
    subject: z.string().trim().min(3).max(600),
    composition: z.enum(["campaign", "still-life", "detail"]),
    palette: z
      .enum([
        "obsidian",
        "ivory",
        "clay",
        "graphite",
        "cobalt",
        "forest",
        "ocean",
        "violet",
        "brand",
      ])
      .optional(),
  })
  .strict();
const purpose = () => "image-provider:" + tenantContext()!.organizationId;

export async function imageStatus() {
  const p = await AgentAiProvider.findOne({ name: "images" })
    .select("enabled modelName baseUrl mode")
    .lean();
  const mode = imageMode.safeParse(p?.mode).success
    ? (p!.mode as z.infer<typeof imageMode>)
    : "auto";
  return {
    configured: !!p?.enabled,
    model: p?.modelName || defaultModel,
    baseUrl: p?.baseUrl || defaultBase(),
    mode,
  };
}

export async function configureImages(
  input: z.infer<typeof imageProviderInput>,
  userId: string,
) {
  if (input.apiKey === "") {
    await AgentAiProvider.deleteOne({ name: "images" });
    await audit("ai.images.configured", userId);
    return imageStatus();
  }
  const existing = await AgentAiProvider.findOne({ name: "images" });
  const targetBase = (
    await aiBase(input.baseUrl ?? existing?.baseUrl ?? defaultBase())
  ).href.replace(/\/+$/, "");
  const model = input.model ?? existing?.modelName ?? defaultModel;
  const mode = input.mode ?? (imageMode.safeParse(existing?.mode).success ? existing!.mode : "auto");
  ensure(input.apiKey || existing?.secret, 400, "AI_KEY_REQUIRED");
  await AgentAiProvider.updateOne(
    { name: "images" },
    {
      $set: {
        enabled: true,
        modelName: model,
        baseUrl: targetBase,
        mode,
        ...(input.apiKey ? { secret: encrypt(input.apiKey, purpose()) } : {}),
      },
    },
    { upsert: true },
  );
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
  const baseUrl = (await aiBase(p.baseUrl || defaultBase())).href.replace(
    /\/+$/,
    "",
  );
  const operation = "image:" + key;
  ensure(await reserve("images", 1, operation), 409, "IMAGE_ALREADY_SUBMITTED");
  const prompt = [
    shots[input.composition],
    input.palette && paletteAtmosphere[input.palette]
      ? paletteAtmosphere[input.palette]
      : "",
    input.subject,
    "Original illustrative brand imagery. No text, logo, watermark, badges or certification marks.",
  ]
    .filter(Boolean)
    .join(" ");
  const model = imageModel.parse(p.modelName || defaultModel);
  const mode = imageMode.safeParse(p.mode).success
    ? (p.mode as z.infer<typeof imageMode>)
    : "auto";
  const chat = mode === "chat" || (mode === "auto" && /gemini/i.test(model));
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
    response = await aiFetch(
      baseUrl + (chat ? "/chat/completions" : "/images/generations"),
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
