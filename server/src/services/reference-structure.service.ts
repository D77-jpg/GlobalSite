import { Parser } from "htmlparser2";
import { websiteUrl } from "./website/public-web";

// Static markup evidence only: never a computed screenshot, CSS inspection,
// supplier capability source or permission to fetch any linked destination.
export function referenceStructure(html: string, base: string) {
  const headings: {
    level: string;
    title: string;
    words: number;
    images: number;
  }[] = [];
  const navigation: { label: string; path: string }[] = [];
  let ignored = 0,
    navDepth = 0,
    inHeading = "",
    heading = "",
    anchor = "",
    href = "";
  let active: (typeof headings)[number] | undefined;
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (["script", "style", "noscript", "svg"].includes(tag)) ignored++;
      if (ignored) return;
      if (tag === "nav") navDepth++;
      if (/^h[23]$/.test(tag)) {
        inHeading = tag;
        heading = "";
      }
      if (tag === "img" && active) active.images++;
      if (tag === "a" && navDepth) {
        anchor = "";
        href = attrs.href ?? "";
      }
    },
    ontext(value) {
      if (ignored) return;
      if (inHeading) heading += value;
      else if (active && !navDepth)
        active.words += clean(value).split(/\s+/).filter(Boolean).length;
      if (href) anchor += value;
    },
    onclosetag(tag) {
      if (["script", "style", "noscript", "svg"].includes(tag)) {
        ignored = Math.max(0, ignored - 1);
        return;
      }
      if (ignored) return;
      if (tag === inHeading) {
        const title = clean(heading);
        if (title && !navDepth && headings.length < 24) {
          active = {
            level: inHeading,
            title: title.slice(0, 160),
            words: 0,
            images: 0,
          };
          headings.push(active);
        }
        inHeading = "";
      }
      if (tag === "a" && href) {
        try {
          const target = new URL(href, base);
          if (target.search || target.hash)
            throw new Error("NON_STRUCTURAL_LINK");
          const u = websiteUrl(target.href),
            origin = new URL(base).origin;
          const label = clean(anchor).slice(0, 60);
          if (
            u.origin === origin &&
            label &&
            !u.search &&
            !u.hash &&
            navigation.length < 24 &&
            !navigation.some((v) => v.path === u.pathname)
          )
            navigation.push({ label, path: u.pathname });
        } catch {
          /* Non-web and private targets are not structural destinations. */
        }
        href = "";
        anchor = "";
      }
      if (tag === "nav") navDepth = Math.max(0, navDepth - 1);
    },
  });
  parser.end(html);
  return { method: "static_html_only", navigation, sections: headings };
}
