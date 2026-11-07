import {
  fetchWebsite,
  robotsAllows,
  websiteUrl,
  type WebsiteFetcher,
} from "./website/public-web";
import { pageData } from "./website-read.service";
export async function referenceResearch(
  urls: string[],
  fetcher: WebsiteFetcher = fetchWebsite,
) {
  const results = [];
  for (const raw of urls.slice(0, 3)) {
    try {
      const initial = websiteUrl(raw),
        robots = await fetcher(new URL("/robots.txt", initial).href, "robots");
      if (!robotsAllows(initial.pathname, robots.text)) {
        results.push({ url: initial.href, status: "robots_disallowed" });
        continue;
      }
      const response = await fetcher(
        initial.href,
        "html",
        (url) =>
          url.origin === initial.origin &&
          robotsAllows(url.pathname, robots.text),
      );
      const parsed = pageData(response.text, response.url);
      results.push({
        url: response.url,
        status: "read",
        capturedAt: new Date().toISOString(),
        title: parsed.title.slice(0, 200),
        headings: parsed.headings.slice(0, 18),
        excerpt: parsed.text.slice(0, 3500),
      });
    } catch {
      results.push({ url: raw, status: "unavailable" });
    }
  }
  return results;
}
