import { sectionDesign } from "../validators/sites.validator";
export function sectionClasses(value: unknown) {
  const parsed = sectionDesign.safeParse(value);
  if (!parsed.success) return "";
  const d = parsed.data;
  return (
    " directed-section frame-" +
    d.frame +
    " media-" +
    d.ratio +
    " fit-" +
    d.fit +
    " focus-" +
    d.focus +
    " spacing-" +
    d.density
  );
}

// Only rendering intent and repeated, explicit missing-information placeholders
// are normalized. Actual values, numerical claims, refs and assets are preserved.
export function resolveAgentPage(
  input: import("../validators/sites.validator").PageInput,
) {
  const page = structuredClone(input);
  const pending = (v: string) =>
    /^(Contact our team for confirmed details\.|Details available on request\.|Information to be confirmed\.|Not yet confirmed\.?)$/i.test(
      v.trim(),
    );
  for (const b of page.blocks) {
    if (
      b.design?.frame === "gallery" &&
      !["category-grid", "product-grid", "image"].includes(b.type)
    )
      b.design.frame =
        b.type === "process"
          ? "steps"
          : ["specs", "comparison"].includes(b.type)
            ? "table"
            : "index";
    if (b.type === "split" && !b.assetId && b.design) {
      b.design.frame = "band";
      b.layout = "compact";
    }
    if (
      b.key === "specs" &&
      b.type === "specs" &&
      !b.refs.length &&
      b.table?.rows.length &&
      b.table.rows.every(
        (row) =>
          row.length >= 2 && !/\d/.test(row[0]) && row.slice(1).every(pending),
      )
    ) {
      b.table.rows = [];
      b.body = "Contact our team for confirmed details.";
    }
  }
  return page;
}
