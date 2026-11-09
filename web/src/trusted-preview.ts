import base from "../../server/builder/site.css?url";
import composition from "../../server/builder/composition.css?url";
// Only developer-owned bundled styles; no model CSS/JS or relaxed parent CSP.
export function trustedPreview(html: string) {
  const clean = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
  return clean.replace(
    "</head>",
    '<link rel="stylesheet" href="' +
      base +
      '"><link rel="stylesheet" href="' +
      composition +
      '"></head>',
  );
}
