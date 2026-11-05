import { build } from "astro";
import { pathToFileURL } from "node:url";
await build({
  root: pathToFileURL(process.cwd() + "/"),
  configFile: false,
  cacheDir: "./.astro-cache/",
  output: "static",
  trailingSlash: "always",
  logLevel: "silent",
  devToolbar: { enabled: false },
  vite: {
    cacheDir: process.cwd() + "/.vite",
    build: { minify: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  },
});
