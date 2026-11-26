import { z } from "zod";
import { AgentAiProvider, Asset } from "../models";
import { tenantContext } from "../models/tenant-context";
import { encrypt } from "./credential-crypto";
import { audit } from "./audit.service";
import { AppError, ensure } from "../errors";
import { reserve, settle } from "./usage.service";
import { detectMime, store } from "./storage.service";
import { aiBase, aiFetch, localAiBase } from "./ai-target";
import { publicUrl } from "./website/public-web";
import { resolveImageProvider, settingsManaged } from "./ai-provider-resolve";

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
  logo: "Flat vector logo design on a plain solid background. Simple geometric symbol and clean wordmark, high contrast, works on both light and dark backgrounds.",
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
    composition: z.enum(["campaign", "still-life", "detail", "logo"]),
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
  // S36: platform-managed image service; never expose its model or URL.
  if (settingsManaged("image")) {
    const available = !!(await resolveImageProvider());
    return { managed: true as const, enabled: available, configured: available };
  }
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
  ensure(!settingsManaged("image"), 409, "PLATFORM_MANAGED");
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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * S35: some OpenAI-compatible image services return a URL instead of
 * b64_json. Only public HTTPS URLs are accepted (same public-web SSRF guard,
 * no redirects, bounded time and size); the bytes are then sniffed locally.
 */
export async function downloadGeneratedImage(value: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new AppError(502, "IMAGE_RESPONSE_INVALID");
  }
  ensure(
    u.protocol === "https:" && !u.username && !u.password,
    502,
    "IMAGE_RESPONSE_INVALID",
  );
  try {
    await publicUrl(u.href);
  } catch {
    throw new AppError(502, "IMAGE_RESPONSE_INVALID");
  }
  let response: Response;
  try {
    response = await fetch(u.href, {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new AppError(502, "IMAGE_RESPONSE_INVALID");
  }
  ensure(response.ok && response.body, 502, "IMAGE_RESPONSE_INVALID");
  const declared = Number(response.headers.get("content-length") ?? 0);
  ensure(declared <= MAX_IMAGE_BYTES, 502, "IMAGE_RESPONSE_INVALID");
  const reader = response.body!.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      ensure(size <= MAX_IMAGE_BYTES, 502, "IMAGE_RESPONSE_INVALID");
      parts.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(parts);
}

export async function decodeGeneratedImage(
  response: Response,
  fetchUrl?: (url: string) => Promise<Buffer>,
) {
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
  // URL responses are only followed when the caller supplies a guarded fetcher.
  const remote =
    typeof encoded === "string" && encoded.length > 0
      ? null
      : typeof body?.data?.[0]?.url === "string"
        ? body.data[0].url
        : typeof inline === "string"
          ? (/https:\/\/[^\s)"'<>]+/.exec(inline)?.[0] ?? null)
          : null;
  ensure(
    (typeof encoded === "string" && encoded.length > 0) ||
      (!!remote && !!fetchUrl),
    502,
    "IMAGE_RESPONSE_INVALID",
  );
  const bytes =
    typeof encoded === "string" && encoded.length > 0
      ? Buffer.from(encoded, "base64")
      : await fetchUrl!(remote!);
  const mime = detectMime(bytes);
  ensure(
    mime?.startsWith("image/") && bytes.length <= MAX_IMAGE_BYTES,
    502,
    "IMAGE_RESPONSE_INVALID",
  );
  return { bytes, mime: mime! };
}

export async function generateImage(
  input: z.infer<typeof imageBrief>,
  key: string,
  options: { originKey?: string; fileLabel?: string } = {},
) {
  // S36: platform image service or (non-production / ALLOW_ORG_AI_KEYS) the
  // organization's own; billing below stays on the organization's plan.
  const p = await resolveImageProvider();
  ensure(p, 409, "IMAGE_PROVIDER_MISSING");
  const baseUrl = (await aiBase(p.baseUrl || defaultBase())).href.replace(
    /\/+$/,
    "",
  );
  const operation = "image:" + key;
  ensure(await reserve("images", 1, operation), 409, "IMAGE_ALREADY_SUBMITTED");
  const prompt = [
    shots[input.composition],
    input.palette && paletteAtmosphere[input.palette] && input.composition !== "logo"
      ? paletteAtmosphere[input.palette]
      : "",
    input.subject,
    input.composition === "logo"
      ? "Original logo concept. No photorealistic people, no watermark, badges or certification marks; no text other than the exact brand name given."
      : "Original illustrative brand imagery. No text, logo, watermark, badges or certification marks.",
  ]
    .filter(Boolean)
    .join(" ");
  const model = imageModel.parse(p.modelName || defaultModel);
  const mode = p.mode;
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
  const provider = p;
  const send = async (body: unknown) => {
    try {
      return await aiFetch(
        baseUrl + (chat ? "/chat/completions" : "/images/generations"),
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(180000),
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + provider.apiKey(),
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new AppError(502, "IMAGE_REQUEST_FAILED");
    }
  };
  let response = await send(payload);
  // S35: a provider that rejects optional parameters (size/n) gets exactly one
  // downgraded retry on the same reservation, so the image is billed at most once.
  if (!chat && [400, 422].includes(response.status)) {
    await response.body?.cancel();
    response = await send({ model, prompt });
  }
  if (!response.ok) {
    if ([400, 401, 403, 404, 422, 429].includes(response.status))
      await settle("images", operation, 0);
    await response.body?.cancel();
    throw new AppError(502, "IMAGE_REQUEST_FAILED");
  }
  await settle("images", operation, 1);
  const { bytes, mime } = await decodeGeneratedImage(
    response,
    downloadGeneratedImage,
  );
  const a = await store(
    bytes,
    mime,
    (options.fileLabel ?? "AI-concept-" + input.composition) +
      "-" +
      key.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) +
      "." +
      mime.split("/")[1],
    "image",
    undefined,
    true,
  );
  if (options.originKey)
    await Asset.updateOne(
      { _id: a._id },
      { $set: { originKey: options.originKey } },
    ).catch(() => undefined);
  return { id: String(a._id) };
}
