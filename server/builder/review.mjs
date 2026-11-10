// Trusted isolated artifact reviewer. Browser requests are fulfilled only from this immutable bundle.
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
const root = path.resolve(process.argv[2]);
const input = JSON.parse(
  await fs.readFile(path.join(root, "input.json"), "utf8"),
);
const contentType = (n) =>
  n.endsWith(".html")
    ? "text/html"
    : n.endsWith(".css")
      ? "text/css"
      : n.endsWith(".webp")
        ? "image/webp"
        : n.endsWith(".ttf")
          ? "font/ttf"
          : "application/octet-stream";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-background-networking",
    "--disable-component-update",
  ],
});
try {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://review.invalid" || url.search) {
      await route.abort();
      return;
    }
    let file = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (!path.extname(file))
      file = (file ? file.replace(/\/$/, "") + "/" : "") + "index.html";
    if (!input.files.includes(file)) {
      await route.abort();
      return;
    }
    const target = path.resolve(root, "files", file);
    if (!target.startsWith(path.join(root, "files") + path.sep)) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: contentType(file),
      body: await fs.readFile(target),
    });
  });
  const metrics = [];
  for (const width of [375, 768, 1440]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("https://review.invalid" + input.pagePath, {
      waitUntil: "load",
      timeout: 15000,
    });
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const main = document.querySelector("main"),
        text = main?.innerText ?? "";
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        height: document.documentElement.scrollHeight,
        words: text.split(/\s+/).filter(Boolean).length,
        headings: [...document.querySelectorAll("h1,h2")].map(
          (n) => n.textContent,
        ),
        brokenImages: [...document.images].filter(
          (n) => !n.complete || !n.naturalWidth,
        ).length,
        navigation: [
          ...document.querySelectorAll("header nav a,.main-nav a"),
        ].map((n) => ({
          label: n.textContent.trim(),
          href: n.getAttribute("href"),
        })),
        sections: [...document.querySelectorAll("main>section")].map((n) => {
          const box = n.getBoundingClientRect();
          return {
            id: n.id,
            height: Math.round(box.height),
            words: (n.innerText ?? "").split(/\s+/).filter(Boolean).length,
            images: n.querySelectorAll("img").length,
            frame: [...n.classList].find((c) => c.startsWith("frame-")) ?? null,
            media: [...n.querySelectorAll("img")].map((img) => {
              const r = img.getBoundingClientRect(),
                css = getComputedStyle(img);
              return {
                naturalRatio: img.naturalWidth / Math.max(1, img.naturalHeight),
                displayRatio: r.width / Math.max(1, r.height),
                fit: css.objectFit,
              };
            }),
          };
        }),
        repeatedHeadings: [...document.querySelectorAll("main h2")]
          .map((n) => n.textContent.trim().toLowerCase())
          .filter((v, i, a) => a.indexOf(v) !== i),
        discoverySections: document.querySelectorAll(
          "main>.catalog-section,main>.block-category-grid,main>.block-product-grid",
        ).length,
        blankSections: [...document.querySelectorAll("main>section")].filter(
          (n) =>
            (n.innerText ?? "").trim().length < 20 && !n.querySelector("img"),
        ).length,
      };
    });
    if (m.height > 14000) throw Error("REVIEW_TOO_TALL");
    await page.screenshot({
      path: path.join(root, String(width) + ".jpg"),
      type: "jpeg",
      quality: 72,
      fullPage: true,
    });
    metrics.push({ width, ...m });
    await page.close();
  }
  await fs.writeFile(path.join(root, "report.json"), JSON.stringify(metrics));
  await context.close();
} finally {
  await browser.close();
}
