import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { HtmlValidate } from "html-validate";
const require = createRequire(import.meta.url);
const {
  buildStatic,
} = require("../server/dist/services/static-builder.service.js");
const { config } = require("../server/dist/config.js");
const sharp = createRequire(new URL("../server/package.json", import.meta.url))(
  "sharp",
);
const root = process.cwd();
if (root.toLowerCase() !== "d:\\trade\\genesis\\globalsite" && !process.env.CI)
  throw Error("Run from repository root");
config.storage = path.join(root, "node_modules/.cache/s5-quality-storage");
const reportDir = path.join(root, "test-results");
await fs.mkdir(reportDir, { recursive: true });
const paragraph =
  "Our team helps buyers explore product options and prepare a clear purchasing brief. Share your application, preferred materials, packaging requirements and intended market with our team. We will discuss the details with you before preparing a proposal. Browse the information below to learn about our approach and find the right contact for your project. Product details are reviewed by our team before publication.";
const faq =
  "Share your application and purchasing requirements with our team to begin a product discussion. We review the intended use, preferred materials, packaging and delivery expectations with you before preparing a proposal. Please include any drawings or relevant documents so the discussion can focus on the details that matter for your project.";
const img = await sharp(
  Buffer.from(
    '<svg width="1200" height="750" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="750" fill="#dce7e0"/><path d="M0 650L360 220L700 540L1000 100L1200 450V750H0Z" fill="#587567"/><circle cx="300" cy="260" r="130" fill="#c4d3c9"/></svg>',
  ),
)
  .webp()
  .toBuffer();
const validator = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    "no-inline-style": "off",
    "heading-level": "off",
    "wcag/h32": "off",
    "form-dup-name": [
      "error",
      { shared: ["radio", "checkbox", "submit", "button", "reset"] },
    ],
  },
});
const compositions = {
  "composition-engineering": {
    typography: "technical",
    palette: "cobalt",
    navigation: "capabilities",
    productLayout: "rows",
    hero: "split",
    subject: "Precision parts",
  },
  "composition-oem": {
    typography: "sans",
    palette: "graphite",
    navigation: "solutions",
    productLayout: "cards",
    hero: "stacked",
    subject: "Contract assembly",
  },
  "composition-packaging": {
    typography: "sans",
    palette: "clay",
    navigation: "catalogue",
    productLayout: "cards",
    hero: "editorial",
    subject: "Custom packaging",
  },
  "composition-material": {
    typography: "editorial",
    palette: "violet",
    navigation: "catalogue",
    productLayout: "gallery",
    hero: "panorama",
    subject: "Glass collections",
  },
};
const businessCases = {
  "business-art": {
    source: "composition-material",
    journey: "visual-selection",
    sections: ["specs"],
    label: "Collections",
    frame: "gallery",
    subject: "Artwork for interiors",
  },
  "business-engineering": {
    source: "composition-engineering",
    journey: "technical-selection",
    sections: ["specs", "material", "application"],
    label: "Engineering",
    frame: "index",
    subject: "Equipment for your application",
  },
  "business-bags": {
    source: "composition-packaging",
    journey: "configured-sourcing",
    sections: ["specs", "material", "oem", "moq", "samples"],
    label: "Materials & Options",
    frame: "gallery",
    subject: "Bags for your next collection",
  },
};
for (const [key, c] of Object.entries(businessCases))
  compositions[key] = { ...compositions[c.source], subject: c.subject };
const results = [];
let current = {};
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://fixture.invalid").pathname,
    entry =
      pathname === "/"
        ? current["index.html"]
        : (current[pathname.slice(1)] ??
          current[pathname.slice(1).replace(/\/$/, "") + "/index.html"]);
  if (!entry) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const ext = pathname.split(".").at(-1);
  res.setHeader(
    "Content-Type",
    ext === "js"
      ? "text/javascript"
      : ext === "ttf"
        ? "font/ttf"
        : ext === "css"
          ? "text/css"
          : ext === "webp"
            ? "image/webp"
            : ext === "json"
              ? "application/json"
              : ext === "txt"
                ? "text/plain"
                : ext === "xml"
                  ? "application/xml"
                  : "text/html",
  );
  res.end(entry);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port;
