import container from "markdown-it-container";
import { defineConfig } from "vitepress";
import { examples, site } from "./examples.ts";
import { llms, tidyLlmsTxt } from "./llms.ts";

const repository = "https://github.com/forestfuture/d1-record";
const base = "/d1-record/";

export default defineConfig({
  // Examples are expanded with their imports first, so the llms plugin reads them expanded too.
  vite: { plugins: [examples(site), llms()] },
  buildEnd: ({ outDir }) => tidyLlmsTxt(outDir),
  title: "d1-record",
  description: "A Rails-inspired Active Record for Cloudflare Workers and D1.",
  // Served at docs.forestfuture.dev/d1-record: built into dist/d1-record so the Worker's
  // static assets find each page at its own path (wrangler.jsonc).
  base,
  outDir: ".vitepress/dist/d1-record",
  cleanUrls: true,
  lastUpdated: true,
  // Written to the outDir as sitemap.xml; the hostname carries the base so each <loc> is the page's real URL.
  sitemap: { hostname: `https://docs.forestfuture.dev${base}` },
  srcExclude: ["snippets/**"],
  markdown: {
    config: (md) => {
      // `::: rails Beyond Rails` is a red box for what Rails does or doesn't do (custom.css).
      const render: NonNullable<container.ContainerOpts["render"]> = (tokens, index) => {
        const token = tokens[index]!;
        if (token.nesting !== 1) return "</div>\n";
        const title = token.info.trim().slice("rails".length).trim() || "Rails";
        return `<div class="rails custom-block"><p class="custom-block-title">${md.utils.escapeHtml(title)}</p>\n`;
      };
      // VitePress' MarkdownRenderer and @types/markdown-it's MarkdownIt are separate declarations.
      container(md as unknown as Parameters<typeof container>[0], "rails", { render });
    },
  },
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
          { text: "AI agents", link: "/guide/ai-agents" },
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
        text: "Basics",
        items: [
          { text: "Models", link: "/guide/models" },
          { text: "Querying", link: "/guide/querying" },
          { text: "Persistence", link: "/guide/persistence" },
          { text: "Validations", link: "/guide/validations" },
          { text: "Callbacks", link: "/guide/callbacks" },
          { text: "Associations", link: "/guide/associations" },
          { text: "Bulk writes and batches", link: "/guide/batches" },
          { text: "Connections", link: "/guide/connecting" },
          { text: "Command line", link: "/guide/command-line" },
          { text: "Errors", link: "/guide/errors" },
        ],
      },
      {
        text: "How-to guides",
        items: [
          { text: "Generators", link: "/guide/generators" },
          { text: "Console", link: "/guide/console" },
          { text: "Schema changes", link: "/guide/change-a-table" },
          { text: "Existing databases", link: "/guide/adopt-a-database" },
          { text: "Shared behavior", link: "/guide/shared-behavior" },
          { text: "Untrusted input", link: "/guide/untrusted-input" },
          { text: "Logging", link: "/guide/logging" },
          { text: "Read replicas", link: "/guide/read-your-own-writes" },
          { text: "Testing", link: "/guide/testing" },
          { text: "Multiple databases", link: "/guide/several-databases" },
        ],
      },
      {
        text: "Background",
        items: [
          { text: "Database resolution", link: "/guide/query-databases" },
          { text: "Schema and ApplicationRecord", link: "/guide/schema" },
          { text: "D1’s limits", link: "/guide/d1" },
          { text: "Security", link: "/guide/security" },
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
