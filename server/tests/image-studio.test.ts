import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeGeneratedImage,
  imageBrief,
} from "../src/services/image-studio.service";
test("image generation only accepts bounded shot briefs and locally decoded image bytes", async () => {
  assert.ok(
    !imageBrief.safeParse({ subject: "", composition: "campaign" }).success,
  );
  assert.ok(
    !imageBrief.safeParse({
      subject: "Sample",
      composition: "detail",
      baseUrl: "https://other.invalid/",
    }).success,
  );
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ok = await decodeGeneratedImage(
    Response.json({ data: [{ b64_json: png.toString("base64") }] }),
  );
  const chat = await decodeGeneratedImage(
    Response.json({
      choices: [
        {
          message: {
            content:
              "![concept](data:image/png;base64," +
              png.toString("base64") +
              ")",
          },
        },
      ],
    }),
  );
  assert.deepEqual(chat.bytes, png);
  assert.equal(ok.mime, "image/png");
  assert.deepEqual(ok.bytes, png);
  for (const payload of [
    { data: [{ url: "https://other.invalid/file" }] },
    { data: [{ b64_json: Buffer.from("%PDF-1").toString("base64") }] },
  ]) {
    await assert.rejects(
      decodeGeneratedImage(Response.json(payload)),
      /IMAGE_RESPONSE_INVALID/,
    );
  }
});
