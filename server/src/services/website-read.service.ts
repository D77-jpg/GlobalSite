import { authorizeActor } from "./catalog-authority";
import { Parser } from "htmlparser2";
import mongoose from "mongoose";
import {
  WebsiteRead,
  Product,
  FactSheet,
  FactRevision,
  AuditLog,
} from "../models";
import {
  websiteUrl,
  fetchWebsite,
  robotsAllows,
  type WebsiteFetcher,
} from "./website/public-web";
import { sha, factDto } from "./catalog.service";
import { fenceTask } from "./product-import.service";
import { ensure } from "../errors";
export function pageData(html: string, url: string) {
  let title = "",
    text = "",
    inTitle = false,
    skip = 0,
    json = false,
    jsonText = "",
    heading = "",
    currentHeading = "";
  const headings: string[] = [],
    links: string[] = [],
    data: any[] = [];
  let hDepth = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (["script", "style", "noscript", "iframe", "svg"].includes(name)) {
          skip++;
          if (name === "script" && attrs.type === "application/ld+json") {
            json = true;
            jsonText = "";
          }
          return;
        }
        if (name === "title") inTitle = true;
        if (/^h[1-3]$/.test(name)) {
          hDepth++;
          currentHeading = "";
        }
        if (name === "a" && attrs.href && links.length < 100)
          try {
            const link = websiteUrl(new URL(attrs.href, url).href);
            if (
              link.hostname.replace(/^www\./, "") ===
                new URL(url).hostname.replace(/^www\./, "") &&
              (new URL(url).protocol !== "https:" || link.protocol === "https:")
            )
              links.push(link.href);
          } catch {
            /* Untrusted non-web/external links are ignored. */
          }
      },
      ontext(value) {
        if (json) {
          if (jsonText.length < 128000) jsonText += value;
          return;
        }
        if (skip) return;
        if (inTitle) title += value;
        if (hDepth) currentHeading += value;
        if (text.length < 24000) text += value.replace(/\s+/g, " ") + " ";
      },
      onclosetag(name) {
        if (name === "script" && json) {
          try {
            const parsed = JSON.parse(jsonText);
            const nodes = Array.isArray(parsed)
              ? parsed
              : (parsed["@graph"] ?? [parsed]);
            for (const node of nodes.slice(0, 30))
              if (node && typeof node === "object") data.push(node);
          } catch {
            /* Invalid structured data is not evidence. */
          }
          json = false;
        }
        if (["script", "style", "noscript", "iframe", "svg"].includes(name)) {
          skip = Math.max(0, skip - 1);
          return;
        }
        if (name === "title") inTitle = false;
        if (/^h[1-3]$/.test(name) && hDepth) {
          hDepth--;
          heading = currentHeading.trim().slice(0, 300);
          if (heading && headings.length < 50) headings.push(heading);
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  const products = data
    .filter(
      (n) =>
        [n["@type"]].flat().includes("Product") && typeof n.name === "string",
    )
    .slice(0, 5)
    .map((n) => ({
      name: n.name.trim().slice(0, 200),
      description:
        typeof n.description === "string"
          ? n.description.replace(/<[^>]*>/g, " ").slice(0, 4000)
          : null,
    }));
  if (
    !products.length &&
    /\/products?\//i.test(new URL(url).pathname) &&
    headings[0]
  )
    products.push({ name: headings[0].slice(0, 200), description: null });
  const facts: { type: string; value: string; quote: string }[] = [];
  for (const node of data
    .filter((n) =>
      [n["@type"]]
        .flat()
        .some((t) =>
          [
            "Organization",
            "Corporation",
            "LocalBusiness",
            "Manufacturer",
          ].includes(t),
        ),
    )
    .slice(0, 2))
    for (const [key, type] of [
      ["name", "company.name"],
      ["foundingDate", "company.founded"],
      ["telephone", "company.phone"],
      ["address", "company.address"],
    ] as const) {
      const v =
        typeof node[key] === "string"
          ? node[key]
          : key === "address" && node[key] && typeof node[key] === "object"
            ? [
                "streetAddress",
                "addressLocality",
                "addressRegion",
                "postalCode",
                "addressCountry",
              ]
                .map((k) =>
                  typeof node[key][k] === "string" ? node[key][k] : "",
                )
                .filter(Boolean)
                .join(", ")
            : "";
      if (v && v.length <= 1200) facts.push({ type, value: v, quote: v });
    }
  if (!facts.length && title.trim())
    facts.push({
      type: "website.pageTitle",
      value: title.trim().slice(0, 300),
      quote: title.trim().slice(0, 300),
    });
  return {
    url,
    title: title.trim().slice(0, 300),
    headings,
    text: text.trim().slice(0, 24000),
    links: [...new Set(links)],
    products,
    facts,
  };
}
export async function crawlWebsite(
  raw: string,
  maxPages: number,
  fetcher: WebsiteFetcher = fetchWebsite,
) {
  const initial = websiteUrl(raw),
    robots = await fetcher(new URL("/robots.txt", initial).href, "robots");
  const pending = [initial.href],
    seen = new Set<string>(),
    pages: any[] = [];
  let truncated = false;
  while (pending.length && pages.length < maxPages) {
    const url = pending.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    if (!robotsAllows(new URL(url).pathname, robots.text)) {
      pages.push({
        url,
        title: "",
        headings: [],
        text: "",
        links: [],
        products: [],
        facts: [],
        status: "robots_disallowed",
      });
      continue;
    }
    const response = await fetcher(url, "html", (u) =>
      robotsAllows(u.pathname, robots.text),
    );
    ensure(
      new URL(response.url).hostname.replace(/^www\./, "") ===
        initial.hostname.replace(/^www\./, ""),
      400,
      "URL_UNSAFE",
    );
    const page = pageData(response.text, response.url);
    pages.push({ ...page, status: "read" });
    for (const link of page.links)
      if (!seen.has(link) && pending.length < 100) pending.push(link);
  }
  truncated = pending.length > 0;
  return { pages, truncated };
}
export async function processWebsite(
  task: any,
  fetcher: WebsiteFetcher = fetchWebsite,
) {
  const run = await WebsiteRead.findById(task.payload.runId);
  ensure(run, 404, "NOT_FOUND");
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(run.actorId), session);
    await WebsiteRead.updateOne(
      { _id: run._id },
      { $set: { status: "running" } },
      { session },
    );
  });
  const result = await crawlWebsite(run.url, run.maxPages, fetcher);
  await mongoose.connection.transaction(async (session) => {
    await fenceTask(task, session);
    await authorizeActor(String(run.actorId), session);
    const productIds: any[] = [],
      factIds: any[] = [];
    for (const page of result.pages) {
      for (const item of page.products) {
        const key = "website:" + sha(page.url + ":" + item.name);
        let product = await Product.findOne({ importKey: key }).session(
          session,
        );
        if (!product)
          [product] = await Product.create(
            [
              {
                ...item,
                sku: "WEB-" + sha(key).slice(0, 16).toUpperCase(),
                source: "local",
                status: "draft",
                importKey: key,
                provenance: {
                  kind: "website",
                  refId: String(run._id),
                  url: page.url,
                },
              },
            ],
            { session },
          );
        productIds.push(product._id);
      }
      for (const item of page.facts) {
        const key =
          "website:" + sha(page.url + ":" + item.type + ":" + item.value);
        let fact = await FactSheet.findOne({ originKey: key }).session(session);
        if (!fact) {
          [fact] = await FactSheet.create(
            [
              {
                subjectType: "organization",
                type: item.type,
                value: item.value,
                originKey: key,
                status: "candidate",
                source: {
                  kind: "website",
                  refId: String(run._id),
                  url: page.url,
                  quote: item.quote,
                  sha256: sha(page.text),
                  capturedAt: new Date().toISOString(),
                  textVerified: true,
                },
              },
            ],
            { session },
          );
          await FactRevision.create(
            [
              {
                factId: fact._id,
                revision: 1,
                actorId: run.actorId,
                action: "website.candidate",
                before: null,
                after: factDto(fact),
              },
            ],
            { session },
          );
        }
        factIds.push(fact._id);
      }
    }
    await WebsiteRead.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "complete",
          pages: result.pages,
          resultIds: productIds,
          factIds,
          truncated: result.truncated,
        },
      },
      { session },
    );
    await AuditLog.create(
      [
        {
          action: "website.read.completed",
          actorId: run.actorId,
          targetId: String(run._id),
        },
      ],
      { session },
    );
  });
}
