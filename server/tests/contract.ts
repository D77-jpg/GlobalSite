import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
const spec = yaml.load(
  fs.readFileSync(
    path.resolve(__dirname, "../../docs/api/foundation.openapi.yaml"),
    "utf8",
  ),
) as any;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const cache = new Map<string, ReturnType<typeof ajv.compile>>();
export function assertResponse(
  method: string,
  url: string,
  status: number,
  body: unknown,
  contentType: string,
) {
  if (!contentType.includes("application/json")) return;
  const pathname = url.split("?")[0];
  const match = Object.entries(spec.paths)
    .sort(([a], [b]) => Number(a.includes("{")) - Number(b.includes("{")))
    .find(([route]) =>
      new RegExp(
        "^" +
          route
            .split("/")
            .map((part) => (part.startsWith("{") ? "[^/]+" : part))
            .join("/") +
          "$",
      ).test(pathname),
    );
  assert(match, "Undocumented request path");
  const operation = (match[1] as any)[method.toLowerCase()];
  assert(operation, "Undocumented method " + method);
  const schema =
    operation.responses[status]?.content?.["application/json"]?.schema;
  assert(schema, "Undocumented HTTP status " + status + " for " + match[0]);
  const key = method + match[0] + status;
  let validate = cache.get(key);
  if (!validate) {
    validate = ajv.compile({ ...schema, components: spec.components });
    cache.set(key, validate);
  }
  assert(
    validate(body),
    "Response violates OpenAPI for " +
      method +
      " " +
      match[0] +
      ": " +
      ajv.errorsText(validate.errors),
  );
}

export function assertRequest(method: string, url: string, body: unknown) {
  const pathname = url.split("?")[0];
  const match = Object.entries(spec.paths)
    .sort(([a], [b]) => Number(a.includes("{")) - Number(b.includes("{")))
    .find(([route]) =>
      new RegExp(
        "^" +
          route
            .split("/")
            .map((part) => (part.startsWith("{") ? "[^/]+" : part))
            .join("/") +
          "$",
      ).test(pathname),
    );
  assert(match, "Undocumented request");
  const schema = (match[1] as any)[method.toLowerCase()]?.requestBody
    ?.content?.["application/json"]?.schema;
  if (!schema) return;
  const validate = ajv.compile({ ...schema, components: spec.components });
  assert(
    validate(body),
    "Request violates OpenAPI: " + ajv.errorsText(validate.errors),
  );
}
