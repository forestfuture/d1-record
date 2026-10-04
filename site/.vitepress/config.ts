import { defineConfig } from "vitepress";
import { copyOrDownloadAsMarkdownButtons } from "vitepress-plugin-llms";
import { examples, site } from "./examples.ts";
import { llms, tidyLlmsTxt } from "./llms.ts";

const repository = "https://github.com/forestfuture/d1-record";
const base = "/d1-record/";

export default defineConfig({
  // Examples are expanded with their imports first, so the llms plugin reads them expanded too.
  vite: { plugins: [examples(site), llms()] },
  buildEnd: ({ outDir }) => tidyLlmsTxt(outDir),
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons); // "Copy page" on every page
    },
  },
  title: "d1-record",
  description: "A Rails-inspired Active Record for Cloudflare Workers and D1.",
  // Served at docs.forestfuture.dev/d1-record: built into dist/d1-record so the Worker's
  // static assets find each page at its own path (wrangler.jsonc).
  base,
  outDir: ".vitepress/dist/d1-record",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["snippets/**"],
  head: [["meta", { name: "theme-color", content: "#2f6b3f" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Contract", link: `${repository}/blob/main/docs/contract.md` },
      {
        text: "LLMs",
        items: [
          // Files, not pages: opened in a new tab, which VitePress links without its base.
          { text: "llms.txt", link: `${base}llms.txt`, target: "_blank" },
          { text: "llms-full.txt", link: `${base}llms-full.txt`, target: "_blank" },
          { text: "Using d1-record with AI agents", link: "/guide/ai-agents" },
        ],
      },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Coming from Rails", link: "/guide/coming-from-rails" },
          { text: "Using with AI agents", link: "/guide/ai-agents" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Connecting", link: "/guide/connecting" },
          { text: "Models", link: "/guide/models" },
          { text: "Migrations", link: "/guide/migrations" },
          { text: "Querying", link: "/guide/querying" },
          { text: "Saving and destroying", link: "/guide/persistence" },
          { text: "Validations", link: "/guide/validations" },
          { text: "Callbacks", link: "/guide/callbacks" },
          { text: "Associations", link: "/guide/associations" },
          { text: "Batches and bulk writes", link: "/guide/batches" },
        ],
      },
      {
        text: "Working with D1",
        items: [
          { text: "D1's limits", link: "/guide/d1" },
          { text: "Errors", link: "/guide/errors" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repository }],
    editLink: {
      pattern: `${repository}/edit/main/site/:path`,
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    outline: [2, 3],
    footer: {
      message: "Released under the MIT License.",
      copyright: 'A <a href="https://forestfuture.dev">ForestFuture</a> project',
    },
  },
});
