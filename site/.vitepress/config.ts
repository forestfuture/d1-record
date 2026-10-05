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
        text: "Start here",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Coming from Rails", link: "/guide/coming-from-rails" },
          { text: "Using with AI agents", link: "/guide/ai-agents" },
        ],
      },
      {
        text: "How-to guides",
        items: [
          { text: "Generate models and migrations", link: "/guide/generators" },
          { text: "Change a table", link: "/guide/change-a-table" },
          { text: "Adopt an existing database", link: "/guide/adopt-a-database" },
          { text: "Share behavior across Models", link: "/guide/shared-behavior" },
          { text: "Handle untrusted input", link: "/guide/untrusted-input" },
          { text: "Log queries", link: "/guide/logging" },
          { text: "Read your own writes", link: "/guide/read-your-own-writes" },
          { text: "Test with Miniflare", link: "/guide/testing" },
          { text: "Use several databases", link: "/guide/several-databases" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Models", link: "/guide/models" },
          { text: "Querying", link: "/guide/querying" },
          { text: "Saving and destroying", link: "/guide/persistence" },
          { text: "Validations", link: "/guide/validations" },
          { text: "Callbacks", link: "/guide/callbacks" },
          { text: "Associations", link: "/guide/associations" },
          { text: "Bulk writes and batches", link: "/guide/batches" },
          { text: "Connecting", link: "/guide/connecting" },
          { text: "Command line", link: "/guide/command-line" },
          { text: "Errors", link: "/guide/errors" },
        ],
      },
      {
        text: "Background",
        items: [
          { text: "Where a query's database comes from", link: "/guide/query-databases" },
          { text: "The schema and ApplicationRecord", link: "/guide/schema" },
          { text: "D1's limits", link: "/guide/d1" },
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
