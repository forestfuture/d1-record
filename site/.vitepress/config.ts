import { defineConfig } from "vitepress";

const repository = "https://github.com/forestfuture/d1-record";

export default defineConfig({
  title: "d1-record",
  description: "A Rails-inspired Active Record for Cloudflare Workers and D1.",
  // Served at docs.forestfuture.dev/d1-record: built into dist/d1-record so the Worker's
  // static assets find each page at its own path (wrangler.jsonc).
  base: "/d1-record/",
  outDir: ".vitepress/dist/d1-record",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["snippets/**"],
  head: [["meta", { name: "theme-color", content: "#2f6b3f" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Contract", link: `${repository}/blob/main/docs/contract.md` },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Coming from Rails", link: "/guide/coming-from-rails" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Connecting", link: "/guide/connecting" },
          { text: "Models", link: "/guide/models" },
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
      copyright: 'A <a href="https://forestfuture.dev">Forest Future</a> project',
    },
  },
});