const chrome = await launch({
  chromePath: chromium.executablePath(),
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
});
const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of [
    "machinery",
    "building-hardware",
    "packaging-bags",
    "b2b-wholesale",
    ...Object.keys(compositions),
  ]) {
    const templateId =
      testCase === "b2b-wholesale" || compositions[testCase]
        ? "packaging-bags"
        : testCase;
    const block = (key, type, heading, extra = {}) => ({
      key,
      type,
      heading,
      body: paragraph,
      table: null,
      faq: [],
      assetId: null,
      alt: "",
      refs: [],
      ...extra,
    });
    const page = {
      id: "fixture",
      path: "/",
      type: "home",
      title: "Atlas Works — Industrial Product Sourcing",
      presentation: {
        navigationLabel: "Home",
        headline: "Make room for your next idea",
        summary:
          "Explore product information and share your project with our team.",
        primaryActionLabel: "Explore collection",
        visualStyle:
          templateId === "packaging-bags"
            ? "organic"
            : templateId === "machinery"
              ? "industrial"
              : "minimal",
        heroLayout: "split",
        designNotes: "Synthetic quality fixture.",
      },
      metaDescription:
        "Explore product information, specifications and purchasing support from the Atlas Works team. Discuss your application and project requirements.",
      refs: [],
      blocks: [
        block("hero", "text", "Your next project starts here"),
        block("factory", "image", "Factory gallery", {
          assetId: "fixture-image",
          alt: "Synthetic geometric factory illustration",
        }),
        block("advantages", "text", "Purchasing support"),
        block("certifications", "text", "Certification review"),
        block("cases", "text", "Project discussions"),
        block("faq", "faq", "Common questions", {
          faq: [
            {
              question: "How can I discuss my purchasing requirements?",
              answer: faq,
              detail: "",
            },
          ],
        }),
      ],
    };
    const snapshot = {
      site: {
        name: "Atlas Works",
        templateId,
        brandColor: "#16634a",
        logoId: null,
        productIds: [],
      },
      pages: [
        page,
        {
          ...page,
          id: "product",
          path: "/products/sample",
          type: "product",
          title: "Sample product overview",
          blocks: [
            block("overview", "text", "Product overview"),
            block("specs", "specs", "Specification discussion", {
              table: {
                columns: ["Item", "Information"],
                rows: [
                  ["Application", "Discuss your requirements with our team"],
                ],
              },
            }),
          ],
        },
      ],
      facts: [],
      settings: { canonicalBaseUrl: "https://atlas.example.invalid" },
      assets: {},
      createdAt: "2026-11-05",
    };
    if (testCase === "b2b-wholesale" || compositions[testCase]) {
      snapshot.site.buyerProfile = {
        businessModel: "wholesale",
        audiences: ["Retail buyers"],
        buyerNeeds: ["Compare product options"],
        primaryAction: "quote",
        referenceUrls: [],
      };
      snapshot.site.productIds = ["fixture-product"];
      snapshot.products = [
        {
          id: "fixture-product",
          name: "Fixture product",
          category: "Collection",
          assetIds: ["fixture-image"],
        },
      ];
      const item = (title, body) => ({
        title,
        body,
        assetId: null,
        alt: "",
        href: null,
        refs: [],
      });
      page.presentation.primaryActionTarget = "inquiry";
      page.blocks = [
        block("hero-image", "image", "Collection image", {
          body: "",
          assetId: "fixture-image",
          alt: "Synthetic geometric product illustration",
        }),
        block("categories", "category-grid", "Explore by collection", {
          body: "Find the range that fits your purchasing brief.",
        }),
        block("range", "product-grid", "Compare the range", {
          body: "Browse product information before preparing your inquiry.",
        }),
        block("buying-context", "features", "Prepare your buying brief", {
          body: "",
          items: [
            item(
              "Your market",
              "Share the destination market and intended retail channel.",
            ),
            item(
              "Your assortment",
              "Select products to discuss as a coordinated purchasing request.",
            ),
          ],
        }),
        block("closer-look", "split", "See the product details", {
          assetId: "fixture-image",
          alt: "Synthetic geometric product illustration",
          body: "Review the available product information, then ask our team to confirm the details relevant to your brief.",
          layout: "reverse",
        }),
        block(
          "working-together",
          "process",
          "Start a focused product discussion",
          {
            body: "",
            items: [
              item(
                "Choose products",
                "Add relevant products to your inquiry list.",
              ),
              item(
                "Share requirements",
                "Describe your intended market and the information you need.",
              ),
              item(
                "Confirm details",
                "Review written product details before placing an order.",
              ),
            ],
          },
        ),
        block("resources", "downloads", "Buying resources", {
          body: "Save a copy of the product catalogue for your brief.",
          items: [],
        }),
        block("next-step", "cta", "Discuss your collection", {
          body: "Share your selected products with our team.",
          items: [{ ...item("Request a quote", ""), href: "#inquiry" }],
        }),
      ];
      snapshot.pages[1].productId = "fixture-product";
      snapshot.pages[1].blocks.unshift(
        block("product-image", "image", "Product illustration", {
          body: "",
          assetId: "fixture-image",
          alt: "Synthetic product illustration",
        }),
      );
      snapshot.pages.push({
        ...page,
        id: "category",
        type: "category",
        path: "/products",
        title: "Product collection",
        presentation: {
          ...page.presentation,
          navigationLabel: "Products",
          headline: "Compare the collection",
        },
        blocks: [
          block("category-range", "product-grid", "Product range", {
            body: "Explore models for your purchasing brief.",
          }),
          block("category-cta", "cta", "Plan your inquiry", {
            body: "Share the product details you need confirmed.",
            items: [],
          }),
        ],
      });
    }
    if (compositions[testCase]) {
      const { hero, subject, ...axes } = compositions[testCase];
      const composition = { version: "v1", ...axes };
      snapshot.site.designDirection = { composition };
      for (const row of snapshot.pages) {
        row.presentation = { ...row.presentation, composition };
      }
      page.presentation.headline = subject + " for your next project";
      page.presentation.heroLayout = hero;
      page.presentation.visualStyle = "minimal";
      page.presentation.primaryActionLabel = "Discuss your project";
      page.presentation.primaryActionTarget = "inquiry";
      const original = snapshot.pages.find((row) => row.type === "product");
      original.presentation = {
        ...original.presentation,
        navigationLabel: "Option A",
        headline: subject + " option A",
      };
      for (const label of ["B", "C"]) {
        snapshot.pages.push({
          ...original,
          id: "option-" + label,
          productId: "option-" + label,
          path: "/products/option-" + label.toLowerCase(),
          title: subject + " option " + label,
          presentation: {
            ...original.presentation,
            navigationLabel: "Option " + label,
            headline: subject + " option " + label,
          },
        });
        snapshot.products.push({
          id: "option-" + label,
          name: "Option " + label,
          category: "Collection",
          assetIds: ["fixture-image"],
        });
        snapshot.site.productIds.push("option-" + label);
      }
      snapshot.pages.push({
        ...page,
        id: "contact",
        type: "contact",
        path: "/contact",
        title: "Discuss your project",
        presentation: {
          ...page.presentation,
          navigationLabel: "Contact",
          headline: "Prepare your project brief",
          heroLayout: "stacked",
        },
        blocks: [
          block("contact-guidance", "text", "Information for your inquiry"),
        ],
      });
    }
    if (businessCases[testCase]) {
      const c = businessCases[testCase];
      snapshot.site.plan = {
        strategy: {
          version: "v1",
          offering: c.subject,
          buyingJourney: c.journey,
          decisionFactors: ["Application", "Selection"],
          productSections: c.sections,
          visualPriorities: ["Product imagery", "Clear decisions"],
          questions: [],
          navigation: [
            { label: c.label, nodeKeys: ["range"] },
            { label: "Contact", nodeKeys: ["contact"] },
          ],
        },
        nodes: [
          { key: "range", path: "/products" },
          { key: "contact", path: "/contact" },
        ],
      };
      page.blocks = page.blocks.filter((b) => b.type !== "product-grid");
      for (const row of snapshot.pages)
        for (const b of row.blocks) {
          b.design = {
            purpose:
              b.type === "cta"
                ? "conversion"
                : b.type === "process"
                  ? "process"
                  : b.type === "category-grid"
                    ? "discovery"
                    : "selection",
            frame:
              b.type === "category-grid"
                ? c.frame
                : b.type === "product-grid"
                  ? "index"
                  : b.type === "split"
                    ? "split"
                    : b.type === "process"
                      ? "steps"
                      : "band",
            ratio: b.type === "image" ? "landscape" : "natural",
            fit: b.type === "image" ? "cover" : "contain",
            focus: "center",
            density: "compact",
          };
        }
    }
    const start = Date.now(),
      built = await buildStatic(snapshot, async () => ({
        body: img,
        mime: "image/webp",
        asset: {},
      }));
    current = built.files;
    const timings = {
      buildMs: Date.now() - start,
      bytes: built.report.totalBytes,
      files: built.report.files,
    };
    for (const [name, b] of Object.entries(current))
      if (name.endsWith(".html")) {
        const v = await validator.validateString(Buffer.from(b).toString());
        if (!v.valid)
          throw Error(
            "HTML invalid: " +
              JSON.stringify(v.results.flatMap((r) => r.messages)),
          );
      }
    const { lhr, report } = await lighthouse(url, {
      port: chrome.port,
      onlyCategories: ["performance", "seo"],
      output: ["json", "html"],
      logLevel: "error",
      formFactor: "mobile",
      screenEmulation: {
        mobile: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        disabled: false,
      },
    });
    const scores = {
      performance: Math.round(lhr.categories.performance.score * 100),
      seo: Math.round(lhr.categories.seo.score * 100),
    };
    await fs.writeFile(
      path.join(reportDir, "s5-" + testCase + "-lighthouse.json"),
      report[0],
    );
    await fs.writeFile(
      path.join(reportDir, "s5-" + testCase + "-lighthouse.html"),
      report[1],
    );
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await p.goto(url);
    if (
      (await p.locator(".desktop-nav > a, .desktop-nav > details").count()) >
      (snapshot.site.buyerProfile ? 5 : 4)
    )
      throw Error("Overloaded primary navigation");
    if ((await p.locator("h1").textContent()) !== page.presentation.headline)
      throw Error("SEO title leaked into hero");
    if (compositions[testCase]) {
      const h = await p.locator(".hero h1").evaluate((el) => {
        const box = el.getBoundingClientRect(),
          css = getComputedStyle(el);
        return {
          width: box.width,
          height: box.height,
          lineHeight: parseFloat(css.lineHeight),
        };
      });
      if (h.width < 320 || h.height > h.lineHeight * 4.2)
        throw Error("Hero copy is cramped despite no page overflow");
      if (await p.locator(".catalog-section.line-sheet").count())
        throw Error("Legacy catalogue layout leaked into a composed site");
    }
    for (const width of [375, 768, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      if (
        !(await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ))
      )
        throw Error("Responsive overflow at " + width);
      const directed = await p.evaluate(() => {
        const cards = [
          ...document.querySelectorAll(".frame-index .category-grid > a"),
        ];
        const cramped = cards.some((a) => {
          const title = a.querySelector("span:first-of-type");
          const picture = a.querySelector(":scope > picture, :scope > img");
          return (
            title &&
            picture &&
            (title.getBoundingClientRect().width < 100 ||
              title.getBoundingClientRect().left <
                picture.getBoundingClientRect().right)
          );
        });
        const wrongFit = [
          ...document.querySelectorAll(".hero.fit-contain img"),
        ].some((i) => getComputedStyle(i).objectFit !== "contain");
        return { cramped, wrongFit };
      });
      if (directed.cramped || directed.wrongFit)
        throw Error(
          "Section design intent lost at " + width + JSON.stringify(directed),
        );
    }
    await p.screenshot({
      path: path.join(reportDir, "s5-" + testCase + "-desktop.png"),
      fullPage: true,
    });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(url);
    if (
      !(await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ))
    )
      throw Error("Mobile overflow");
    await p.screenshot({
      path: path.join(reportDir, "s5-" + testCase + "-mobile.png"),
      fullPage: true,
    });
    await p.close();
    results.push({
      templateId: testCase,
      ...scores,
      ...timings,
      lighthouseVersion: lhr.lighthouseVersion,
      html: "valid",
      mobileOverflow: false,
    });
    console.log(JSON.stringify(results.at(-1)));
    if (scores.performance < 90 || scores.seo < 90)
      throw Error("Lighthouse target missed");
  }
  await fs.writeFile(
    path.join(reportDir, "s5-quality-summary.json"),
    JSON.stringify(
      {
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        generatedAt: new Date().toISOString(),
        mode: "Lighthouse mobile simulated throttling, local synthetic fixture, cold navigation",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await chrome.kill();
  await new Promise((r) => server.close(r));
}
