import { renderPrivacy, privacyPath } from "./inquiry-template.service";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import sharp from "sharp";
import { Parser } from "htmlparser2";
import { config } from "../config";
import { ensure, AppError } from "../errors";
import { readAsset } from "./storage.service";
import { renderStaticPage, e, type Snapshot } from "./static-template.service";
export type Files = Record<string, Uint8Array>;
const builder = path.resolve(__dirname, "../../builder");
const bytes = (s: string) => Buffer.from(s);
export function outputChecks(files: Files) {
  const issues: string[] = [];
  for (const [name, body] of Object.entries(files)) {
    if (!name.endsWith(".html")) continue;
    const ids = new Set<string>(),
      links: string[] = [];
    let title = 0,
      description = 0,
      h1 = 0;
    const parser = new Parser({
      onopentag(tag, a) {
        if (a.id) ids.add(a.id);
        if (tag === "title") title++;
        if (tag === "meta" && a.name === "description" && a.content)
          description++;
        if (tag === "h1") h1++;
        if (tag === "img" && !a.alt?.trim()) issues.push("ALT_MISSING:" + name);
        for (const key of ["href", "src"])
          if (a[key] && !/^(https?:|mailto:|tel:|data:)/.test(a[key]))
            links.push(a[key]);
      },
    });
    parser.end(Buffer.from(body).toString("utf8"));
    if (title !== 1 || description !== 1 || h1 !== 1)
      issues.push("HTML_HEAD_INVALID:" + name);
    for (const href of links) {
      if (href.startsWith("#")) {
        if (!ids.has(href.slice(1))) issues.push("BROKEN_LINK:" + name);
        continue;
      }
      const file = href.split("#")[0].replace(/^\//, "");
      if (
        !files[file] &&
        !files[file.replace(/\/$/, "") + "/index.html"] &&
        !(file === "" && files["index.html"])
      )
        issues.push("BROKEN_LINK:" + name);
    }
  }
  return [...new Set(issues)];
}
export function unpack(body: Buffer): Files {
  let total = 0,
    count = 0;
  return unzipSync(body, {
    filter: (f) => {
      total += f.originalSize;
      count++;
      ensure(
        count <= 1000 &&
          total <= 100 * 1024 * 1024 &&
          f.originalSize <= 25 * 1024 * 1024 &&
          !/(^\/|\\|\.\.)/.test(f.name),
        413,
        "ARTIFACT_INVALID",
      );
      return true;
    },
  });
}
export async function buildStatic(snapshot: Snapshot, readImage = readAsset) {
  const parent = path.resolve(config.storage, ".builds"),
    root = path.join(parent, randomUUID());
  await fs.mkdir(path.join(root, "src/pages"), { recursive: true });
  await fs.mkdir(path.join(root, "public/assets"), { recursive: true });
  try {
    await fs.symlink(
      path.dirname(path.dirname(require.resolve("astro/package.json"))),
      path.join(root, "node_modules"),
      "junction",
    );
    // Immutable source data is the only variable input. No user-provided Astro/JS is compiled.
    const images = new Set<string>(
      [
        snapshot.site.logoId,
        ...(snapshot.products ?? []).flatMap((p) => p.assetIds.slice(0, 2)),
        ...snapshot.pages.flatMap((p) =>
          p.blocks
            .filter((b: any) => b.type === "image")
            .map((b: any) => b.assetId),
        ),
      ].filter(Boolean),
    );
    const assets: Snapshot["assets"] = {};
    for (const id of images) {
      const a = await readImage(id, "webp");
      ensure(a.mime === "image/webp", 409, "ASSET_NOT_READY");
      const data = await sharp(a.body)
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const key =
        "assets/" +
        createHash("sha256").update(data.data).digest("hex").slice(0, 24) +
        ".webp";
      await fs.writeFile(path.join(root, "public", key), data.data);
      assets[id] = {
        path: "/" + key,
        width: data.info.width,
        height: data.info.height,
      };
    }
    snapshot = { ...snapshot, assets };
    const pages = snapshot.pages.map((p) => ({
      slug: p.path === "/" ? undefined : p.path.replace(/^\/|\/$/g, ""),
      html: renderStaticPage(snapshot, p),
    }));
    pages.push({
      slug: privacyPath(snapshot).replace(/^\//, ""),
      html: renderPrivacy(snapshot),
    });
    await fs.copyFile(
      path.join(builder, "inquiry.js"),
      path.join(root, "public/assets/inquiry.js"),
    );
    await fs.writeFile(path.join(root, "data.json"), JSON.stringify(pages));
    await fs.writeFile(
      path.join(root, "src/pages/[...slug].astro"),
      '---\nimport fs from "node:fs";\nexport function getStaticPaths(){return JSON.parse(fs.readFileSync(' +
        JSON.stringify(path.join(root, "data.json")) +
        ',"utf8")).map(p=>({params:{slug:p.slug},props:{html:p.html}}));}\nconst {html}=Astro.props;\n---\n<Fragment set:html={html} />',
    );
    await fs.cp(
      path.join(builder, "fonts"),
      path.join(root, "public/assets/fonts"),
      { recursive: true },
    );
    await fs.copyFile(
      path.join(builder, "site.css"),
      path.join(root, "public/assets/site.css"),
    );
    await fs.writeFile(
      path.join(root, "public/404.html"),
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="description" content="The requested page could not be found."><title>Page not found</title><link rel="stylesheet" href="/assets/site.css"></head><body><main><h1>Page not found</h1><p><a href="/">Return to the homepage</a></p></main></body></html>',
    );
    const urls = snapshot.pages.map(
      (p) =>
        new URL(
          p.path.endsWith("/") ? p.path : p.path + "/",
          snapshot.settings.canonicalBaseUrl,
        ).href,
    );
    urls.push(
      new URL(privacyPath(snapshot) + "/", snapshot.settings.canonicalBaseUrl)
        .href,
    );
    await fs.writeFile(
      path.join(root, "public/sitemap.xml"),
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        urls.map((u) => "<url><loc>" + e(u) + "</loc></url>").join("") +
        "</urlset>",
    );
    await fs.writeFile(
      path.join(root, "public/robots.txt"),
      [
        "User-agent: *",
        "Allow: /",
        ...[
          "GPTBot",
          "OAI-SearchBot",
          "PerplexityBot",
          "Google-Extended",
        ].flatMap((a) => ["", "User-agent: " + a, "Allow: /"]),
        "",
        "Sitemap: " +
          new URL("/sitemap.xml", snapshot.settings.canonicalBaseUrl).href,
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "public/llms.txt"),
      "# " +
        snapshot.site.name +
        "\n\n" +
        snapshot.pages
          .map(
            (p, i) =>
              "- [" +
              p.title.replace(/[\r\n[\]]/g, " ") +
              "](" +
              urls[i] +
              "): " +
              p.metaDescription.replace(/[\r\n]/g, " "),
          )
          .join("\n"),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=512",
          "--require",
          path.join(builder, "no-network.cjs"),
          path.join(builder, "run.mjs"),
        ],
        {
          cwd: root,
          windowsHide: true,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: root,
            TMP: root,
            HOME: root,
            USERPROFILE: root,
            ASTRO_TELEMETRY_DISABLED: "1",
            NODE_ENV: "production",
          },
          stdio: "ignore",
        },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new AppError(409, "BUILD_TIMEOUT"));
      }, 90000);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new AppError(409, "BUILD_FAILED"));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new AppError(409, "BUILD_FAILED"));
      });
    });
    const files: Files = {};
    let total = 0;
    async function walk(dir: string) {
      for (const name of await fs.readdir(dir)) {
        const target = path.join(dir, name),
          stat = await fs.lstat(target);
        ensure(!stat.isSymbolicLink(), 409, "ARTIFACT_INVALID");
        if (stat.isDirectory()) await walk(target);
        else {
          ensure(
            stat.isFile() && stat.size <= 25 * 1024 * 1024,
            413,
            "ARTIFACT_TOO_LARGE",
          );
          total += stat.size;
          ensure(
            total <= 75 * 1024 * 1024 && Object.keys(files).length < 999,
            413,
            "ARTIFACT_TOO_LARGE",
          );
          const relative = path
            .relative(path.join(root, "dist"), target)
            .split(path.sep)
            .join("/");
          const body = await fs.readFile(target);
          files[relative] = relative.endsWith(".html")
            ? Buffer.from(
                body
                  .toString("utf8")
                  .replace(/^<!doctype html>/i, "<!DOCTYPE html>"),
              )
            : body;
        }
      }
    }
    await walk(path.join(root, "dist"));
    const problems = outputChecks(files);
    ensure(!problems.length, 409, "BUILD_HTML_INVALID");
    const manifest = Object.fromEntries(
      Object.entries(files)
        .sort()
        .map(([n, b]) => [n, createHash("sha256").update(b).digest("hex")]),
    );
    files["globalsite-manifest.json"] = bytes(
      JSON.stringify({ templateVersion: "s5.1", files: manifest }),
    );
    return {
      body: Buffer.from(
        zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") }),
      ),
      files,
      report: {
        pages: pages.length,
        files: Object.keys(files).length,
        totalBytes: total,
        issues: [],
      },
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
