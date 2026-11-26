// S35 B2: deterministic brand wordmark. It is the guaranteed fallback logo:
// generated from the exact site name (never AI-written lettering), so spelling
// is always correct. Inline header/footer marks are styled by trusted CSS
// (site.css, pack-precision.css uses Barlow Condensed); standalone SVG files
// (favicon, downloadable fallback) carry explicit fills and generic fonts.

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const clean = (name: string) =>
  [...String(name ?? "")]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "Brand";

/** Approximate advance width of the name at font-size 22 (condensed sans + CJK/Arabic/Cyrillic). */
export function wordmarkTextWidth(name: string) {
  let w = 0;
  for (const ch of clean(name))
    w += /[\u2E80-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/.test(ch)
      ? 22
      : /[\u0600-\u06FF\u0750-\u077F]/.test(ch)
        ? 14
        : /[\u0400-\u04FF]/.test(ch)
          ? 14
          : /[MWmw@]/.test(ch)
            ? 17
            : /[ilIj.,'!|:;]/.test(ch)
              ? 6
              : ch === " "
                ? 6
                : 12.5;
  return Math.max(24, Math.round(w));
}

const MARK =
  '<rect class="wordmark-mark" x="1" y="5" width="30" height="30" rx="3"/>' +
  '<path class="wordmark-cut" d="M8 29 16 11 24 29Z"/>';

/** Inline SVG wordmark for the page header/footer (styled by site CSS). */
export function wordmarkSvg(
  name: string,
  options: { decorative?: boolean } = {},
) {
  const label = clean(name);
  const text = wordmarkTextWidth(label);
  const width = 42 + text;
  return (
    '<svg class="brand-wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    width +
    ' 40" width="' +
    width +
    '" height="40"' +
    (options.decorative
      ? ' aria-hidden="true" focusable="false"'
      : ' role="img" aria-label="' + esc(label) + '"') +
    ">" +
    MARK +
    '<text x="42" y="28" textLength="' +
    text +
    '" lengthAdjust="spacingAndGlyphs">' +
    esc(label) +
    "</text></svg>"
  );
}

const safeColor = (c: string | undefined, fallback: string) =>
  c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;

/** Standalone SVG wordmark (download / logo picker preview). */
export function standaloneWordmarkSvg(
  name: string,
  colors: { mark?: string; text?: string } = {},
) {
  const label = clean(name);
  const text = wordmarkTextWidth(label);
  const width = 42 + text;
  const mark = safeColor(colors.mark, "#1f2a2e");
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    width +
    ' 40" width="' +
    width * 4 +
    '" height="160" role="img" aria-label="' +
    esc(label) +
    '"><rect x="1" y="5" width="30" height="30" rx="3" fill="' +
    mark +
    '"/><path d="M8 29 16 11 24 29Z" fill="#ffffff"/><text x="42" y="28" textLength="' +
    text +
    '" lengthAdjust="spacingAndGlyphs" font-family="\'Barlow Condensed\',\'Noto Sans SC\',\'PingFang SC\',\'Hiragino Sans\',\'Noto Sans Arabic\',\'Arial Narrow\',Arial,sans-serif" font-weight="700" font-size="22" fill="' +
    safeColor(colors.text, "#1f2a2e") +
    '">' +
    esc(label) +
    "</text></svg>"
  );
}

/** Square favicon: geometric mark only (legible at 16px). */
export function faviconSvg(color?: string) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="' +
    safeColor(color, "#49694c") +
    '"/><path d="M8 25 16 7 24 25Z" fill="#ffffff"/></svg>'
  );
}
