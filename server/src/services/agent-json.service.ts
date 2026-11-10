import { jsonrepair } from "jsonrepair";
// Parse data only. Bounded extraction tolerates prose/fences, never executes output,
// repairs bounded syntax only, and refuses truncated/ambiguous/expressive output.
// Every repaired object still passes the same strict schemas and factual gates.
export function parseAgentJson(raw: string): unknown {
  if (raw.length > 512 * 1024) throw Error("INVALID_JSON");
  let text = raw.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, "");
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1];
  try {
    return JSON.parse(text);
  } catch {
    /* Try the bounded single-object envelope below. */
  }
  if (text.length > 512 * 1024) throw Error("INVALID_JSON");
  const values: unknown[] = [];
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (c === "{") {
        start = i;
        depth = 1;
        quoted = false;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        values.push(JSON.parse(text.slice(start, i + 1)));
      } catch {
        /* This balanced fragment is not a JSON object. */
      }
      if (values.length > 1) throw Error("AMBIGUOUS_JSON");
      start = -1;
    }
  }
  if (values.length === 1 && depth === 0) return values[0];
  if (
    values.length > 1 ||
    depth !== 0 ||
    quoted ||
    !text.startsWith("{") ||
    !text.endsWith("}") ||
    /(?:^|[,:])\s*(?:[A-Za-z_$][\w$]*\s*\(|function\b|undefined\b)/.test(text)
  )
    throw Error("INVALID_JSON");
  const repaired = jsonrepair(text);
  // A syntax repair must never supply or rewrite a numerical value, including IDs.
  if (
    JSON.stringify(text.match(/\d+/g)) !==
    JSON.stringify(repaired.match(/\d+/g))
  )
    throw Error("INVALID_JSON");
  const value = JSON.parse(repaired);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_JSON");
  return value;
}
