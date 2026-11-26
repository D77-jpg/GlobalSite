import base from "../../server/builder/site.css?url";
import composition from "../../server/builder/composition.css?url";
import precision from "../../server/builder/pack-precision.css?url";
import atelier from "../../server/builder/pack-atelier.css?url";
import monolith from "../../server/builder/pack-monolith.css?url";
// S35: scoped "Illustrative" image labels and the private demo-content banner.
import notes from "../../server/builder/concept.css?url";
// Only developer-owned bundled styles; no model CSS/JS or relaxed parent CSP.
// S35/S37: pack-*.css files are fully scoped to .composed-site.pack-<name>, so
// loading them for every preview leaves pages without composition.pack unchanged.
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
      '"><link rel="stylesheet" href="' +
      precision +
      '"><link rel="stylesheet" href="' +
      atelier +
      '"><link rel="stylesheet" href="' +
      monolith +
      '"><link rel="stylesheet" href="' +
      notes +
      '"></head>',
  );
}
